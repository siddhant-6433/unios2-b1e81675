import { MIRAI_APP_BASE } from "./mirai-brand.ts";

export interface MiraiTemplate {
  name: string;
  category: "UTILITY";
  language: "en";
  body: string;
  params: string[];
  header?: "DOCUMENT";
  button?: { text: string; url: string };
}

function define(key: string, body: string, params: string[], options: Pick<MiraiTemplate, "header" | "button"> = {}): MiraiTemplate {
  return { name: `mirai_${key}_v1`, category: "UTILITY", language: "en", body, params, ...options };
}
const applyButton = { text: "Open Application", url: `${MIRAI_APP_BASE}/apply?token={{1}}` };
const staticApplyButton = { text: "Open Application", url: `${MIRAI_APP_BASE}/apply` };

// Keys are the existing internal event contracts. Aliases share one definition.
export const MIRAI_TEMPLATES: Record<string, MiraiTemplate> = {
  apply_portal_login: define("apply_portal_login", "Hi {{1}}, this is the access link for your existing Mirai School application. Use it to view your application details, uploaded documents and payment records. Link expiry: {{2}}.\n\nMirai School Admissions", ["student_name", "expiry"], { button: applyButton }),
  applicant_welcome: define("applicant_welcome", "Hi {{1}}, your application at Mirai School has been started.\nApplication ID: {{2}}\nGrade / programme: {{3}}\n\nOpen the portal to complete your application.\nMirai School Admissions", ["name", "application_id", "course"], { button: staticApplyButton }),
  application_completion_reminder: define("application_completion_reminder", "Hi {{1}}, required applicant information is outstanding in your Mirai School application {{2}}. Our admissions team needs this information to process the application. Please review the required fields in your application record and provide the missing details using the button below.\n\nMirai School Admissions", ["student_name", "application_id"], { button: staticApplyButton }),
  application_submitted: define("application_submitted", "Hi {{1}}, Mirai School has received your application {{2}}. A copy is attached. Our admissions team will review it and update you.\n\nMirai School Admissions", ["student_name", "application_id"], { header: "DOCUMENT" }),
  application_approved: define("application_approved", "Hi {{1}}, your Mirai School application {{2}} for {{3}} has been approved. Open the portal to review your next steps.\n\nMirai School Admissions", ["student_name", "application_id", "course_name"], { button: applyButton }),
  application_rejected: define("application_rejected", "Hi {{1}}, we have an update on your Mirai School application {{2}}. We are unable to proceed for this reason: {{3}}. Please reply if you need clarification.\n\nMirai School Admissions", ["student_name", "application_id", "reason"]),
  app_fee_receipt: define("app_fee_receipt", "Hi {{1}}, Mirai School has received your application fee of Rs. {{2}} for application {{3}}. Your receipt is attached.\n\nMirai School Admissions", ["student_name", "amount", "application_id"], { header: "DOCUMENT" }),
  offer_letter_issued: define("offer_letter_issued", "Hi {{1}}, your Mirai School offer for {{2}} is ready.\nNet fee: Rs. {{3}}\nAccept by: {{4}}\n\nOpen the portal to view your offer and complete the next steps.\nMirai School Admissions", ["student_name", "course_name", "net_fee", "deadline"], { button: applyButton }),
  offer_letter_acceptance: define("offer_letter_acceptance", "Hi {{1}}, Mirai School has issued your offer for {{2}}.\nNet fee: Rs. {{3}}\nAccept by: {{4}}\n\nView and accept your offer using the button below.\nMirai School Admissions", ["student_name", "course_name", "net_fee", "deadline"], { button: { text: "View Offer", url: `${MIRAI_APP_BASE}/apply/offer/{{1}}` } }),
  token_fee_reminder: define("token_fee_reminder", "Hi {{1}}, a reminder about your Mirai School offer for {{2}}: your token fee of Rs. {{3}} is due in {{4}}. Open the portal to complete payment.\n\nMirai School Admissions", ["student_name", "course_name", "amount", "time_left"], { button: applyButton }),
  admission_payment_nudge: define("admission_payment_nudge", "Hi {{1}}, regarding your Mirai School admission for {{2}}:\nPayment required to issue your admission number: Rs. {{3}}\nRemaining first-year balance: Rs. {{4}}\nDue date: {{5}}\n\nPlease open your application portal to complete payment.\nMirai School Admissions", ["student_name", "course_name", "an_amount", "year1_amount", "due_date"]),
  pan_nudge_balance: define("pan_nudge_balance", "Hi {{1}}, your Mirai School pre-admission number is {{2}}. The remaining payment required for your admission number is Rs. {{3}}. Open the portal to complete payment.\n\nMirai School Admissions", ["student_name", "pre_admission_no", "balance_amount"], { button: applyButton }),
  payment_link_request: define("payment_link_request", "Hi {{1}}, here is your Mirai School payment link for {{2}} of Rs. {{3}}. The link is valid until {{4}}. Your receipt will be generated after payment.\n\nMirai School", ["student_name", "purpose_label", "amount", "valid_till"], { button: { text: "Pay Now", url: `${MIRAI_APP_BASE}/pay/{{1}}` } }),
  payment_receipt: define("payment_receipt", "Hi {{1}}, Mirai School has received your payment of Rs. {{3}} towards {{2}}.\nReceipt number: {{4}}\nDownload: {{5}}\n\nMirai School", ["student_name", "payment_type", "amount", "receipt_no", "download_url"]),
  payment_receipt_pdf: define("payment_receipt_pdf", "Hi {{1}}, Mirai School has received your payment of Rs. {{3}} towards {{2}}.\nReceipt number: {{4}}\nYour receipt is attached.\n\nMirai School", ["student_name", "payment_type", "amount", "receipt_no"], { header: "DOCUMENT" }),
  document_request: define("document_request", "Hi {{1}}, please upload the following documents for your Mirai School application: {{2}}. Open the application portal to upload them.\n\nMirai School Admissions", ["student_name", "documents"], { button: staticApplyButton }),
  doc_rejected: define("doc_rejected", "Hi {{1}}, your Mirai School application document {{2}} needs an update.\nReason: {{3}}\n\nPlease upload the corrected document in the application portal.\nMirai School Admissions", ["student_name", "doc_name", "reason"], { button: staticApplyButton }),
  student_welcome: define("student_welcome", "Hi {{1}}, welcome to Mirai School.\nAdmission number: {{2}}\nGrade / programme: {{3}}\nCampus: {{4}}\n\nYou can now sign in to your school portal.", ["name", "admission_no", "course", "campus"], { button: { text: "Open School Portal", url: MIRAI_APP_BASE } }),
  student_admitted_welcome: define("student_admitted_welcome", "Hi {{1}}, your admission at Mirai School has been confirmed.\nAdmission number: {{2}}\nGrade / programme: {{3}}\n\nYour admission record is available in the school portal.\nMirai School Admissions", ["student_name", "admission_no", "course_name"], { button: { text: "Open School Portal", url: MIRAI_APP_BASE } }),
  student_portal_invite: define("student_portal_invite", "Hi {{1}}, a student portal account has been created for your confirmed Mirai School admission.\nAdmission number: {{2}}\n\nUse the link below to complete account setup and access your school records.\nMirai School", ["student_name", "admission_no"], { button: { text: "Access School Portal", url: `${MIRAI_APP_BASE}/student?token={{1}}` } }),
};
MIRAI_TEMPLATES.application_received = MIRAI_TEMPLATES.application_submitted;
MIRAI_TEMPLATES.app_fee_receipt_pdf = MIRAI_TEMPLATES.app_fee_receipt;

export function uniqueMiraiTemplates(): MiraiTemplate[] {
  return [...new Map(Object.values(MIRAI_TEMPLATES).map(t => [t.name, t])).values()];
}

export function miraiTemplateForKey(key: string): MiraiTemplate | undefined {
  return MIRAI_TEMPLATES[key] ?? Object.values(MIRAI_TEMPLATES).find(t => t.name === key);
}

export function miraiButtonValues(template: MiraiTemplate, values: string[] = []): string[] {
  if (!template.button?.url.includes("{{1}}")) return [];
  return values.map(value => {
    if (!/^https?:\/\//i.test(value)) return value;
    const url = new URL(value);
    if (!["uni.nimt.ac.in", "apply.nimt.ac.in", "uni.miraischool.in"].includes(url.hostname)) throw new Error("Unexpected portal button URL");
    return url.searchParams.get("token") || url.pathname.split("/").filter(Boolean).pop() || "";
  });
}

/** A utility information request is allowed only for an actual incomplete record. */
export function hasMissingMiraiApplicantInformation(application: {
  status?: string; full_name?: string | null; dob?: string | null; gender?: string | null;
} | null): boolean {
  return application?.status === "draft" && [application.full_name, application.dob, application.gender]
    .some(value => !value?.trim());
}

function normalizedButtonUrl(value: unknown): string | null {
  try { return typeof value === "string" ? new URL(value).href : null; }
  catch { return null; }
}

export function validateMiraiTemplate(template: MiraiTemplate, row: any, wabaId: string): string | null {
  if (!row || row.status !== "APPROVED") return `Mirai template ${template.name} is not approved. Sync templates and retry.`;
  if (row.category !== "UTILITY") return "Mirai lifecycle template is not approved in the utility category";
  if (row.waba_id !== wabaId || row.language !== template.language) return "Mirai template belongs to a different account or language";
  if (row.placeholder_count !== template.params.length) return "Mirai template parameter contract has changed";
  const components = Array.isArray(row.components) ? row.components : [];
  const header = components.find((c: any) => c.type === "HEADER");
  if ((header?.format || undefined) !== template.header) return "Mirai template header contract has changed";
  const body = components.find((c: any) => c.type === "BODY");
  if (body?.text !== template.body) return "Mirai template copy does not match the reviewed version";
  const buttons = components.find((c: any) => c.type === "BUTTONS")?.buttons || [];
  if (template.button) {
    if (buttons.length !== 1 || buttons[0].type !== "URL" || normalizedButtonUrl(buttons[0].url) !== normalizedButtonUrl(template.button.url)) return "Mirai template portal button does not match the reviewed version";
  } else if (buttons.length) return "Mirai template has unexpected buttons";
  return null;
}
