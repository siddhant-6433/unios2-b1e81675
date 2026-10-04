import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

let handler: (req: Request) => Promise<Response>;
const serve = Deno.serve;
Deno.serve = ((callback: typeof handler) => { handler = callback; return {} }) as typeof Deno.serve;
await import("./index.ts");
Deno.serve = serve;

Deno.test("manual saved-application resolution retains applicant phone scope", async t => {
  const env = { SUPABASE_URL: "https://backend.test", SUPABASE_SERVICE_ROLE_KEY: "test-service", MIRAI_ROLLOUT_ENABLED: "true" };
  const before = Object.fromEntries(Object.keys(env).map(key => [key, Deno.env.get(key)]));
  for (const [key, value] of Object.entries(env)) Deno.env.set(key, value);
  const realFetch = globalThis.fetch;
  let allowed = true, unavailable = false;
  let ownershipReads = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : null;
    const url = new URL(request?.url || String(input));
    assertEquals(url.hostname, "backend.test");
    let result: unknown;
    if (url.pathname.endsWith("get_applicant_applications_by_phone")) {
      const raw = init?.body || (request ? await request.text() : "");
      assertEquals(JSON.parse(String(raw))._phone, "+919000000000");
      if (unavailable) return new Response(JSON.stringify({message:"Database unavailable"}), {status:503});
      result = allowed ? [{application_id:"APP-MIRAI",lead_id:"lead-1"}] : [];
    } else {
      ownershipReads++;
      if (url.pathname.endsWith("/leads")) result = {portal_brand:"mirai"};
      else if (url.pathname.endsWith("/applications")) {
        assertEquals(url.searchParams.get("application_id"), "eq.APP-MIRAI");
        result = [{flags:["portal:mirai"]}];
      } else throw new Error(`Unexpected request: ${url.pathname}`);
    }
    return new Response(JSON.stringify(result), {headers:{"Content-Type":"application/json"}});
  }) as typeof fetch;
  const resolve = (application_id = "APP-MIRAI") => handler(new Request("https://backend.test/redeem-apply-link", {
    method:"POST", headers:{"Content-Type":"application/json"},
    body:JSON.stringify({resolve_only:true,phone:"9000000000",application_id}),
  }));
  try {
    await t.step("matching application resolves saved ownership without returning personal data", async () => {
      const response = await resolve();
      assertEquals(response.status,200);
      assertEquals(await response.json(),{portal:"mirai",mirai_rollout_enabled:true});
    });
    await t.step("wrong phone cannot resolve another application's ownership", async () => {
      allowed=false;ownershipReads=0;
      assertEquals((await resolve()).status,404);
      assertEquals(ownershipReads,0);
      allowed=true;
    });
    await t.step("matching phone cannot resolve an unrelated application ID", async () => {
      ownershipReads=0;
      assertEquals((await resolve("APP-OTHER")).status,404);
      assertEquals(ownershipReads,0);
    });
    await t.step("access RPC failures fail closed before ownership reads", async () => {
      unavailable=true;ownershipReads=0;
      assertEquals((await resolve()).status,404);
      assertEquals(ownershipReads,0);
    });
  } finally {
    globalThis.fetch=realFetch;
    for (const [key,value] of Object.entries(before)) if (value === undefined) Deno.env.delete(key); else Deno.env.set(key,value);
  }
});
