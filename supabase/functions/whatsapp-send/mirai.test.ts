import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { MIRAI_TEMPLATES } from "../_shared/mirai-templates.ts";

// Exercise the actual handler with a fake Supabase REST server and Graph API.
// No test request can reach the network or send a real message.
let handler: (req: Request) => Promise<Response>;
const realServe = Deno.serve;
Deno.serve = ((callback: typeof handler) => { handler = callback; return {} }) as typeof Deno.serve;
await import("./index.ts");
Deno.serve = realServe;

Deno.test("Mirai lifecycle preflight and exact-account delivery", async (t) => {
  const env = { SUPABASE_URL: "https://backend.test", SUPABASE_ANON_KEY: "test-anon", SUPABASE_SERVICE_ROLE_KEY: "test-service",
    MIRAI_ROLLOUT_ENABLED: "true", MIRAI_TOKEN: "test-meta-token" };
  const original = Object.fromEntries(Object.keys(env).map(key => [key, Deno.env.get(key)]));
  for (const [key,value] of Object.entries(env)) Deno.env.set(key,value);
  const realFetch = globalThis.fetch;
  let approved = true, hasSender = true, miraiOwner = true, blocked = false;
  let graphFailure = false;
  let calls: {url: URL; body: any}[] = [];
  let template = MIRAI_TEMPLATES.apply_portal_login;
  const sender = { id: "mirai", provider: "meta", route: "reply", is_active: true, waba_id: "mirai-waba",
    business_number: "919220522282", meta_phone_number_id: "1110238142172240", secret_token_name: "MIRAI_TOKEN" };
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : null;
    const url = new URL(request?.url || String(input));
    const raw = init?.body || (request ? await request.text() : "");
    const body = typeof raw === "string" && raw ? JSON.parse(raw) : null;
    calls.push({url,body});
    let data: unknown = [];
    const table = url.pathname.split("/").pop();
    const select = url.searchParams.get("select") || "";
    if (url.hostname === "graph.facebook.com") {
      assertEquals(url.pathname, "/v21.0/1110238142172240/messages");
      assertEquals(body.template.name, template.name);
      return new Response(JSON.stringify(graphFailure ? {error:{code:133010,message:"Unregistered sender"}} : {messages:[{id:"fake-message"}]}), {status:graphFailure ? 400 : 200});
    }
    assertEquals(url.hostname,"backend.test");
    if (table === "phone_comms_suppressed") data = blocked;
    else if (table === "leads") data = select === "stage" ? {stage:"new"} : {portal_brand:miraiOwner ? "mirai" : "nimt"};
    else if (table === "whatsapp_channels") {
      data = hasSender ? [sender] : [];
      const accept = init?.headers ? new Headers(init.headers).get("Accept") : request?.headers.get("Accept");
      if (accept?.includes("vnd.pgrst.object")) data = hasSender ? sender : null;
    } else if (table === "whatsapp_templates") data = approved ? [{name:template.name,status:"APPROVED",language:"en",waba_id:"mirai-waba",placeholder_count:template.params.length,header_format:template.header || "NONE",
      components:[...(template.header ? [{type:"HEADER",format:template.header}] : []),{type:"BODY",text:template.body},...(template.button ? [{type:"BUTTONS",buttons:[{type:"URL",...template.button}]}] : [])]}] : [];
    else if (table === "whatsapp_template_settings") data = {media_url:"https://samples.test/approval-only.pdf"};
    else if (table === "whatsapp_messages") data = {id:"fake-row"};
    return new Response(JSON.stringify(data), {headers:{"Content-Type":"application/json"}});
  }) as typeof fetch;
  const send = async (extra: Record<string,unknown> = {}) => {
    calls = [];
    return await handler(new Request("https://backend.test/whatsapp-send", {method:"POST",headers:{Authorization:"Bearer test-service","Content-Type":"application/json"},body:JSON.stringify({template_key:"apply_portal_login",lead_id:"lead-1",phone:"919000000000",params:["Sample","Tomorrow"],button_urls:["saved-token"],...extra})}));
  };
  const graphCalls = () => calls.filter(c => c.url.hostname === "graph.facebook.com");
  try {
    await t.step("saved Mirai owner overrides visiting host and requested NIMT sender", async () => {
      const response = await send({provider:"plivo",business_phone_number_id:"nimt-number",origin_domain:"uni.nimt.ac.in"});
      assertEquals(response.status,200);
      assertEquals(graphCalls().length,1);
      assertEquals(graphCalls()[0].body.template.components.find((c:any) => c.type === "button").parameters[0].text,"saved-token");
    });
    await t.step("pending approval is logged for staff and never reaches Graph", async () => {
      approved=false;
      const response=await send();
      assertEquals(response.status,503);assertEquals(graphCalls().length,0);
      assertStringIncludes((await response.json()).error,"not approved");
      assertEquals(calls.find(c => c.url.pathname.endsWith("/whatsapp_messages"))?.body.status,"failed");
      approved=true;
    });
    await t.step("missing active Mirai sender cannot use another WABA", async () => {
      hasSender=false;assertEquals((await send()).status,503);assertEquals(graphCalls().length,0);hasSender=true;
    });
    await t.step("parameter/button failures stay local", async () => {
      assertEquals((await send({params:["Sample"]})).status,400);assertEquals(graphCalls().length,0);
      assertEquals((await send({button_urls:[]})).status,400);assertEquals(graphCalls().length,0);
    });
    await t.step("document receipts require the generated PDF and cannot use approval samples", async () => {
      template = MIRAI_TEMPLATES.payment_receipt_pdf;
      const payload = {template_key:"payment_receipt_pdf",params:["Sample","School fee","1000","RECEIPT-1"],button_urls:[]};
      assertEquals((await send(payload)).status,400);assertEquals(graphCalls().length,0);
      assertEquals((await send({...payload,header_image_url:"https://files.test/image.png"})).status,400);assertEquals(graphCalls().length,0);
      assertEquals((await send({...payload,header_document_url:"https://files.test/receipt.pdf",header_video_url:"https://files.test/video.mp4"})).status,400);assertEquals(graphCalls().length,0);
      assertEquals((await send({...payload,header_document_url:"https://files.test/receipt.pdf",header_document_filename:"Receipt.pdf"})).status,200);
      assertEquals(graphCalls().length,1);
      assertEquals(graphCalls()[0].body.template.components.find((c:any) => c.type === "header").parameters[0],{type:"document",document:{link:"https://files.test/receipt.pdf",filename:"Receipt.pdf"}});
      template = MIRAI_TEMPLATES.apply_portal_login;
    });
    await t.step("explicit Mirai template cannot be sent for a saved NIMT owner", async () => {
      miraiOwner=false;
      assertEquals((await send({template_key:template.name})).status,400);assertEquals(graphCalls().length,0);miraiOwner=true;
    });
    await t.step("explicit Mirai templates remain disabled before rollout", async () => {
      Deno.env.set("MIRAI_ROLLOUT_ENABLED","false");
      assertEquals((await send({template_key:template.name})).status,503);assertEquals(graphCalls().length,0);
      Deno.env.set("MIRAI_ROLLOUT_ENABLED","true");
    });
    await t.step("opt-outs still suppress sends", async () => {
      blocked=true;assertEquals((await send()).status,200);assertEquals(graphCalls().length,0);blocked=false;
    });
    await t.step("Meta registration failures do not retry or discover another account", async () => {
      graphFailure=true;assertEquals((await send()).status,400);assertEquals(graphCalls().length,1);
      assertEquals(calls.filter(c => c.url.pathname.includes("phone_numbers")).length,0);
    });
  } finally {
    globalThis.fetch = realFetch;
    for (const [key,value] of Object.entries(original)) if (value === undefined) Deno.env.delete(key); else Deno.env.set(key,value);
  }
});
