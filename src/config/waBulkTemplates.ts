// Bulk-safe WhatsApp template metadata. Drives the Lists send dialog UI:
// which templates show up, what label they have, what params they need.
//
// Params resolved per-lead from the leads → courses → campuses join inside
// whatsapp-campaign-send (the edge function). Anything else is "static" — the
// counsellor types one value at campaign-creation time and it's applied to
// every recipient.
//
// Keep the keys in sync with TEMPLATES in supabase/functions/whatsapp-campaign-send/index.ts.

export type WaParamSource = "auto" | "static";

export interface WaBulkTemplate {
  key: string;            // template_key written to whatsapp_campaigns.template_key
  label: string;          // human label for the picker
  description?: string;   // optional one-liner shown under the picker
  params: { name: string; source: WaParamSource; placeholder?: string; help?: string }[];
}

export const AUTO_FILLED_PARAMS = ["student_name", "course_name", "campus_name"] as const;

export const WA_BULK_TEMPLATES: WaBulkTemplate[] = [
  {
    key: "lead_welcome",
    label: "Lead Welcome",
    description: "Greets the lead by name and mentions their course of interest.",
    params: [
      { name: "student_name", source: "auto" },
      { name: "course_name",  source: "auto" },
    ],
  },
  {
    key: "course_details",
    label: "Course Details",
    description: "Shares course info — uses lead name + course they enquired about.",
    params: [
      { name: "student_name", source: "auto" },
      { name: "course_name",  source: "auto" },
    ],
  },
  {
    key: "visit_confirmation",
    label: "Visit Confirmation",
    description: "Confirms a scheduled visit — pick a single visit date applied to all leads.",
    params: [
      { name: "student_name", source: "auto" },
      { name: "visit_date",   source: "static", placeholder: "e.g. Sun, 1 Jun · 11:00 AM", help: "Same date applied to every lead in this campaign." },
      { name: "campus_name",  source: "auto" },
    ],
  },
  {
    key: "visit_reminder_24hr",
    label: "Visit Reminder (24h)",
    description: "24-hour reminder for an upcoming visit.",
    params: [
      { name: "student_name", source: "auto" },
      { name: "visit_date",   source: "static", placeholder: "e.g. Tomorrow, 11:00 AM" },
    ],
  },
  {
    key: "fee_reminder",
    label: "Fee Reminder",
    description: "Reminds leads to clear a pending fee — both amount and due date are applied to all leads.",
    params: [
      { name: "student_name", source: "auto" },
      { name: "amount",       source: "static", placeholder: "e.g. ₹5,000" },
      { name: "due_date",     source: "static", placeholder: "e.g. 5 Jun 2026" },
    ],
  },
  {
    key: "application_received",
    label: "Application Received",
    description: "For bulk this defaults to a placeholder application ID — only useful when you've already created applications.",
    params: [
      { name: "student_name",   source: "auto" },
      { name: "application_id", source: "static", placeholder: "e.g. NIMT-2026-001" },
    ],
  },
];
