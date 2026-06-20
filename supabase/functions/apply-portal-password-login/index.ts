import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DEFAULT_USERNAME = "razorpay_uat";
const DEFAULT_PASSWORD = "Nimt@Razorpay2026";
const DEFAULT_PHONE = "+919999000026";
const DEFAULT_NAME = "Razorpay UAT Lead";
const DEFAULT_EMAIL = "razorpay.uat@nimt.test";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalizePhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return `+${digits}`;
  if (value.startsWith("+")) return value;
  return `+${digits}`;
}

async function secureEqual(left: string, right: string): Promise<boolean> {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  const max = Math.max(leftBytes.length, rightBytes.length);
  let diff = leftBytes.length ^ rightBytes.length;
  for (let i = 0; i < max; i += 1) {
    diff |= (leftBytes[i] ?? 0) ^ (rightBytes[i] ?? 0);
  }
  await crypto.subtle.digest("SHA-256", leftBytes);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const expectedUsername = Deno.env.get("APPLY_PORTAL_UAT_USERNAME") || DEFAULT_USERNAME;
    const expectedPassword = Deno.env.get("APPLY_PORTAL_UAT_PASSWORD") || DEFAULT_PASSWORD;
    const testPhone = normalizePhone(Deno.env.get("APPLY_PORTAL_UAT_PHONE") || DEFAULT_PHONE);
    const testName = Deno.env.get("APPLY_PORTAL_UAT_NAME") || DEFAULT_NAME;
    const testEmail = Deno.env.get("APPLY_PORTAL_UAT_EMAIL") || DEFAULT_EMAIL;

    const { portal, username, password } = await req.json().catch(() => ({}));
    if (portal !== "nimt") return json({ error: "Password login is not enabled for this portal" }, 403);
    if (typeof username !== "string" || typeof password !== "string") {
      return json({ error: "username and password required" }, 400);
    }

    const usernameOk = await secureEqual(username.trim().toLowerCase(), expectedUsername.toLowerCase());
    const passwordOk = await secureEqual(password, expectedPassword);
    if (!usernameOk || !passwordOk) return json({ error: "Invalid username or password" }, 401);

    const db = createClient(supabaseUrl, serviceRoleKey);
    const { data: existingLead, error: lookupError } = await db
      .from("leads")
      .select("id, name, phone")
      .eq("phone", testPhone)
      .eq("is_mirror", false)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lookupError) return json({ error: lookupError.message }, 500);

    let lead = existingLead;
    if (!lead) {
      const { data: insertedLead, error: insertError } = await db
        .from("leads")
        .insert({
          name: testName,
          phone: testPhone,
          email: testEmail,
          source: "website",
          stage: "new_lead",
          person_role: "applicant",
          notes: "Temporary Razorpay payment gateway UAT lead.",
          skip_ai_call: true,
          source_history: [
            {
              source: "website",
              timestamp: new Date().toISOString(),
              data: "Razorpay UAT apply portal password login",
            },
          ],
        })
        .select("id, name, phone")
        .single();
      if (insertError) return json({ error: insertError.message }, 500);
      lead = insertedLead;
    }

    if (lead?.id) {
      await db.from("lead_activities").insert({
        lead_id: lead.id,
        type: "system",
        description: "Razorpay UAT password login used on apply portal",
      });
    }

    return json({
      success: true,
      phone: lead?.phone || testPhone,
      name: lead?.name || testName,
      lead_id: lead?.id || null,
    });
  } catch (err) {
    console.error("[apply-portal-password-login]", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return json({ error: message }, 500);
  }
});
