import { MIRAI_TEMPLATES } from "./mirai-templates.ts";
import { MIRAI_PHONE_NUMBER_ID } from "./mirai-brand.ts";

const keys = ["apply_portal_login", "student_admitted_welcome", "student_portal_invite", "application_completion_reminder"];

/** Edit the allowlisted Mirai templates after rejection or reminder recategorization, retaining IDs and contracts. */
export async function resubmitMiraiTemplate(db: any, body: any,
  secret: (name: string) => string | undefined, request: typeof fetch = fetch) {
  const template = keys.map(key => MIRAI_TEMPLATES[key]).find(t => t.name === body.name);
  if (!template || !body.waba_id) throw new Error("Only the allowlisted Mirai utility templates may be resubmitted");
  const { data: channels, error: senderError } = await db.from("whatsapp_channels")
    .select("waba_id,secret_token_name").eq("provider", "meta").eq("is_active", true)
    .eq("meta_phone_number_id", MIRAI_PHONE_NUMBER_ID);
  if (senderError || channels?.length !== 1 || channels[0].waba_id !== body.waba_id) {
    throw new Error("Resubmission requires the exact active Mirai sender and WABA");
  }
  const token = channels[0].secret_token_name && secret(channels[0].secret_token_name);
  if (!token) throw new Error("Mirai's own API token is missing; no fallback is allowed");
  const { data: row, error } = await db.from("whatsapp_templates")
    .select("meta_template_id").eq("name", template.name).eq("language", "en")
    .eq("waba_id", body.waba_id).maybeSingle();
  if (error || !row?.meta_template_id || !/^\d+$/.test(row.meta_template_id)) {
    throw new Error("Saved Mirai template ID is missing");
  }
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  // Verify membership with Meta, rather than trusting an ID supplied by a caller.
  const query = new URLSearchParams({ name: template.name, fields: "id,name,language,status,category,components" });
  const lookup = await request(`https://graph.facebook.com/v21.0/${body.waba_id}/message_templates?${query}`, { headers });
  const listing = await lookup.json();
  if (!lookup.ok) throw new Error("Could not verify template ownership with Meta");
  const remote = listing.data?.find((t: any) => String(t.id) === row.meta_template_id && t.name === template.name && t.language === "en");
  if (!remote) throw new Error("Template does not belong to Mirai's WABA");
  const samples: Record<string, string> = { student_name: "Sample Parent", expiry: "15 Oct 2026, 6:00 PM IST",
    admission_no: "MIRAI-2026-0001", course_name: "Grade 3", application_id: "APP-MIRAI-2026-0001" };
  const components = [{ type: "BODY", text: template.body,
    example: { body_text: [template.params.map(p => samples[p])] } },
    { type: "BUTTONS", buttons: [{ type: "URL", ...template.button,
      ...(template.button!.url.includes("{{1}}") ? { example: [template.button!.url.replace("{{1}}", "sample-token")] } : {}) }] }];
  const matches = remote.category === "UTILITY" && remote.components?.find((c: any) => c.type === "BODY")?.text === template.body;
  const recategorizedReminder = template === MIRAI_TEMPLATES.application_completion_reminder
    && remote.status === "APPROVED" && remote.category === "MARKETING";
  if (remote.status !== "REJECTED" && !recategorizedReminder) {
    if (matches && ["PENDING", "APPROVED"].includes(remote.status)) {
      return { success: true, already_reviewed: true, status: remote.status };
    }
    throw new Error("Only rejected templates may be edited; sync and review their current status");
  }
  const edit = await request(`https://graph.facebook.com/v21.0/${row.meta_template_id}`, {
    method: "POST", headers, body: JSON.stringify({ category: "UTILITY", components }),
  });
  const result = await edit.json();
  if (!edit.ok || !result.success) throw new Error(result?.error?.error_user_msg || result?.error?.message || "Meta rejected the template edit");
  const { error: mirrorError } = await db.from("whatsapp_templates").update({
    category: "UTILITY", status: "PENDING", components, reject_reason: null,
    submitted_at: new Date().toISOString(), status_updated_at: new Date().toISOString(),
  }).eq("meta_template_id", row.meta_template_id).eq("waba_id", body.waba_id).eq("language", "en");
  if (mirrorError) throw new Error("Meta accepted the edit but local sync is required before retrying");
  return { success: true, status: "PENDING", meta_template_id: row.meta_template_id };
}
