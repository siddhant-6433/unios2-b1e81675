/**
 * Preview, submit, or verify the Mirai catalogue through the existing admin API.
 * No messages are sent and this tool never enables rollout.
 * deno run --allow-env --allow-net scripts/mirai-templates.ts preview|submit|check
 */
import { uniqueMiraiTemplates, validateMiraiTemplate } from "../supabase/functions/_shared/mirai-templates.ts";
import { MIRAI_PHONE_NUMBER_ID } from "../supabase/functions/_shared/mirai-brand.ts";

const action = Deno.args[0] || "preview";
const templates = uniqueMiraiTemplates();
const exampleFor = (param: string) => ({
  student_name: "Sample Parent", name: "Sample Parent", expiry: "15 Oct 2026, 6:00 PM IST",
  application_id: "APP-26-SAMPLE", course: "Grade 3", course_name: "Grade 3",
  amount: "1000", net_fee: "100000", deadline: "15 Oct 2026", time_left: "2 days",
  an_amount: "1000", year1_amount: "5000", due_date: "15 Oct 2026",
  pre_admission_no: "PAN-SAMPLE", purpose_label: "School fees", valid_till: "15 Oct 2026",
  payment_type: "School fees", receipt_no: "SAMPLE-RECEIPT", download_url: "https://uni.miraischool.in/apply",
  documents: "Birth certificate", doc_name: "Birth certificate", reason: "The uploaded copy is not readable",
  admission_no: "SAMPLE-ADMISSION", campus: "Mirai School",
} as Record<string, string>)[param] || "Sample value";

const definitions = templates.map(template => ({
  name: template.name, category: template.category, language: template.language,
  body_text: template.body, body_examples: template.params.map(exampleFor),
  ...(template.header ? { header_format: template.header } : {}),
  ...(template.button ? { buttons: [{ type: "URL", ...template.button,
    ...(template.button.url.includes("{{1}}") ? { example: template.button.url.replace("{{1}}", "sample-token") } : {}),
  }] } : {}),
}));

if (action === "preview") {
  console.log(JSON.stringify(definitions, null, 2));
  Deno.exit(0);
}
if (!["check", "submit"].includes(action)) throw new Error("Use preview, submit, or check");
const base = Deno.env.get("SUPABASE_URL");
const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
if (!base || !key) throw new Error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
async function api(path: string, body?: unknown) {
  const requestKey = path.startsWith("/functions/") ? Deno.env.get("SUPABASE_AUTOMATION_KEY") || key! : key!;
  const res = await fetch(`${base}${path}`, {
    method: body ? "POST" : "GET",
    headers: { apikey: requestKey, Authorization: `Bearer ${requestKey}`, "Content-Type": "application/json",
      ...(Deno.env.get("CRON_SECRET") ? { "x-cron-secret": Deno.env.get("CRON_SECRET")! } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`API request failed (${res.status}): ${data.error || data.message || "request rejected"}`);
  return data;
}
const senders = await api(`/rest/v1/whatsapp_channels?select=waba_id,meta_phone_number_id&is_active=eq.true&provider=eq.meta&meta_phone_number_id=eq.${MIRAI_PHONE_NUMBER_ID}`);
if (senders.length !== 1 || !senders[0].waba_id) throw new Error("Configure exactly one active Mirai sender with its verified WABA");
const wabaId = senders[0].waba_id;
await api("/functions/v1/whatsapp-templates", { action: "sync", waba_id: wabaId });
const rows = await api(`/rest/v1/whatsapp_templates?select=name,status,reject_reason,language,waba_id,placeholder_count,components&waba_id=eq.${wabaId}&name=like.mirai_*`);
if (action === "check") {
  let failures = 0;
  for (const template of templates) {
    const row = rows.find((r: any) => r.name === template.name && r.language === template.language);
    const issue = validateMiraiTemplate(template, row, wabaId);
    console.log(`${template.name}: ${issue ? `${row?.status || "MISSING"}: ${row?.reject_reason || issue}` : "APPROVED, matching contract and Mirai WABA"}`);
    if (issue) failures++;
  }
  console.log(`Mirai sender verified: ${MIRAI_PHONE_NUMBER_ID}. ${templates.length - failures}/${templates.length} templates ready. Rollout remains unchanged.`);
  Deno.exit(failures ? 1 : 0);
}
// Meta needs an uploaded sample-document handle for document templates.
const headerHandle = Deno.env.get("MIRAI_TEMPLATE_DOCUMENT_HANDLE");
const needsDocument = definitions.some(t => t.header_format && !rows.some((r: any) => r.name === t.name));
if (needsDocument && !headerHandle) throw new Error("Set MIRAI_TEMPLATE_DOCUMENT_HANDLE to an uploaded, non-personal sample PDF handle before submission");
for (const definition of definitions) {
  const existing = rows.find((r: any) => r.name === definition.name && r.language === definition.language);
  if (existing) {
    console.log(`${definition.name}: already ${existing.status}; skipped (no duplicate submission)`);
    continue;
  }
  await api("/functions/v1/whatsapp-templates", { action: "create", waba_id: wabaId, ...definition,
    ...(definition.header_format ? { header_handle: headerHandle } : {}),
  });
  console.log(`${definition.name}: submitted to Mirai WABA; approval pending`);
}
