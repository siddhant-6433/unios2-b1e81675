// Bulk-safe WhatsApp template metadata. Drives the Lists send dialog UI:
// which templates show up, what label they have, what params they need.
//
// Params resolved per-lead from the leads → courses → campuses join inside
// whatsapp-campaign-send (the edge function). Anything else is "static" — the
// counsellor types one value at campaign-creation time and it's applied to
// every recipient.
//
// Keep the keys in sync with TEMPLATES in supabase/functions/whatsapp-campaign-send/index.ts.

import { cahetDeadlineMessage, effectiveCahetWhatsAppDeadlineText } from "@/lib/deadlineRollover";

const cahetDeadlineText = effectiveCahetWhatsAppDeadlineText();
const cahetBulkDescription = cahetDeadlineText.prefix
  ? `Tells BPT/BMRIT applicants about the updated deadline to submit both NIMT and CAHET forms by ${cahetDeadlineText.descriptionDate}.`
  : `Tells BPT/BMRIT applicants to submit both NIMT and CAHET forms by ${cahetDeadlineText.descriptionDate}.`;

export type WaParamSource = "auto" | "static";

export interface WaBulkTemplate {
  key: string;            // template_key written to whatsapp_campaigns.template_key
  label: string;          // human label for the picker
  description?: string;   // optional one-liner shown under the picker
  preview: string;        // BODY preview with named placeholders.
  params: { name: string; source: WaParamSource; placeholder?: string; help?: string }[];
}

export const AUTO_FILLED_PARAMS = ["student_name", "course_name", "campus_name"] as const;

const cnetNotQualifiedBptBmritPreview =
  "Dear {{student_name}}\n\nCNET result is declared. If you have NOT qualified, you can still choose healthcare career options: *BPT* or *BMRIT*.\n\nLast date: *14th June 2026*.\n\nBoth are mandatory:\n1. NIMT application: https://apply.nimt.ac.in\n2. *ABVMUP CAHET registration by 14th June, 11:59 PM*: https://www.abvmucet26.co.in/entrance2026/login?form=4\n\nHelp: 7428499849, 9667691872, 9555192192\n\n---\n\nप्रिय {{student_name}}\n\nCNET result आ गया है। यदि आप qualify नहीं हुए हैं, तब भी healthcare career के लिए *BPT* या *BMRIT* option है।\n\nLast date: *14th June 2026*.\n\nदोनों mandatory हैं:\n1. NIMT application: https://apply.nimt.ac.in\n2. *ABVMUP CAHET registration by 14th June, 11:59 PM*: https://www.abvmucet26.co.in/entrance2026/login?form=4\n\nHelp: 7428499849, 9667691872, 9555192192";
const cuet2026CounsellingOpenPreview =
  "The CUET 2026 result is out, and admission counselling is now open at NIMT.\n\nIf you're planning your next step after CUET, we're here to help.\n\nDuring your counselling session, our admission expert will guide you with:\n\n• Choosing the right course for your career goals\n• Scholarship opportunities based on your CUET score\n• Admission process, eligibility, fees, and required documents\n• Placements, internships, and career opportunities\n\nWe look forward to helping you build a successful future.\n\nTeam NIMT Educational Institutions";
const cuetCounsellingBookingPreview =
  "CUET counselling booking is now open at NIMT. Share this approved Meta template with CUET leads so they can book a counselling session with the admissions team.";

export const WA_BULK_TEMPLATES: WaBulkTemplate[] = [
  {
    key: "lead_welcome",
    label: "Lead Welcome",
    description: "Greets the lead by name and mentions their course of interest.",
    preview: "Hi {{student_name}}, welcome to NIMT Educational Institutions! We're excited about your interest in {{course_name}}. Our counsellor will connect with you shortly to guide you through the admission process.",
    params: [
      { name: "student_name", source: "auto" },
      { name: "course_name",  source: "auto" },
    ],
  },
  {
    key: "course_details",
    label: "Course Details",
    description: "Shares course info — uses lead name + course they enquired about.",
    preview: "Hi {{student_name}}, thank you for your interest in {{course_name}} at NIMT Educational Institutions. Our counsellor will share course details, eligibility, fees, and admission next steps with you.",
    params: [
      { name: "student_name", source: "auto" },
      { name: "course_name",  source: "auto" },
    ],
  },
  {
    key: "visit_confirmation",
    label: "Visit Confirmation",
    description: "Confirms a scheduled visit — pick a single visit date applied to all leads.",
    preview: "Hi {{student_name}}, your campus visit is confirmed for {{visit_date}} at {{campus_name}}. We look forward to welcoming you! Please carry a valid ID.",
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
    preview: "Hi {{student_name}}, this is a reminder that your campus visit is scheduled for {{visit_date}}. See you soon!",
    params: [
      { name: "student_name", source: "auto" },
      { name: "visit_date",   source: "static", placeholder: "e.g. Tomorrow, 11:00 AM" },
    ],
  },
  {
    key: "fee_reminder",
    label: "Fee Reminder",
    description: "Reminds leads to clear a pending fee — both amount and due date are applied to all leads.",
    preview: "Hi {{student_name}}, this is a reminder that your fee of Rs. {{amount}} is due by {{due_date}}. Please complete the payment to secure your seat.",
    params: [
      { name: "student_name", source: "auto" },
      { name: "amount",       source: "static", placeholder: "e.g. ₹5,000" },
      { name: "due_date",     source: "static", placeholder: "e.g. 5 Jun 2026" },
    ],
  },
  {
    key: "bpt_bmrit_cahet_deadline",
    label: "BPT/BMRIT CAHET Deadline",
    description: cahetBulkDescription,
    preview: cahetDeadlineMessage(),
    params: [],
  },
  {
    key: "cnet_not_qualified_bpt_bmrit",
    label: "CNET Not Qualified → BPT/BMRIT",
    description: "Bilingual CNET result follow-up for candidates who did not qualify, with BPT/BMRIT and CAHET instructions.",
    preview: cnetNotQualifiedBptBmritPreview,
    params: [
      { name: "student_name", source: "auto" },
    ],
  },
  {
    key: "cuet_2026_counselling_open",
    label: "CUET 2026 Counselling Open",
    description: "CUET result follow-up with counselling guidance and image header.",
    preview: cuet2026CounsellingOpenPreview,
    params: [],
  },
  {
    key: "cuet_counselling_booking",
    label: "CUET Counselling Booking",
    description: "CUET counselling booking template approved in Meta.",
    preview: cuetCounsellingBookingPreview,
    params: [],
  },
  {
    key: "application_received",
    label: "Application Received",
    description: "For bulk this defaults to a placeholder application ID — only useful when you've already created applications.",
    preview: "Hi {{student_name}}, we've received your application (ID: {{application_id}}). Our admissions team will review it and get back to you shortly.",
    params: [
      { name: "student_name",   source: "auto" },
      { name: "application_id", source: "static", placeholder: "e.g. NIMT-2026-001" },
    ],
  },
];
