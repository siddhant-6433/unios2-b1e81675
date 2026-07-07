import { useState, useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { invokeEdge } from "@/integrations/supabase/edge";
import { useAuth } from "@/contexts/AuthContext";
import { useCounsellorFilter } from "@/contexts/CounsellorFilterContext";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  MessageSquare, Search, Send, Loader2, User, Clock, ExternalLink, ArrowLeft,
  FileDown, AlertTriangle, LayoutTemplate, X, Check, ChevronDown, Zap, Ban, Settings,
  ThumbsDown, AlertOctagon, ThumbsUp, CalendarPlus, Bot, Cpu, CheckCheck, CircleCheck,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { SelectField } from "@/components/ui/state-fields";
import {
  cahetDeadlineDescription,
  cahetDeadlineMessage,
} from "@/lib/deadlineRollover";
import { resolveLeadTransitionCommand, type WorkflowLeadTransitionCommandName } from "@/lib/leadTransitions";
import { applyResolvedLeadTransition } from "@/lib/leadTransitionCommands";
import {
  inferWhatsAppTemplateCategory,
  normalizeRenderedWhatsAppTemplate,
  renderWhatsAppTemplate,
  type RenderedWhatsAppTemplate,
  type WhatsAppTemplateDefinition,
} from "@/lib/whatsappTemplateRender";
import nimtLogo from "@/assets/nimt-edu-inst-logo.svg";

const CONVERSATION_PAGE_SIZE = 120;

const TEMPLATE_MESSAGE_TEXTS: Record<string, string> = {
  lead_welcome:
    "Hi {{student_name}}, thank you for your interest in {{course_name}} at NIMT Educational Institutions. Your inquiry was received from {{lead_source}}. Our admissions team will get in touch with you shortly.",
  visit_confirmation:
    "Hi {{student_name}}, your campus visit has been scheduled for {{visit_date}} at {{campus_name}}. We look forward to seeing you! Please carry a valid ID.",
  visit_reminder_24hr:
    "Hi {{student_name}}, this is a reminder that your campus visit is scheduled for {{visit_date}} at {{campus_name}}. We look forward to seeing you!",
  application_received:
    "Hi {{student_name}}, we have received your application (ID: {{application_id}}). Our admissions team will review it and get back to you shortly.",
  fee_reminder:
    "Hi {{student_name}}, this is a reminder that a fee payment of Rs.{{amount}} is due by {{due_date}}. Please complete the payment to avoid any delays.",
  bpt_bmrit_cahet_deadline: cahetDeadlineMessage(),
  cnet_not_qualified_bpt_bmrit:
    "Dear {{student_name}}\n\nCNET result is declared. If you have NOT qualified, you can still choose healthcare career options: *BPT* or *BMRIT*.\n\nLast date: *14th June 2026*.\n\nBoth are mandatory:\n1. NIMT application: https://apply.nimt.ac.in\n2. *ABVMUP CAHET registration by 14th June, 11:59 PM*: https://www.abvmucet26.co.in/entrance2026/login?form=4\n\nHelp: 7428499849, 9667691872, 9555192192\n\n---\n\nप्रिय {{student_name}}\n\nCNET result आ गया है। यदि आप qualify नहीं हुए हैं, तब भी healthcare career के लिए *BPT* या *BMRIT* option है।\n\nLast date: *14th June 2026*.\n\nदोनों mandatory हैं:\n1. NIMT application: https://apply.nimt.ac.in\n2. *ABVMUP CAHET registration by 14th June, 11:59 PM*: https://www.abvmucet26.co.in/entrance2026/login?form=4\n\nHelp: 7428499849, 9667691872, 9555192192",
  course_info_generic:
    "Hi {{student_name}}, thanks for your interest in NIMT Educational Institutions. We offer programmes in nursing, paramedical, pharma, management, education, law, and engineering across our Greater Noida, Ghaziabad, and Kotputli campuses. Browse the full list, fees, and eligibility on our website. Reply STOP to opt out.",
  course_info_v4:
    "Hi {{student_name}}, here are the details for {{course_name}} at NIMT Educational Institutions:\n\nDuration: {{duration}}\nEligibility: {{eligibility}}\nApproval: {{approval}}\nCourse video: {{video_url}}\n\nOpen the course page below for fees and application steps. Reply STOP to opt out.",
  course_info_video_v2:
    "Hi {{student_name}}, here are the details you requested for {{course_name}} at NIMT Educational Institutions:\n\nCourse information: {{course_url}}\nCampus locations: {{campus_url}}\nApplication portal: {{apply_url}}\n\nReply to this message if you have any questions - our admissions team will be glad to assist you.",
  missed_call:
    "Dear {{student_name}}, the admissions office at NIMT Educational Institutions attempted to reach you regarding {{course_name}}. We were unable to connect on the call. You may reach us by replying to this message or by calling the admissions office during working hours. A counsellor will attempt to contact you again.",
  callback_scheduled:
    "Dear {{student_name}}, thank you for your time regarding {{course_name}} at NIMT Educational Institutions. As per your request, a counsellor from the admissions office will reach out to you at a suitable time. If you need to reschedule or have any queries, please reply to this message. We are happy to assist you.",
  apply_portal_login:
    "Hi {{student_name}}, your secure login link for the NIMT application portal is ready. Tap the button below to complete your application or pay your token fee directly - no OTP needed. The link is valid until {{due_date}}, so please use it before it expires.",
  student_welcome:
    "Congratulations {{student_name}}!\n\nWelcome to NIMT Educational Institutions.\n\nAdmission No: {{application_id}}\nCourse: {{course_name}}\nCampus: {{campus_name}}\n\nYou can access the student portal at https://uni.nimt.ac.in\n\nWe wish you a great academic journey ahead!",
  application_submitted:
    "Hi {{student_name}}, your application ({{application_id}}) has been received. Please pay the application fee to begin processing. The completed form PDF is attached for your records.",
  app_fee_receipt:
    "Hi {{student_name}}, we've received your application fee of Rs.{{amount}}. Application: {{application_id}}. Receipt PDF is attached. Our admissions team will reach out for the next steps.",
  app_fee_receipt_pdf:
    "Hi {{student_name}}, we've received your application fee of Rs.{{amount}}. Application: {{application_id}}. Receipt PDF is attached. Our admissions team will reach out for the next steps.",
  offer_letter_issued:
    "Congratulations {{student_name}}! You have been offered admission to {{course_name}}. Net fee: Rs.{{amount}}. Please accept by {{due_date}}. Tap below to view the offer letter and pay your token fee online.",
  pan_nudge_balance:
    "Hi {{student_name}}, your pre-admission number is {{application_id}}. Pay the balance of Rs.{{amount}} to confirm enrollment and receive your Admission Number. Tap below to pay online.",
  payment_receipt:
    "Dear {{student_name}}, payment of Rs.{{amount}} received. Receipt no: {{application_id}}. The receipt PDF is attached for your records.",
  payment_receipt_pdf:
    "Dear {{student_name}}, payment of Rs.{{amount}} received towards {{course_name}}. Receipt no: {{application_id}}. The receipt PDF is attached for your records.",
  doc_rejected:
    "Hi {{student_name}}, your uploaded document needs attention. Please re-upload a corrected version in the apply portal so your admission can proceed.",
  application_rejected:
    "Dear {{student_name}}, after review we are unable to proceed with your application {{application_id}}. Please contact our admissions office if you'd like to discuss alternatives.",
  application_approved:
    "Congratulations {{student_name}}! Your application {{application_id}} for {{course_name}} has been approved. Our admissions team will be in touch with your offer letter shortly. Tap below to track your application in the apply portal.",
  applicant_welcome:
    "Hi {{student_name}}, thank you for starting your application at NIMT Educational Institutions!\n\nYour Application ID: {{application_id}}\nCourse: {{course_name}}\n\nComplete your application at https://uni.nimt.ac.in/apply/nimt/\n\nOur admissions team is here to help. Feel free to reach out anytime!",
  ai_call_course_info:
    "Hi {{student_name}}, thank you for speaking with us about {{course_name}} at NIMT Educational Institutions!\n\nCampus: {{campus_name}}\n\nCourse Details: {{course_url}}\nApply Now: {{apply_url}}\n\nFor questions, reply to this message or call our admissions team.\n\nWe look forward to welcoming you!",
  ai_call_post_summary:
    "Hi {{student_name}}, as discussed on our call, here are the details for {{course_name}} at NIMT Educational Institutions:\n\nCampus: {{campus_name}}\nCourse details: {{course_url}}\nApply now: {{apply_url}}\nWatch course video: {{video_url}}\n\nReply to this message for any questions, or our admissions team will reach out shortly.",
  ai_missed_call_followup:
    "Hi {{student_name}}, this is Navya from NIMT Educational Institutions. I tried calling you regarding your enquiry about {{course_name}}.\n\nPlease feel free to call back at 9555192192 during 9 AM-8 PM IST.\n\nCourse information: {{course_url}}\nWatch course video: {{video_url}}\n\nLooking forward to assisting you with your admission journey.",
  course_info_v1:
    "Hi {{student_name}}, here are the details for {{course_name}} at NIMT:\n- Duration: {{duration}}\n- Eligibility: {{eligibility}}\n- Accreditation: {{approval}}\n\nWatch a short course video or view the full fees and syllabus on the course page. Reply STOP to opt out.",
  visit_reminder_v2:
    "Hi {{student_name}}, your campus visit for {{course_name}} is on {{visit_date}} at {{campus_name}}. Tap below for directions to the campus.",
  offer_letter_acceptance:
    "Congratulations {{student_name}}! NIMT has issued your offer letter for {{course_name}}. Net fee: Rs.{{amount}}. Please accept by {{due_date}}. Tap below to view your offer, accept it, and pay the token fee in one secure step.",
  nimt_not_interested_ack:
    "Hi {{student_name}}, thanks for speaking with us about {{course_name}}. We've marked your enquiry as not interested and won't reach out unless you'd like us to. Reply STOP to fully opt out.",
};

const TEMPLATE_PLACEHOLDER_RE = /^\s*(?:\[Campaign:[^\]]+\]\s*)?\[Template:\s*([^\]]+)\]\s*$/i;

interface Conversation {
  phone: string;
  lead_id: string | null;
  lead_name: string | null;
  lead_stage: string | null;
  lead_person_role: string | null;
  lead_source: string | null;
  course_name: string | null;
  last_message: string | null;
  last_direction: string;
  last_message_at: string;
  unread_count: number;
  counsellor_id: string | null;
  counsellor_name: string | null;
  has_inbound: boolean;
  provider: "meta" | "plivo" | null;
  business_phone_number_id: string | null;
  business_phone_number: string | null;
  conversation_mode: "ai" | "human" | "paused" | "closed" | null;
  conversation_state: string | null;
  owner_user_id: string | null;
  escalation_role: string | null;
  handoff_reason: string | null;
  priority: "low" | "normal" | "high" | "urgent" | null;
  sla_due_at: string | null;
  last_intent: string | null;
  last_confidence: number | null;
  last_bot_action: string | null;
  lead_counsellor_ids: string[] | null;
}

interface Message {
  id: string;
  wa_message_id?: string | null;
  direction: string;
  content: string | null;
  message_type: string;
  status: string;
  template_key: string | null;
  media_url: string | null;
  created_at: string;
  sender_user_id?: string | null;
  status_error?: any;
  render_metadata?: RenderedWhatsAppTemplate | null;
}

const mergeMessageByIdentity = (messages: Message[], incoming: Message) => {
  const incomingWaId = incoming.wa_message_id || null;
  const existingIndex = messages.findIndex(message =>
    message.id === incoming.id || (incomingWaId && message.wa_message_id === incomingWaId)
  );
  if (existingIndex === -1) return [...messages, incoming];
  return messages.map((message, index) =>
    index === existingIndex ? { ...message, ...incoming } : message
  );
};

const DeliveryReceipt = ({ status }: { status: string | null | undefined }) => {
  const normalized = (status || "sent").toLowerCase();
  if (normalized === "failed") {
    return (
      <span title="Failed by Meta" aria-label="Failed by Meta" className="inline-flex items-center text-red-600">
        <AlertOctagon className="h-3 w-3" />
      </span>
    );
  }
  if (normalized === "read") {
    return (
      <span title="Read" aria-label="Read" className="inline-flex items-center text-[#34b7f1]">
        <CheckCheck className="h-3.5 w-3.5" />
      </span>
    );
  }
  if (normalized === "delivered") {
    return (
      <span title="Delivered" aria-label="Delivered" className="inline-flex items-center text-slate-500">
        <CheckCheck className="h-3.5 w-3.5" />
      </span>
    );
  }
  if (normalized === "sent") {
    return (
      <span title="Sent by Meta" aria-label="Sent by Meta" className="inline-flex items-center text-slate-500">
        <Check className="h-3.5 w-3.5" />
      </span>
    );
  }
  if (normalized === "accepted" || normalized === "submitted") {
    return (
      <span title="Accepted by Meta" aria-label="Accepted by Meta" className="inline-flex items-center text-emerald-600">
        <CircleCheck className="h-3.5 w-3.5" />
      </span>
    );
  }
  return (
    <span title="Sending" aria-label="Sending" className="inline-flex items-center text-slate-400">
      <Clock className="h-3 w-3" />
    </span>
  );
};

interface CopilotAssistResult {
  summary: string;
  intent: string;
  draft_reply: string;
  next_action_label: string;
  next_action_reason: string;
  confidence: number;
  should_pause_ai: boolean;
  model_unavailable?: boolean;
}

interface MessageConversationSeed {
  id?: string | null;
  phone: string | null;
  lead_id: string | null;
  direction: string | null;
  content: string | null;
  created_at: string | null;
  provider: "meta" | "plivo" | null;
  business_phone_number_id: string | null;
  business_phone_number: string | null;
  is_read: boolean | null;
}

const STAGE_LABELS: Record<string, string> = {
  new_lead: "New Lead", application_in_progress: "App In Progress",
  application_fee_paid: "Fee Paid", application_submitted: "Submitted",
  offer_sent: "Offer Sent", admitted: "Admitted", rejected: "Rejected", ineligible: "Ineligible", dnc: "Do Not Contact", deferred: "Deferred (Next Session)",
};

const QUICK_REPLIES = [
  { label: "Greeting", text: "Hi! 👋 Welcome to NIMT Educational Institutions. How can I help you today?" },
  { label: "Ask course", text: "Which course are you interested in? We offer Engineering, Management, Law, Pharmacy, Nursing, Education and more." },
  { label: "Share portal", text: "You can apply online at our application portal:\nhttps://uni.nimt.ac.in/apply/nimt" },
  { label: "Fee info", text: "You can view NIMT's detailed 2026-27 fee structure here:\nhttps://nimt.ac.in/admissions/fees/\n\nPopular first-year fees include B.Sc Nursing ₹1,53,000, GNM ₹1,18,000, BPT ₹92,000, MBA ₹1,30,000, PGDM ₹2,25,000, BBA/BCA ₹75,000 and LLB ₹44,250. Merit scholarships and education loan support are available.\n\nPlease share your course and campus preference, and I can send the exact year-wise breakdown." },
  { label: "Schedule visit", text: "We'd love to have you visit our campus! 🏫 Please share your preferred date and the campus you'd like to visit." },
  { label: "Counsellor connect", text: "Our counsellor will connect with you shortly. Thank you for your patience!" },
  { label: "Documents needed", text: "For admission, please keep these documents ready:\n📄 10th & 12th marksheets\n📄 Aadhaar card\n📄 Passport-size photo\n📄 Transfer certificate" },
  { label: "Thank you", text: "Thank you for reaching out! 😊 Feel free to contact us anytime if you have more questions." },
  { label: "Campus video", text: "🎥 Here's a look at our campus and facilities:\nhttps://youtu.be/CyLpFGx67u4?si=7CepKXL3Dm2GfmaK" },
];

const INBOX_TEMPLATES: WhatsAppTemplateDefinition[] = [
  // ── Admission flow ────────────────────────────────────────────────────────
  {
    key: "lead_welcome",
    label: "Lead Welcome",
    description: "Welcome message with course info",
    params: ["student_name", "course_name", "lead_source"],
    preview: "Hi {{student_name}}, welcome to NIMT Educational Institutions! We're excited about your interest in {{course_name}}. Our counsellor will connect with you shortly to guide you through the admission process.",
  },
  {
    key: "visit_confirmation",
    label: "Visit Confirmation",
    description: "Confirm scheduled campus visit",
    params: ["student_name", "visit_date", "campus_name"],
    preview: "Hi {{student_name}}, your campus visit is confirmed for {{visit_date}} at {{campus_name}}. We look forward to welcoming you! Please carry a valid ID.",
  },
  {
    key: "visit_reminder_24hr",
    label: "Visit Reminder (24hr)",
    description: "Remind about upcoming visit",
    params: ["student_name", "visit_date", "campus_name"],
    preview: "Hi {{student_name}}, this is a reminder that your campus visit is scheduled for {{visit_date}}. See you soon!",
  },
  {
    key: "application_received",
    label: "Application Received",
    description: "Acknowledge application submission",
    params: ["student_name", "application_id"],
    preview: "Hi {{student_name}}, we've received your application (ID: {{application_id}}). Our admissions team will review it and get back to you shortly.",
  },
  {
    key: "fee_reminder",
    label: "Fee Reminder",
    description: "Remind about pending fee payment",
    params: ["student_name", "amount", "due_date"],
    preview: "Hi {{student_name}}, this is a reminder that your fee of ₹{{amount}} is due by {{due_date}}. Please complete the payment to secure your seat.",
  },
  {
    key: "nimt_followup_v2",
    label: "Follow-up",
    description: "Approved follow-up template for expired WhatsApp windows",
    params: ["student_name", "followup_date"],
    preview: "Hi {{student_name}}, this is a follow-up from NIMT Educational Institutions. Our counsellor will connect with you {{followup_date}}. Please reply here if you would like to continue the conversation.",
  },
  {
    key: "bpt_bmrit_cahet_deadline",
    label: "BPT/BMRIT CAHET Deadline",
    description: cahetDeadlineDescription(),
    params: [],
    preview: cahetDeadlineMessage(),
  },
  {
    key: "cnet_not_qualified_bpt_bmrit",
    label: "CNET Not Qualified → BPT/BMRIT",
    description: "Bilingual CNET result follow-up with BPT/BMRIT and CAHET instructions",
    params: ["student_name"],
    preview: TEMPLATE_MESSAGE_TEXTS.cnet_not_qualified_bpt_bmrit,
  },
  {
    key: "course_info_v4",
    label: "Course Info",
    description: "Auto-filled course duration, eligibility, approval and video",
    params: ["student_name", "course_name", "duration", "eligibility", "approval", "video_url"],
    preview: TEMPLATE_MESSAGE_TEXTS.course_info_v4,
  },
  {
    key: "course_info_video_v2",
    label: "Course Links",
    description: "Auto-filled course, campus and application links",
    params: ["student_name", "course_label", "course_url", "campus_url", "apply_url"],
    preview: TEMPLATE_MESSAGE_TEXTS.course_info_video_v2,
  },
  // ── Knowledge Base Quick Replies ─────────────────────────────────────────
  {
    key: "kb_apply_link",
    label: "📎 Application Link",
    description: "Share the online application portal link",
    params: [],
    preview: "Hi! 👋 Here's your link to apply online at NIMT:\n\n🔗 https://uni.nimt.ac.in/apply/nimt\n\nFill in your details and our admissions team will guide you through the next steps. For help, call us at 📞 +91 9555192192.",
  },
  {
    key: "kb_campus_addresses",
    label: "📍 Campus Addresses",
    description: "All 5 NIMT campus locations",
    params: [],
    preview: "📍 *NIMT Campus Locations*\n\n🏫 *Greater Noida (Main)*\nPlot No. 41, Knowledge Park-1, Near Pari Chowk, Greater Noida, UP 201310\n\n🏫 *Ghaziabad – Arthala*\nNear Arthala Metro Station, GT Road, Mohan Nagar, Ghaziabad 201007\n\n🏫 *Ghaziabad – Avantika*\nAnsal Avantika Colony, Shastri Nagar, Ghaziabad 201015\n\n🏫 *Ghaziabad – Avantika II*\nAvantika Extension Colony, Ghaziabad\n\n🏫 *Kotputli, Jaipur*\nSP-3-1, RIICO Industrial Area, Keshwana, Kotputli, Jaipur 303108\n\nFor directions or to schedule a visit, call 📞 +91 9555192192.",
  },
  {
    key: "kb_rankings",
    label: "🏆 Rankings & Recognition",
    description: "NIMT rankings and accreditations",
    params: [],
    preview: "🏆 *NIMT Rankings & Recognition*\n\n⭐ #1 in UP — EW Higher Education Rankings\n📊 Ranked 34th B-School — Business India\n⭐ PGDM ranked #8 in India\n📰 #57 Law in India — India Today 2025\n🎖️ AA+ rated — Digital Learning Magazine\n✅ 6 institutions NIRF ranked 2025\n\n*Approvals:* AICTE, UGC, Bar Council of India, NCTE, Indian Nursing Council, Pharmacy Council of India\n*Affiliations:* AKTU, GGSIPU, ABVMU, CCSU, University of Rajasthan\n\nWould you like to know more about a specific course or campus?",
  },
  {
    key: "kb_approvals",
    label: "✅ Approvals & Affiliations",
    description: "Regulatory approvals and university affiliations",
    params: [],
    preview: "✅ *NIMT Approvals & Affiliations*\n\n*Approved by:*\n• AICTE (All India Council for Technical Education)\n• UGC (University Grants Commission)\n• Bar Council of India (BCI) — Law programmes\n• NCTE (National Council for Teacher Education) — B.Ed\n• Indian Nursing Council (INC) — Nursing\n• Pharmacy Council of India (PCI) — D Pharma\n\n*Affiliated to:*\n• AKTU (Dr. A.P.J. Abdul Kalam Technical University)\n• GGSIPU (Guru Gobind Singh Indraprastha University)\n• ABVMU (Atal Bihari Vajpayee Medical University)\n• CCSU (Chaudhary Charan Singh University)\n• Dr. Bhimrao Ambedkar Law University (ALU)\n• University of Rajasthan (Kotputli campus)\n\nAll programmes are fully accredited and recognised. Any questions?",
  },
  {
    key: "kb_scholarships",
    label: "🎓 Scholarships",
    description: "Scholarship schemes available at NIMT",
    params: [],
    preview: "🎓 *NIMT Scholarship Schemes*\n\nWe offer multiple scholarship opportunities:\n\n• 🏅 *Merit Scholarship* — For students with outstanding academic performance\n• 🤝 *SC/ST/OBC Scholarships* — As per government norms\n• ⚽ *Sports Scholarship* — For national/state level athletes\n• 🏥 *Nursing Scholarship* — Supported by INC guidelines\n• 👥 *Alumni Referral Discount* — For referrals from NIMT alumni\n\nFor detailed eligibility and current scholarship amounts, please call our admissions office:\n📞 +91 9555192192\n\nOr apply online at: https://uni.nimt.ac.in/apply/nimt",
  },
  {
    key: "kb_placements",
    label: "💼 Placements",
    description: "Placement stats and top recruiters",
    params: [],
    preview: "💼 *NIMT Placement Highlights*\n\n📈 Highest Package: INR 18.75 LPA\n📊 Average Package: INR 5.40 LPA\n🏢 1,200+ corporate placement partners\n🎯 60+ companies visit campus annually\n\n*Top Recruiters:*\nFortis, KPMG, Cognizant, ICICI Bank, Wipro, HCL, Dell, Airtel, Kotak Mahindra, Infosys, Deloitte, TCS\n\n*By Course:*\n• MBA/PGDM: Highest 18.75 LPA, Avg 5.40 LPA\n• B.Sc Nursing: Highest 10 LPA, Avg 3 LPA (~98% placement rate)\n\nWould you like placement details for a specific course?",
  },
  {
    key: "kb_eligibility",
    label: "📋 Eligibility — General",
    description: "Quick eligibility overview for popular courses",
    params: [],
    preview: "📋 *Eligibility Overview — Popular Courses*\n\n🏥 *B.Sc Nursing:* 10+2 PCB, min 45%, age 17+\n🏥 *GNM:* 10+2 any stream, min 40%, age 17-35 (Science NOT required!)\n🦾 *BPT (Physiotherapy):* 10+2 PCB + English, min 50% (40% reserved/PwD); UP 2026 via CAHET counselling\n🩻 *BMRIT:* 10+2 PCB + English, min 50% (40% reserved/PwD); UP 2026 via CAHET counselling\n⚖️ *BA LLB (5yr):* 12th pass, min 45%\n⚖️ *LLB (3yr):* Graduation any stream, min 45%\n🎓 *MBA:* Bachelor's degree, min 50%, valid entrance score (CAT/MAT/XAT/CMAT)\n🎓 *PGDM:* Bachelor's degree, min 50%, CAT/MAT/XAT/CMAT\n🖥️ *BCA:* 12th with Maths, min 45%\n📊 *BBA:* 12th any stream, min 45%\n💊 *D Pharma:* 10+2 PCB/PCM, min 50%\n\nFor course-specific eligibility, please share which course you're interested in!",
  },
  {
    key: "kb_fee_structure",
    label: "💰 Fee Structure",
    description: "Fee information and how to get details",
    params: [],
    preview: "💰 *NIMT Fee Structure 2026-27*\n\nDetailed year-wise fees are published here:\nhttps://nimt.ac.in/admissions/fees/\n\n*Popular first-year fees:*\n• B.Sc Nursing: ₹1,53,000/year\n• GNM: ₹1,18,000/year\n• BPT / BMRIT: ₹92,000/year\n• MBA: ₹1,30,000/year\n• PGDM: ₹2,25,000/year\n• BA LLB: ₹1,10,000/year\n• LLB: ₹44,250/year\n• BBA / BCA: ₹75,000/year\n• D.Pharma: ₹95,000/year\n\n✅ Merit scholarships available\n✅ Education loan support available\n✅ Application fee: Rs 500-1,000 depending on course\n\nPlease share your course and campus preference, and we can send the exact year-wise breakup.",
  },
  {
    key: "kb_course_details",
    label: "📚 Course Details",
    description: "Send course-specific details",
    params: ["student_name", "course_name"],
    preview: "Hi {{student_name}}! Here are the key highlights for *{{course_name}}* at NIMT:\n\nPlease visit https://nimt.ac.in/courses for the full brochure, or our counsellor will share the detailed course guide with you shortly.\n\nWould you like to schedule a campus visit or speak with a counsellor? 😊",
  },
];

const isAdminRole = (role: string | null | undefined) =>
  role === "super_admin" || role === "admission_head" || role === "campus_admin";

const ALLOWED_ROLES = new Set(["super_admin", "campus_admin", "principal", "admission_head", "counsellor", "hr_manager"]);

// HR-scoped inbox: messages on +919599675267 (NIMT HR / careers number) plus
// any conversation that's been categorised as a job_applicant on the
// admissions number. The default (admissions) inbox excludes those.
const HR_BUSINESS_PNID = "970526789470416";
const HR_BUSINESS_NUMBER = "9599675267";
const PLIVO_WHATSAPP_NUMBER = "919555192192";
const PRIMARY_META_WHATSAPP_NUMBER = "919667691872";
const WHATSAPP_BUSINESS_NAME = "NIMT Educational Institutions";
const KNOWN_META_PHONE_NUMBER_ID_TO_NUMBER: Record<string, string> = {
  "1075269918995469": "917428499849",
  [HR_BUSINESS_PNID]: `91${HR_BUSINESS_NUMBER}`,
};
const KNOWN_ADMISSIONS_PHONE_CHANNELS = [
  { id: PLIVO_WHATSAPP_NUMBER, label: "9555192192 Inbox", provider: "plivo" },
  { id: PRIMARY_META_WHATSAPP_NUMBER, label: "9667691872 Inbox", provider: "meta" },
  { id: "917428499849", label: "7428499849 Inbox", provider: "meta" },
];

const digitsOnly = (value: string | null | undefined) => (value || "").replace(/\D/g, "");

const isBusinessPhoneNumberChannel = (value: string | null | undefined) => {
  const digits = digitsOnly(value);
  return digits.length === 10 || (digits.length === 12 && digits.startsWith("91"));
};

const normalizeBusinessChannel = (value: string | null | undefined) => {
  const digits = digitsOnly(value);
  if (digits.length === 10) return `91${digits}`;
  return digits;
};

const businessChannelVariants = (value: string | null | undefined) => {
  const normalized = normalizeBusinessChannel(value);
  if (!normalized) return [];
  if (normalized.length === 12 && normalized.startsWith("91")) return [normalized, normalized.slice(2)];
  return [normalized];
};

const getConversationBusinessChannel = (c: Conversation) =>
  normalizeBusinessChannel(c.business_phone_number_id || c.business_phone_number);

const findKnownAdmissionsChannel = (id: string | null | undefined, label?: string | null) => {
  const variants = new Set([...businessChannelVariants(id), ...businessChannelVariants(label)]);
  return KNOWN_ADMISSIONS_PHONE_CHANNELS.find(channel =>
    businessChannelVariants(channel.id).some(v => variants.has(v))
  );
};

const isHrBusinessChannel = (id: string | null | undefined, label?: string | null) =>
  id === HR_BUSINESS_PNID || digitsOnly(id) === HR_BUSINESS_NUMBER || digitsOnly(label) === HR_BUSINESS_NUMBER;

const isHrBusinessConversation = (c: Conversation) =>
  isHrBusinessChannel(c.business_phone_number_id, c.business_phone_number);

const isPhoneNumberBusinessConversation = (c: Conversation) =>
  isBusinessPhoneNumberChannel(c.business_phone_number_id) || isBusinessPhoneNumberChannel(c.business_phone_number);

const isKnownAdmissionsPhoneConversation = (c: Conversation) =>
  Boolean(findKnownAdmissionsChannel(c.business_phone_number_id, c.business_phone_number));

const conversationMatchesBusinessChannel = (c: Conversation, channel: string) => {
  const variants = new Set(businessChannelVariants(channel));
  return businessChannelVariants(c.business_phone_number_id).some(v => variants.has(v))
      || businessChannelVariants(c.business_phone_number).some(v => variants.has(v));
};

const formatInboxLabel = (id: string, label?: string | null) => {
  const digits = normalizeBusinessChannel(label || id);
  if (digits.length === 12 && digits.startsWith("91")) return `${digits.slice(2)} Inbox`;
  if (digits.length === 10) return `${digits} Inbox`;
  return label || id;
};

const resolveInboxBusinessNumber = (id: string | null | undefined, label?: string | null) => {
  const labelDigits = normalizeBusinessChannel(label);
  if (isBusinessPhoneNumberChannel(labelDigits)) return labelDigits;
  const idDigits = normalizeBusinessChannel(id);
  if (isBusinessPhoneNumberChannel(idDigits)) return idDigits;
  return id ? KNOWN_META_PHONE_NUMBER_ID_TO_NUMBER[id] || null : null;
};

const formatBusinessDisplayNumber = (value: string | null | undefined) => {
  const digits = normalizeBusinessChannel(value);
  if (digits.length === 12 && digits.startsWith("91")) {
    return `+91 ${digits.slice(2, 7)} ${digits.slice(7)}`;
  }
  if (digits.length === 10) return `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`;
  return value || "";
};

type InboxPickerOption = {
  id: string;
  label: string;
  provider: string | null;
  businessNumber: string | null;
  count?: number;
};

const WhatsAppInboxIdentity = ({
  option,
  selected,
  compact = false,
}: {
  option: InboxPickerOption;
  selected?: boolean;
  compact?: boolean;
}) => {
  const displayNumber = formatBusinessDisplayNumber(option.businessNumber);
  const primaryLabel = option.id === "all" ? option.label : (displayNumber || option.label);

  return (
    <div className={`flex w-full items-center gap-3 ${compact ? "py-0.5" : "rounded-md p-2"}`}>
      <Avatar className={compact ? "h-8 w-8 border bg-white" : "h-10 w-10 border bg-white"}>
        <AvatarImage src={nimtLogo} alt={WHATSAPP_BUSINESS_NAME} className="object-contain p-1" />
        <AvatarFallback className="bg-emerald-50 text-[10px] font-semibold text-emerald-700">NIMT</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className={`${compact ? "text-xs" : "text-sm"} truncate font-semibold text-foreground`}>{primaryLabel}</p>
          {option.provider && (
            <Badge variant="outline" className="h-5 rounded-full px-1.5 text-[10px] capitalize">
              {option.provider}
            </Badge>
          )}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
          <span>{displayNumber ? "🇮🇳 India" : "Inbox route"}</span>
          <span className="hidden sm:inline">•</span>
          <span className="truncate">{WHATSAPP_BUSINESS_NAME}</span>
          {!compact && <span>Name visible to customers</span>}
          {!compact && typeof option.count === "number" && <span>{option.count.toLocaleString("en-IN")} chats</span>}
        </div>
      </div>
      {selected && <Check className="h-4 w-4 shrink-0 text-emerald-600" />}
    </div>
  );
};

const STATE_LABELS: Record<string, string> = {
  new_unqualified: "New",
  awaiting_name: "Needs name",
  awaiting_course: "Needs course",
  qualified: "Qualified",
  answered_by_ai: "AI answered",
  needs_counsellor: "Needs counsellor",
  human_active: "Human active",
  followup_scheduled: "Follow-up",
  not_interested: "Not interested",
  dnc: "DNC",
  job_handoff: "HR handoff",
  vendor_handoff: "Vendor handoff",
  knowledge_gap: "Knowledge gap",
};

const stateLabel = (state?: string | null) =>
  state ? (STATE_LABELS[state] || state.replace(/_/g, " ")) : "New";

const conversationBusinessKey = (conv?: Conversation | null) =>
  conv?.provider === "plivo"
    ? (conv.business_phone_number || conv.business_phone_number_id || null)
    : (conv?.business_phone_number_id || conv?.business_phone_number || null);

const CONVERSATION_SELECT_RICH = `
  phone, lead_id, lead_name, lead_stage, lead_person_role, lead_source, course_name,
  last_message, last_direction, last_message_at, unread_count,
  counsellor_id, counsellor_name, has_inbound,
  provider, business_phone_number_id, business_phone_number,
  conversation_mode, conversation_state, owner_user_id, escalation_role,
  handoff_reason, priority, sla_due_at, last_intent, last_confidence, last_bot_action,
  lead_counsellor_ids
`;

const CONVERSATION_SELECT_PROVIDER = `
  phone, lead_id, lead_name, lead_stage, lead_person_role, course_name,
  last_message, last_direction, last_message_at, unread_count,
  counsellor_id, counsellor_name, has_inbound,
  provider, business_phone_number_id, business_phone_number, lead_counsellor_ids
`;

const CONVERSATION_SELECT_LEGACY = `
  phone, lead_id, lead_name, lead_stage, lead_person_role, course_name,
  last_message, last_direction, last_message_at, unread_count,
  counsellor_id, counsellor_name, has_inbound,
  business_phone_number_id, business_phone_number, lead_counsellor_ids
`;

const withConversationDefaults = (row: any): Conversation => ({
  ...row,
  provider: row.provider || null,
  conversation_mode: row.conversation_mode || null,
  conversation_state: row.conversation_state || null,
  lead_source: row.lead_source || null,
  owner_user_id: row.owner_user_id || null,
  escalation_role: row.escalation_role || null,
  handoff_reason: row.handoff_reason || null,
  priority: row.priority || null,
  sla_due_at: row.sla_due_at || null,
  last_intent: row.last_intent || null,
  last_confidence: row.last_confidence ?? null,
  last_bot_action: row.last_bot_action || null,
});

const createDemoConversation = (row: Partial<Conversation> & Pick<Conversation, "phone" | "last_message" | "last_message_at">): Conversation =>
  withConversationDefaults({
    lead_id: null,
    lead_name: null,
    lead_stage: "new_lead",
    lead_person_role: "lead",
    lead_source: "Meta campaign",
    course_name: null,
    last_direction: "inbound",
    unread_count: 0,
    counsellor_id: "demo-counsellor",
    counsellor_name: "Ananya",
    has_inbound: true,
    provider: "meta",
    business_phone_number_id: PRIMARY_META_WHATSAPP_NUMBER,
    business_phone_number: PRIMARY_META_WHATSAPP_NUMBER,
    conversation_mode: "ai",
    conversation_state: "new_unqualified",
    owner_user_id: "demo-counsellor",
    escalation_role: null,
    handoff_reason: null,
    priority: "normal",
    sla_due_at: null,
    last_intent: null,
    last_confidence: null,
    last_bot_action: null,
    lead_counsellor_ids: ["demo-counsellor"],
    ...row,
  });

const DEMO_TEMPLATE_RENDER = renderWhatsAppTemplate(
  INBOX_TEMPLATES.find(t => t.key === "course_info_v4")!,
  {
    student_name: "Riya",
    course_name: "B.Sc Nursing",
    duration: "4 years",
    eligibility: "10+2 PCB with 45%",
    approval: "Indian Nursing Council and U.P. State Medical Faculty",
    video_url: "https://nimt.ac.in/nursing",
  },
  {},
);

const DEMO_CONVERSATIONS: Conversation[] = [
  createDemoConversation({
    phone: "919876543210",
    lead_id: "demo-hot-lead",
    lead_name: "Riya Sharma",
    lead_stage: "new_lead",
    lead_source: "Instagram lead ad",
    course_name: "B.Sc Nursing",
    last_message: "Fees kitni hai? Hostel bhi chahiye.",
    last_message_at: "2026-06-29T06:45:00.000Z",
    unread_count: 3,
    priority: "urgent",
    conversation_state: "needs_counsellor",
    handoff_reason: "pricing_question",
    last_intent: "fee_and_hostel",
    last_confidence: 0.92,
  }),
  createDemoConversation({
    phone: "918888777766",
    lead_id: "demo-warm-lead",
    lead_name: "Aman Verma",
    lead_stage: "follow_up",
    lead_source: "CollegeDunia",
    course_name: "BPT",
    last_message: "Can I visit campus tomorrow?",
    last_message_at: "2026-06-29T05:20:00.000Z",
    unread_count: 1,
    priority: "high",
    conversation_state: "qualified",
    last_intent: "visit_booking",
    last_confidence: 0.88,
  }),
  createDemoConversation({
    phone: "917777666655",
    lead_id: "demo-template",
    lead_name: "Meera Khan",
    lead_stage: "application_in_progress",
    lead_source: "Website",
    course_name: "D.Pharma",
    last_message: "[Template: course_info_v4]",
    last_direction: "outbound",
    last_message_at: "2026-06-28T14:30:00.000Z",
    unread_count: 0,
    conversation_state: "template_sent",
  }),
  createDemoConversation({
    phone: "916666555544",
    lead_id: "demo-expired",
    lead_name: "Kabir Singh",
    lead_stage: "follow_up",
    lead_source: "Facebook",
    course_name: "MBA",
    last_message: "Ok",
    last_message_at: "2026-06-26T11:00:00.000Z",
    unread_count: 0,
    priority: "normal",
    conversation_state: "window_expired",
  }),
  createDemoConversation({
    phone: "915555444433",
    lead_id: "demo-dnc",
    lead_name: "Pooja Rawat",
    lead_stage: "dnc",
    lead_source: "Walk-in",
    course_name: "BA LLB",
    last_message: "Please do not contact again",
    last_message_at: "2026-06-25T09:00:00.000Z",
    unread_count: 0,
    priority: "low",
    conversation_state: "closed",
  }),
];

const DEMO_MESSAGES: Record<string, Message[]> = {
  "919876543210": [
    { id: "demo-m1", direction: "inbound", content: "Hi, B.Sc Nursing admission open hai?", message_type: "text", status: "received", template_key: null, media_url: null, created_at: "2026-06-29T06:40:00.000Z" },
    { id: "demo-m2", direction: "inbound", content: "Fees kitni hai?", message_type: "text", status: "received", template_key: null, media_url: null, created_at: "2026-06-29T06:42:00.000Z" },
    { id: "demo-m3", direction: "inbound", content: "Hostel bhi chahiye.", message_type: "text", status: "received", template_key: null, media_url: null, created_at: "2026-06-29T06:45:00.000Z" },
    { id: "demo-m4", direction: "outbound", content: "Hi Riya, yes admissions are open. I can share the fee structure and hostel details.", message_type: "text", status: "read", template_key: "ai_auto_reply", media_url: null, created_at: "2026-06-29T06:45:08.000Z", sender_user_id: "demo-ai" },
  ],
  "918888777766": [
    { id: "demo-v1", direction: "inbound", content: "Can I visit campus tomorrow?", message_type: "text", status: "received", template_key: null, media_url: null, created_at: "2026-06-29T05:20:00.000Z" },
  ],
  "917777666655": [
    { id: "demo-t1", direction: "outbound", content: "[Template: course_info_v4]", message_type: "template", status: "delivered", template_key: "course_info_v4", media_url: null, created_at: "2026-06-28T14:30:00.000Z", render_metadata: DEMO_TEMPLATE_RENDER },
  ],
  "916666555544": [
    { id: "demo-e1", direction: "inbound", content: "Ok", message_type: "text", status: "received", template_key: null, media_url: null, created_at: "2026-06-26T11:00:00.000Z" },
    { id: "demo-e2", direction: "outbound", content: "[Template: nimt_followup_v2]", message_type: "template", status: "failed", template_key: "nimt_followup_v2", media_url: null, created_at: "2026-06-29T06:00:00.000Z", status_error: { message: "24-hour customer care window expired. Use an approved template." } },
  ],
  "915555444433": [
    { id: "demo-d1", direction: "inbound", content: "Please do not contact again", message_type: "text", status: "received", template_key: null, media_url: null, created_at: "2026-06-25T09:00:00.000Z" },
  ],
};

const conversationIdentityKey = (c: Conversation) =>
  `${c.phone}:${conversationBusinessKey(c) || ""}`;

const mergeConversationRows = (primaryRows: Conversation[], fallbackRows: Conversation[]) => {
  const merged = new Map<string, Conversation>();
  for (const row of [...primaryRows, ...fallbackRows]) {
    const key = conversationIdentityKey(row);
    const existing = merged.get(key);
    if (!existing || new Date(row.last_message_at).getTime() > new Date(existing.last_message_at).getTime()) {
      merged.set(key, row);
    }
  }
  return [...merged.values()]
    .sort((a, b) => new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime());
};

const replyChannelPayload = (conv: Conversation | null | undefined) => {
  const phoneNumberIdLooksLikeBusinessNumber =
    conv?.provider === "meta" && isBusinessPhoneNumberChannel(conv.business_phone_number_id);
  return {
    provider: conv?.provider || null,
    business_phone_number_id: phoneNumberIdLooksLikeBusinessNumber ? null : conv?.business_phone_number_id || null,
    business_number: conv?.business_phone_number || (phoneNumberIdLooksLikeBusinessNumber ? conv?.business_phone_number_id || null : null),
  };
};

const WhatsAppInbox = ({ demoMode = false }: { demoMode?: boolean } = {}) => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user, role: authRole, profile: authProfile } = useAuth();
  const role = demoMode ? "super_admin" : authRole;
  const profile = demoMode
    ? { id: "demo-profile", display_name: "Meta QA", phone: null, avatar_url: null, campus: null, department: null, institution: null }
    : authProfile;
  const [searchParams] = useSearchParams();
  const isOutboundMode = searchParams.get("mode") === "outbound";
  const phoneParam = searchParams.get("phone");
  const scope = searchParams.get("scope") === "hr" ? "hr" : "admissions";
  const isHrScope = scope === "hr";

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversationCursor, setConversationCursor] = useState<{ last_message_at: string; phone: string } | null>(null);
  const [hasMoreConversations, setHasMoreConversations] = useState(true);
  const [loadingMoreConversations, setLoadingMoreConversations] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [selectedPhone, setSelectedPhone] = useState<string | null>(null);
  const [selectedCourseInfo, setSelectedCourseInfo] = useState<Record<string, string> | null>(null);
  const [senderNames, setSenderNames] = useState<Record<string, string>>({});
  const [localSenderNamesByWaId, setLocalSenderNamesByWaId] = useState<Record<string, string>>({});
  const [localSenderNamesBySignature, setLocalSenderNamesBySignature] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [templateSearch, setTemplateSearch] = useState("");
  const [templateParamOverrides, setTemplateParamOverrides] = useState<Record<string, string>>({});
  const [sendingTemplate, setSendingTemplate] = useState(false);
  const [showQuickReplies, setShowQuickReplies] = useState(false);
  const [inboxTab, setInboxTab] = useState<"all" | "leads" | "staff" | "jobs" | "other">("all");
  // Multi-number inbox: which business number's conversations to show.
  // "primary" = the most-used phone_number_id + legacy NULL rows; any other
  // distinct phone_number_id is shown as its own inbox.
  const [businessNumber, setBusinessNumber] = useState<string>("primary");
  const [detectedInboxChannels, setDetectedInboxChannels] = useState<{ id: string; label: string; n: number }[]>([]);
  const [staffNames, setStaffNames] = useState<Record<string, string>>({});
  const [staffConvs, setStaffConvs] = useState<Conversation[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const loadingConversationsRef = useRef(false);

  // Admin-only state
  const [counsellorList, setCounsellorList] = useState<{ id: string; name: string }[]>([]);
  const { counsellorFilter, setCounsellorFilter } = useCounsellorFilter();
  const [unrepliedOnly, setUnrepliedOnly] = useState(false);
  const [unrepliedByCC, setUnrepliedByCC] = useState<{ id: string; name: string; count: number }[]>([]);
  const [unrepliedPanelOpen, setUnrepliedPanelOpen] = useState(true);
  const [opsFilter, setOpsFilter] = useState<"all" | "reply_window" | "handoff" | "sla" | "knowledge" | "unassigned">("all");

  // Quick-action followup dialog
  const [followupOpen, setFollowupOpen] = useState(false);
  const [followupDate, setFollowupDate] = useState("");
  const [followupNote, setFollowupNote] = useState("");
  const [followupSaving, setFollowupSaving] = useState(false);

  // Backfill dialog state
  const [backfillOpen, setBackfillOpen] = useState(false);
  const [bfPrimaryPnid, setBfPrimaryPnid] = useState("");
  const [bfPrimaryNumber, setBfPrimaryNumber] = useState("");
  const [bfSecondaryPnid, setBfSecondaryPnid] = useState("");
  const [bfSecondaryNumber, setBfSecondaryNumber] = useState("");
  const [bfRunning, setBfRunning] = useState(false);
  const [bfResult, setBfResult] = useState<any>(null);

  // Per-conversation AI/human guard. 'human' means the bot stays silent and a
  // counsellor handles the chat (inbox or WhatsApp Business app). Read by the
  // whatsapp-ai-reply edge function before it auto-replies. Cast to `any` until
  // the generated Supabase types include whatsapp_ai_mode.
  const [aiMode, setAiMode] = useState<"ai" | "human" | null>(null);
  const [aiModeSaving, setAiModeSaving] = useState(false);
  const [showCopilotPanel, setShowCopilotPanel] = useState(false);
  const [copilotLoading, setCopilotLoading] = useState(false);
  const [copilotError, setCopilotError] = useState<string | null>(null);
  const [copilotResult, setCopilotResult] = useState<CopilotAssistResult | null>(null);

  useEffect(() => {
    if (!demoMode) return;
    setConversations(DEMO_CONVERSATIONS);
    setDetectedInboxChannels([
      { id: PRIMARY_META_WHATSAPP_NUMBER, label: "9667691872 Inbox", n: DEMO_CONVERSATIONS.length },
      { id: PLIVO_WHATSAPP_NUMBER, label: "9555192192 Inbox", n: 0 },
    ]);
    setCounsellorList([
      { id: "demo-counsellor", name: "Ananya" },
      { id: "demo-counsellor-2", name: "Rahul" },
    ]);
    setUnrepliedByCC([{ id: "demo-counsellor", name: "Ananya", count: 4 }]);
    setStaffNames({ "919999000001": "Admissions Desk" });
    setStaffConvs([]);
    setHasMoreConversations(false);
    setConversationCursor(null);
    setLoading(false);
    setSelectedPhone("919876543210");
  }, [demoMode]);

  const matchesActiveBusinessNumber = (c: Conversation) => {
    if (demoMode) return true;
    if (isHrScope) {
      return isHrBusinessConversation(c)
          || c.lead_person_role === "job_applicant";
    }
    if (isHrBusinessConversation(c)) return false;
    if (businessNumber === "all") return true;
    if (businessNumber !== "primary") return conversationMatchesBusinessChannel(c, businessNumber);
    return !c.business_phone_number_id
        || (primaryPnid ? c.business_phone_number_id === primaryPnid : !isKnownAdmissionsPhoneConversation(c));
  };

  useEffect(() => {
    if (demoMode) { setAiMode("ai"); return; }
    const conv = conversations.find(c => c.phone === selectedPhone && matchesActiveBusinessNumber(c))
      || conversations.find(c => c.phone === selectedPhone);
    const channel = conversationBusinessKey(conv);
    if (!selectedPhone || !channel) { setAiMode(null); return; }
    let cancelled = false;
    (async () => {
      const { data: stateData } = await (supabase as any)
        .from("whatsapp_conversation_state")
        .select("mode")
        .eq("phone", selectedPhone.replace(/[^0-9]/g, ""))
        .eq("business_number", channel)
        .maybeSingle();
      if (stateData?.mode) {
        if (!cancelled) setAiMode(stateData.mode === "human" ? "human" : "ai");
        return;
      }

      const { data } = await (supabase as any)
        .from("whatsapp_ai_mode")
        .select("mode")
        .eq("phone", selectedPhone.replace(/[^0-9]/g, ""))
        .eq("business_number", channel)
        .maybeSingle();
      if (!cancelled) setAiMode(((data?.mode as "ai" | "human") ?? conv?.conversation_mode ?? "ai") === "human" ? "human" : "ai");
    })();
    return () => { cancelled = true; };
  }, [selectedPhone, conversations, businessNumber, isHrScope]);

  const toggleAiMode = async () => {
    const conv = conversations.find(c => c.phone === selectedPhone && matchesActiveBusinessNumber(c))
      || conversations.find(c => c.phone === selectedPhone);
    const channel = conversationBusinessKey(conv);
    if (!selectedPhone || !channel) return;
    const next = aiMode === "human" ? "ai" : "human";
    setAiModeSaving(true);
    const { error } = await (supabase as any)
      .from("whatsapp_ai_mode")
      .upsert(
        { phone: selectedPhone.replace(/[^0-9]/g, ""), business_number: channel, mode: next, updated_at: new Date().toISOString() },
        { onConflict: "phone,business_number" },
      );
    const { error: stateError } = await (supabase as any)
      .from("whatsapp_conversation_state")
      .upsert(
        {
          phone: selectedPhone.replace(/[^0-9]/g, ""),
          business_number: channel,
          provider: conv?.provider || "meta",
          lead_id: conv?.lead_id || null,
          mode: next,
          state: next === "human" ? "human_active" : "new_unqualified",
          owner_user_id: next === "human" ? (profile?.id || null) : (conv?.owner_user_id || conv?.counsellor_id || null),
          handoff_reason: next === "human" ? "manual_toggle" : null,
          updated_by: profile?.id || null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "phone,business_number" },
      );
    setAiModeSaving(false);
    if (error || stateError) { toast({ title: "Couldn't update mode", description: error?.message || stateError?.message, variant: "destructive" }); return; }
    setAiMode(next);
    setConversations(prev => prev.map(c => c.phone === selectedPhone && conversationBusinessKey(c) === channel
      ? { ...c, conversation_mode: next, conversation_state: next === "human" ? "human_active" : "new_unqualified", handoff_reason: next === "human" ? "manual_toggle" : null }
      : c
    ));
    toast({ title: next === "human" ? "AI paused for this chat" : "AI re-enabled for this chat" });
  };

  // Multi-inbox: keep phone-number channels (Plivo/coexistence DIDs) out of
  // the primary heuristic so they never get folded into the default admissions inbox.
  const { primaryPnid, primaryInboxLabel, otherInboxes } = (() => {
    const counts = new Map<string, { label: string; n: number }>();
    if (!isHrScope) {
      for (const channel of KNOWN_ADMISSIONS_PHONE_CHANNELS) {
        counts.set(channel.id, { label: channel.label, n: 0 });
      }
    }
    for (const c of [...detectedInboxChannels, ...conversations]) {
      if ("id" in c) {
        if (!isHrScope && isHrBusinessChannel(c.id, c.label)) continue;
        counts.set(c.id, { label: c.label, n: c.n });
        continue;
      }
      if (!c.business_phone_number_id) continue;
      if (!isHrScope && isHrBusinessConversation(c)) continue;
      const key = getConversationBusinessChannel(c);
      if (!key) continue;
      const known = findKnownAdmissionsChannel(key, c.business_phone_number);
      const countKey = known && known.provider === "meta" && !isBusinessPhoneNumberChannel(key) ? key : (known?.id || key);
      const countLabel = known?.label || formatInboxLabel(key, c.business_phone_number);
      if (known && countKey !== known.id && counts.has(known.id)) counts.delete(known.id);
      const cur = counts.get(countKey) || { label: countLabel, n: 0 };
      cur.n += 1;
      counts.set(countKey, cur);
    }
    const sorted = [...counts.entries()]
      .map(([id, v]) => ({ id, label: formatInboxLabel(id, v.label), n: v.n }))
      .sort((a, b) => b.n - a.n);
    const primaryItem = sorted.find(item => !isBusinessPhoneNumberChannel(item.id)) || null;
    const primary = primaryItem?.id || null;
    const primaryMetaFallback = !isHrScope
      ? KNOWN_ADMISSIONS_PHONE_CHANNELS.find(channel => channel.id === PRIMARY_META_WHATSAPP_NUMBER)
      : null;
    const primaryUsesMetaFallbackLabel = Boolean(primaryMetaFallback);
    const secondaryInboxes = sorted
      .filter(item => item.id !== primary)
      .filter(item => !primaryUsesMetaFallbackLabel || item.id !== primaryMetaFallback?.id)
      .map(item => ({ id: item.id, label: item.label, n: item.n }));
    return {
      primaryPnid: primary as string | null,
      primaryInboxLabel: primaryMetaFallback?.label || primaryItem?.label || "Primary Inbox",
      otherInboxes: secondaryInboxes,
    };
  })();
  const hasOtherInbox = otherInboxes.length > 0;
  const inboxPickerOptions: InboxPickerOption[] = [
    {
      id: "all",
      label: "All WhatsApp numbers",
      provider: null,
      businessNumber: null,
      count: conversations.length,
    },
    {
      id: "primary",
      label: primaryInboxLabel,
      provider: "meta",
      businessNumber: PRIMARY_META_WHATSAPP_NUMBER,
    },
    ...otherInboxes.map((inbox) => {
      const known = findKnownAdmissionsChannel(inbox.id, inbox.label);
      return {
        id: inbox.id,
        label: inbox.label,
        provider: known?.provider || "meta",
        businessNumber: resolveInboxBusinessNumber(inbox.id, inbox.label),
        count: inbox.n,
      };
    }),
  ];
  const selectedInboxOption = inboxPickerOptions.find(option => option.id === businessNumber) || inboxPickerOptions[0];

  // Pre-fill backfill form when dialog opens, using detected pnids if any
  const openBackfill = () => {
    setBfResult(null);
    setBfPrimaryPnid(prev => prev || (primaryPnid ?? ""));
    setBfPrimaryNumber(prev => prev || (conversations.find(c => c.business_phone_number_id === primaryPnid)?.business_phone_number ?? ""));
    setBfSecondaryPnid(prev => prev || (otherInboxes[0]?.id ?? ""));
    setBfSecondaryNumber(prev => prev || (otherInboxes[0]?.label ?? ""));
    setBackfillOpen(true);
  };

  const runBackfill = async () => {
    if (!bfPrimaryPnid || !bfSecondaryPnid) {
      toast({ title: "Both phone_number_ids are required", variant: "destructive" });
      return;
    }
    if (bfPrimaryPnid === bfSecondaryPnid) {
      toast({ title: "Primary and secondary IDs must differ", variant: "destructive" });
      return;
    }
    setBfRunning(true);
    setBfResult(null);
    const { data, error } = await (supabase.rpc as any)("backfill_wa_inboxes_heuristic", {
      primary_pnid: bfPrimaryPnid,
      primary_number: bfPrimaryNumber || null,
      secondary_pnid: bfSecondaryPnid,
      secondary_number: bfSecondaryNumber || null,
    });
    setBfRunning(false);
    if (error) {
      toast({ title: "Backfill failed", description: error.message, variant: "destructive" });
      return;
    }
    setBfResult(data);
    toast({ title: "Backfill complete", description: `Primary: ${data?.primary_threads ?? 0} threads · Secondary: ${data?.secondary_threads ?? 0} threads` });
  };

  const matchesInbox = (c: Conversation) => {
    if (demoMode) return true;
    // HR scope: messages on the HR business number OR any job_applicant
    // conversation regardless of which number it landed on. The
    // business-number switcher doesn't apply here — the scope is fixed.
    if (isHrScope) {
      return isHrBusinessConversation(c)
          || c.lead_person_role === "job_applicant";
    }
    // Admissions scope: exclude job_applicant conversations entirely;
    // those live in the dedicated HR inbox.
    if (c.lead_person_role === "job_applicant") return false;
    if (isHrBusinessConversation(c)) return false;
    if (businessNumber === "all") return true;
    if (businessNumber !== "primary") return conversationMatchesBusinessChannel(c, businessNumber);
    if (isKnownAdmissionsPhoneConversation(c)) return false;
    if (businessNumber === "primary") {
      return !c.business_phone_number_id
          || (primaryPnid ? c.business_phone_number_id === primaryPnid : !isKnownAdmissionsPhoneConversation(c));
    }
    return c.business_phone_number_id === businessNumber;
  };

  const fetchMessageBackedConversationRows = async (selectedBusinessNumber = businessNumber): Promise<Conversation[]> => {
    const variants = businessChannelVariants(selectedBusinessNumber);
    if (variants.length === 0) return [];

    const messageColumns = "id, phone, lead_id, direction, content, created_at, provider, business_phone_number_id, business_phone_number, is_read";
    const applyChannelFilter = (query: any) => query.or(
      variants
        .flatMap(v => [`business_phone_number_id.eq.${v}`, `business_phone_number.eq.${v}`])
        .join(","),
    );

    const recentMessagesQuery = applyChannelFilter(
      supabase
        .from("whatsapp_messages" as any)
        .select(messageColumns)
        .order("created_at", { ascending: false })
        .limit(CONVERSATION_PAGE_SIZE * 5),
    );

    const inboundMessagesQuery = applyChannelFilter(
      supabase
        .from("whatsapp_messages" as any)
        .select(messageColumns)
        .eq("direction", "inbound")
        .order("created_at", { ascending: false })
        .limit(CONVERSATION_PAGE_SIZE * 5),
    );

    const [recentMessages, inboundMessages] = await Promise.all([
      recentMessagesQuery,
      inboundMessagesQuery,
    ]);

    const error = recentMessages.error || inboundMessages.error;
    if (error) throw error;

    const seedById = new Map<string, MessageConversationSeed>();
    for (const row of ([...(recentMessages.data || []), ...(inboundMessages.data || [])] as any[] as MessageConversationSeed[])) {
      const key = row.id || `${row.phone}:${row.created_at}:${row.direction}:${row.content || ""}`;
      if (!seedById.has(key)) seedById.set(key, row);
    }

    const seedRows = [...seedById.values()]
      .filter(row => row.phone && row.created_at)
      .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
    if (seedRows.length === 0) return [];

    const leadIds = Array.from(new Set(seedRows.map(row => row.lead_id).filter((id): id is string => Boolean(id))));
    const leadById = new Map<string, any>();
    const courseById = new Map<string, string>();
    const counsellorById = new Map<string, string>();

    if (leadIds.length > 0) {
      const { data: leadsData, error: leadsError } = await supabase
        .from("leads" as any)
        .select("id, name, stage, person_role, source, counsellor_id, course_id")
        .in("id", leadIds);
      if (leadsError) throw leadsError;

      for (const lead of ((leadsData || []) as any[])) {
        leadById.set(lead.id, lead);
      }

      const courseIds = Array.from(new Set(
        ((leadsData || []) as any[])
          .map(lead => lead.course_id)
          .filter((id): id is string => Boolean(id)),
      ));
      const counsellorIds = Array.from(new Set(
        ((leadsData || []) as any[])
          .map(lead => lead.counsellor_id)
          .filter((id): id is string => Boolean(id)),
      ));

      if (courseIds.length > 0) {
        const { data: coursesData } = await supabase
          .from("courses" as any)
          .select("id, name")
          .in("id", courseIds);
        for (const course of ((coursesData || []) as any[])) {
          if (course.id && course.name) courseById.set(course.id, course.name);
        }
      }

      if (counsellorIds.length > 0) {
        const { data: profilesData } = await supabase
          .from("profiles" as any)
          .select("id, display_name")
          .in("id", counsellorIds);
        for (const counsellor of ((profilesData || []) as any[])) {
          if (counsellor.id && counsellor.display_name) counsellorById.set(counsellor.id, counsellor.display_name);
        }
      }
    }

    const selectedChannel = normalizeBusinessChannel(selectedBusinessNumber);
    const grouped = new Map<string, {
      latest: MessageConversationSeed;
      leadId: string | null;
      unreadCount: number;
      hasInbound: boolean;
    }>();

    for (const row of seedRows) {
      const lead = row.lead_id ? leadById.get(row.lead_id) : null;
      if (role === "counsellor" && profile?.id && (!lead || lead.counsellor_id !== profile.id)) {
        continue;
      }
      if (isAdminRole(role)) {
        if (counsellorFilter === "unassigned" && lead?.counsellor_id) continue;
        if (counsellorFilter !== "all" && counsellorFilter !== "unassigned" && (!lead || lead.counsellor_id !== counsellorFilter)) continue;
      }

      const rowChannel = normalizeBusinessChannel(row.business_phone_number_id || row.business_phone_number) || selectedChannel;
      const key = `${row.phone}:${rowChannel}`;
      const existing = grouped.get(key);
      if (!existing) {
        grouped.set(key, {
          latest: row,
          leadId: row.lead_id || null,
          unreadCount: row.direction === "inbound" && row.is_read === false ? 1 : 0,
          hasInbound: row.direction === "inbound",
        });
        continue;
      }

      if (!existing.leadId && row.lead_id) existing.leadId = row.lead_id;
      if (row.direction === "inbound") existing.hasInbound = true;
      if (row.direction === "inbound" && row.is_read === false) existing.unreadCount += 1;
    }

    return Array.from(grouped.values())
      .map(group => {
        const latest = group.latest;
        const lead = group.leadId ? leadById.get(group.leadId) : null;
        return withConversationDefaults({
          phone: latest.phone || "",
          lead_id: group.leadId,
          lead_name: lead?.name || null,
          lead_stage: lead?.stage || null,
          lead_person_role: lead?.person_role || null,
          lead_source: lead?.source || null,
          course_name: lead?.course_id ? courseById.get(lead.course_id) || null : null,
          last_message: latest.content,
          last_direction: latest.direction || "inbound",
          last_message_at: latest.created_at || new Date(0).toISOString(),
          unread_count: group.unreadCount,
          counsellor_id: lead?.counsellor_id || null,
          counsellor_name: lead?.counsellor_id ? counsellorById.get(lead.counsellor_id) || null : null,
          has_inbound: group.hasInbound,
          provider: latest.provider || null,
          business_phone_number_id: latest.business_phone_number_id || selectedChannel || null,
          business_phone_number: latest.business_phone_number || selectedChannel || null,
          lead_counsellor_ids: lead?.counsellor_id ? [lead.counsellor_id] : null,
        });
      })
      .filter(row => matchesInbox(row))
      .sort((a, b) => new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime())
      .slice(0, CONVERSATION_PAGE_SIZE);
  };

  const fetchConversationPage = async (
    reset = false,
    explicitCursor: { last_message_at: string; phone: string } | null = conversationCursor,
  ) => {
    if (role === "counsellor" && !profile?.id) return;
    if (loadingConversationsRef.current) return;
    if (!reset && !hasMoreConversations) return;

    loadingConversationsRef.current = true;
    if (reset) setLoading(true);
    else setLoadingMoreConversations(true);

    try {
      let rows: Conversation[] = [];
      let lastError: any = null;
      for (const selectFields of [CONVERSATION_SELECT_RICH, CONVERSATION_SELECT_PROVIDER, CONVERSATION_SELECT_LEGACY]) {
        let q = supabase
          .from("whatsapp_conversations" as any)
          .select(selectFields)
          .order("last_message_at", { ascending: false })
          .order("phone", { ascending: false })
          .limit(CONVERSATION_PAGE_SIZE);

        if (explicitCursor) {
          q = q.or(`last_message_at.lt.${explicitCursor.last_message_at},and(last_message_at.eq.${explicitCursor.last_message_at},phone.lt.${explicitCursor.phone})`);
        }

        if (!isHrScope && businessNumber !== "primary") {
          const variants = businessChannelVariants(businessNumber);
          if (variants.length > 0) {
            q = q.or(
              variants
                .flatMap(v => [`business_phone_number_id.eq.${v}`, `business_phone_number.eq.${v}`])
                .join(","),
            );
          }
        }

        if (role === "counsellor" && profile?.id) {
          // Filter via the aggregated lead_counsellor_ids array — covers the
          // case where the latest message on a phone is a campaign blast
          // (lead_id NULL) or a template tied to another counsellor's lead.
          q = q.contains("lead_counsellor_ids", [profile.id]);
        } else if (isAdminRole(role)) {
          if (counsellorFilter === "unassigned") {
            q = (q as any).is("counsellor_id", null);
          } else if (counsellorFilter !== "all") {
            q = q.eq("counsellor_id", counsellorFilter);
          }
        }

        const { data, error } = await q;
        if (!error) {
          lastError = null;
          rows = ((data || []) as any[]).map(withConversationDefaults);
          break;
        }
        lastError = error;
      }

      if (lastError && rows.length === 0) throw lastError;
      if (reset && businessNumber !== "primary" && isBusinessPhoneNumberChannel(businessNumber)) {
        const messageBackedRows = await fetchMessageBackedConversationRows(businessNumber);
        rows = rows.length === 0 ? messageBackedRows : mergeConversationRows(rows, messageBackedRows);
      }

      setConversations(prev => {
        if (reset) return rows;
        const seen = new Set(prev.map(conversationIdentityKey));
        const nextRows = rows.filter(c => !seen.has(conversationIdentityKey(c)));
        return [...prev, ...nextRows];
      });

      if (rows.length < CONVERSATION_PAGE_SIZE) {
        setHasMoreConversations(false);
        setConversationCursor(null);
      } else {
        const last = rows[rows.length - 1];
        setHasMoreConversations(true);
        setConversationCursor({ last_message_at: last.last_message_at, phone: last.phone });
      }
    } catch (error: any) {
      toast({ title: "WhatsApp inbox could not load", description: error?.message || "Try again.", variant: "destructive" });
      if (reset) {
        setConversations([]);
        setHasMoreConversations(false);
      }
    } finally {
      setLoading(false);
      setLoadingMoreConversations(false);
      loadingConversationsRef.current = false;
    }
  };

  // Fetch the first conversation page only. Additional pages load on scroll so
  // the inbox can paint quickly even when thousands of outbound rows exist.
  useEffect(() => {
    if (demoMode) return;
    if (role === "counsellor" && !profile?.id) return;
    setConversations([]);
    setConversationCursor(null);
    setHasMoreConversations(true);
    void fetchConversationPage(true, null);
  }, [role, profile?.id, counsellorFilter, businessNumber]);

  // Discover all business-number channels in the background. The main inbox
  // only loads the first page for speed, so the selector cannot depend on
  // whichever numbers happen to appear in that first page.
  useEffect(() => {
    if (demoMode) return;
    if (role === "counsellor" && !profile?.id) return;
    let cancelled = false;
    (async () => {
      let conversationChannelQuery = supabase
        .from("whatsapp_conversations" as any)
        .select("business_phone_number_id, business_phone_number, counsellor_id, lead_counsellor_ids")
        .not("business_phone_number_id", "is", null)
        .order("last_message_at", { ascending: false })
        .limit(5000);

      if (role === "counsellor" && profile?.id) {
        conversationChannelQuery = conversationChannelQuery.contains("lead_counsellor_ids", [profile.id]);
      } else if (isAdminRole(role)) {
        if (counsellorFilter === "unassigned") {
          conversationChannelQuery = (conversationChannelQuery as any).is("counsellor_id", null);
        } else if (counsellorFilter !== "all") {
          conversationChannelQuery = conversationChannelQuery.eq("counsellor_id", counsellorFilter);
        }
      }

      const messageChannelQuery = supabase
        .from("whatsapp_messages" as any)
        .select("business_phone_number_id, business_phone_number")
        .not("business_phone_number_id", "is", null)
        .order("created_at", { ascending: false })
        .limit(5000);

      const [conversationChannels, messageChannels] = await Promise.all([
        conversationChannelQuery,
        messageChannelQuery,
      ]);
      if (cancelled) return;

      const counts = new Map<string, { label: string; n: number }>();
      for (const row of ([...(conversationChannels.data || []), ...(messageChannels.data || [])] as any[])) {
        const id = normalizeBusinessChannel(row.business_phone_number_id || row.business_phone_number);
        if (!id) continue;
        if (!isHrScope && isHrBusinessChannel(id, row.business_phone_number)) continue;
        const cur = counts.get(id) || { label: formatInboxLabel(id, row.business_phone_number), n: 0 };
        cur.n += 1;
        counts.set(id, cur);
      }

      setDetectedInboxChannels(
        [...counts.entries()]
          .map(([id, v]) => ({ id, label: formatInboxLabel(id, v.label), n: v.n }))
          .sort((a, b) => b.n - a.n),
      );
    })();
    return () => { cancelled = true; };
  }, [role, profile?.id, counsellorFilter, isHrScope]);

  // Fetch staff/counsellor metadata off the critical path for the first paint.
  useEffect(() => {
    if (demoMode) return;
    let cancelled = false;
    (async () => {
      const { data: staffProfiles } = await supabase
        .from("profiles")
        .select("phone, display_name, user_id")
        .not("phone", "is", null);

      const { data: staffRoles } = await supabase
        .from("user_roles")
        .select("user_id, role")
        .in("role", ["super_admin", "campus_admin", "principal", "admission_head", "counsellor", "accountant", "faculty", "teacher", "data_entry", "office_admin", "office_assistant", "hostel_warden"]);

      if (cancelled) return;
      const staffUserIds = new Set((staffRoles || []).map((r: any) => r.user_id));
      const nameMap: Record<string, string> = {};
      const syntheticConvs: Conversation[] = [];

      for (const p of (staffProfiles || [])) {
        if (!p.phone || !staffUserIds.has(p.user_id)) continue;
        const digits = p.phone.replace(/\D/g, "");
        if (p.display_name) nameMap[digits] = p.display_name;
        syntheticConvs.push({
          phone: digits,
          lead_id: null,
          lead_name: null,
          lead_stage: null,
          lead_person_role: null,
          course_name: null,
          last_message: null,
          last_direction: "outbound",
          last_message_at: "1970-01-01T00:00:00Z",
          unread_count: 0,
          counsellor_id: null,
          counsellor_name: null,
          has_inbound: false,
          provider: null,
          business_phone_number_id: null,
          business_phone_number: null,
          conversation_mode: null,
          conversation_state: null,
          owner_user_id: null,
          escalation_role: null,
          handoff_reason: null,
          priority: null,
          sla_due_at: null,
          last_intent: null,
          last_confidence: null,
          last_bot_action: null,
          lead_counsellor_ids: null,
        });
      }

      setStaffNames(nameMap);
      setStaffConvs(syntheticConvs);
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (demoMode) return;
    if (!isAdminRole(role)) { setCounsellorList([]); return; }
    let cancelled = false;
    (async () => {
      const { data: ccRoles } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("role", "counsellor");

      if (!ccRoles || ccRoles.length === 0) {
        if (!cancelled) setCounsellorList([]);
        return;
      }

      const ccUserIds = ccRoles.map((r: any) => r.user_id);
      const { data: ccProfiles } = await supabase
        .from("profiles")
        .select("id, display_name")
        .in("user_id", ccUserIds);

      if (!cancelled && ccProfiles) {
        setCounsellorList(
          ccProfiles
            .filter((p: any) => p.display_name)
            .map((p: any) => ({ id: p.id, name: p.display_name }))
        );
      }
    })();
    return () => { cancelled = true; };
  }, [role]);

  // Fetch unreplied breakdown for admins — separate unlimited query
  useEffect(() => {
    if (demoMode) return;
    if (!isAdminRole(role) || counsellorList.length === 0) { setUnrepliedByCC([]); return; }
    (async () => {
      const { data } = await supabase
        .from("whatsapp_conversations" as any)
        .select("counsellor_id, unread_count")
        .eq("last_direction", "inbound")
        .gt("unread_count", 0);

      if (!data || (data as any[]).length === 0) { setUnrepliedByCC([]); return; }

      const groups: Record<string, { name: string; count: number }> = {};
      for (const c of data as any[]) {
        const key = c.counsellor_id || "__unassigned__";
        const name = c.counsellor_id
          ? (counsellorList.find(cc => cc.id === c.counsellor_id)?.name || "Unknown")
          : "Unassigned";
        if (!groups[key]) groups[key] = { name, count: 0 };
        groups[key].count += c.unread_count;
      }

      setUnrepliedByCC(
        Object.entries(groups)
          .filter(([, v]) => v.count > 0)
          .map(([id, v]) => ({ id, name: v.name, count: v.count }))
      );
    })();
  }, [role, counsellorList]);

  // Auto-select conversation from URL param (notification deep-link)
  const phoneFromUrl = searchParams.get("phone");
  const [deepLinkNotFound, setDeepLinkNotFound] = useState(false);
  useEffect(() => {
    if (demoMode) {
      if (!phoneFromUrl) return;
      const normalized = phoneFromUrl.replace(/\D/g, "");
      const match = DEMO_CONVERSATIONS.find(c => c.phone === normalized || c.phone === phoneFromUrl);
      if (match) setSelectedPhone(match.phone);
      else setDeepLinkNotFound(true);
      return;
    }
    if (!phoneFromUrl || conversations.length === 0) return;
    let cancelled = false;
    setDeepLinkNotFound(false);
    const normalized = phoneFromUrl.replace(/\D/g, "");
    const allSearchable = [...conversations, ...staffConvs];
    const match = allSearchable.find(c => c.phone === normalized || c.phone === phoneFromUrl);
    if (match) {
      if (match.has_inbound === false && !isOutboundMode) {
        navigate(`/whatsapp-inbox?mode=outbound&phone=${normalized}`, { replace: true });
        return;
      }
      setSelectedPhone(match.phone);
      setInboxTab("all");
    } else {
      (async () => {
        let row: Conversation | undefined;
        for (const selectFields of [CONVERSATION_SELECT_RICH, CONVERSATION_SELECT_PROVIDER, CONVERSATION_SELECT_LEGACY]) {
          const { data, error } = await supabase
            .from("whatsapp_conversations" as any)
            .select(selectFields)
            .eq("phone", normalized)
            .order("last_message_at", { ascending: false })
            .limit(1);
          if (!error) {
            row = ((data || []) as any[]).map(withConversationDefaults)[0];
            break;
          }
        }

        if (cancelled) return;
        if (!row) {
          setDeepLinkNotFound(true);
          return;
        }

        setConversations(prev => {
          const exists = prev.some(c => c.phone === row.phone && (c.business_phone_number_id || "") === (row.business_phone_number_id || ""));
          return exists ? prev : [row, ...prev];
        });
        if (row.has_inbound === false && !isOutboundMode) {
          navigate(`/whatsapp-inbox?mode=outbound&phone=${normalized}`, { replace: true });
          return;
        }
        setSelectedPhone(row.phone);
        setInboxTab("all");
      })();
    }
    return () => { cancelled = true; };
  }, [searchParams, conversations.length, staffConvs.length]);

  // Fetch messages for selected conversation
  useEffect(() => {
    if (demoMode) {
      if (!selectedPhone) { setMessages([]); return; }
      setMessages(DEMO_MESSAGES[selectedPhone] || []);
      return;
    }
    if (!selectedPhone) { setMessages([]); return; }
    (async () => {
      // Pick the active business pnid for filtering. "primary" matches the
      // most-used pnid + legacy NULL rows; otherwise exact match.
      const activePnid = businessNumber === "primary" ? primaryPnid : businessNumber;
      const applyBusinessNumberFilter = (query: any) => {
        if (isHrScope) {
          // HR view shows the candidate's full thread: messages on the HR
          // number AND any messages on the admissions number that were
          // categorised as job-applicant — same conversation, different DID.
          // We don't pnid-filter here; the conversation list is already
          // scoped via matchesInbox.
          return query;
        }
        if (businessNumber === "all") return query;
        if (businessNumber !== "primary" && isBusinessPhoneNumberChannel(businessNumber)) {
          const variants = businessChannelVariants(businessNumber);
          return query.or(
            variants
              .flatMap(v => [`business_phone_number_id.eq.${v}`, `business_phone_number.eq.${v}`])
              .join(","),
          );
        }
        if (businessNumber === "primary") {
          if (activePnid) return query.or(`business_phone_number_id.is.null,business_phone_number_id.eq.${activePnid}`);
          return query.is("business_phone_number_id", null);
        }
        return query.eq("business_phone_number_id", businessNumber);
      };

      const buildMessageQuery = (selectColumns: string) => {
        let query = supabase
          .from("whatsapp_messages" as any)
          .select(selectColumns)
          .eq("phone", selectedPhone)
          .order("created_at", { ascending: true })
          .limit(200);
        return applyBusinessNumberFilter(query);
      };

      const messageColumns = "id, wa_message_id, direction, content, message_type, status, template_key, media_url, created_at, business_phone_number_id, status_error";
      const messageColumnsWithRender = `${messageColumns}, render_metadata`;
      let q = buildMessageQuery(`${messageColumnsWithRender}, sender_user_id`);
      let { data, error } = await q;
      if (error && /render_metadata/i.test(error.message || "")) {
        const fallback = await buildMessageQuery(`${messageColumns}, sender_user_id`);
        data = fallback.data;
        error = fallback.error;
      }
      if (error && /sender_user_id/i.test(error.message || "")) {
        const fallback = await buildMessageQuery(messageColumnsWithRender);
        data = fallback.data;
        error = fallback.error;
      }
      if (error && /render_metadata/i.test(error.message || "")) {
        const fallback = await buildMessageQuery(messageColumns);
        data = fallback.data;
        error = fallback.error;
      }
      if (error) {
        toast({ title: "Couldn't load WhatsApp messages", description: error.message, variant: "destructive" });
      } else if (data) {
        setMessages(data as any);
      }

      const activeConversation = conversations.find(c => c.phone === selectedPhone && matchesInbox(c))
        || conversations.find(c => c.phone === selectedPhone);
      await (supabase.rpc as any)("mark_whatsapp_conversation_read", {
        p_phone: selectedPhone,
        p_provider: businessNumber === "all" ? null : activeConversation?.provider || null,
        p_business_phone_number_id: businessNumber === "all" ? null : activeConversation?.business_phone_number_id || null,
        p_business_phone_number: businessNumber === "all" ? null : activeConversation?.business_phone_number || null,
      });

      // Update local unread count
      setConversations(prev =>
        prev.map(c => c.phone === selectedPhone && matchesInbox(c) ? { ...c, unread_count: 0 } : c)
      );
    })();
  }, [selectedPhone, businessNumber, primaryPnid]);

  useEffect(() => {
    if (demoMode) {
      setSenderNames(prev => {
        if (prev["demo-ai"] === "Bot" && prev["demo-profile"] === "Meta QA") return prev;
        return { ...prev, "demo-ai": "Bot", "demo-profile": "Meta QA" };
      });
      return;
    }
    const userIds = Array.from(new Set(
      messages
        .map(m => m.sender_user_id)
        .filter((id): id is string => Boolean(id) && !senderNames[id])
    ));
    if (userIds.length === 0) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("user_id, display_name")
        .in("user_id", userIds);
      if (cancelled) return;
      setSenderNames(prev => {
        const next = { ...prev };
        for (const p of data || []) {
          if ((p as any).user_id) next[(p as any).user_id] = (p as any).display_name || "Unknown user";
        }
        return next;
      });
    })();
    return () => { cancelled = true; };
  }, [messages, senderNames]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Realtime subscription
  useEffect(() => {
    if (demoMode) return;
    const channel = supabase
      .channel("whatsapp-inbox")
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "whatsapp_messages",
      }, (payload: any) => {
        const msg = payload.new as Message & { phone: string; direction: string };
        if (!msg?.id) return;
        const isInsert = payload.eventType === "INSERT";
        // Add/update current thread if matching. Meta status webhooks update
        // existing rows as sent -> delivered -> read -> failed.
        if (msg.phone === selectedPhone) {
          setMessages(prev => mergeMessageByIdentity(prev, msg));
        }
        // Update conversation list
        setConversations(prev => {
          const existing = prev.find(c => c.phone === msg.phone);
          if (existing) {
            return prev.map(c =>
              c.phone === msg.phone
                ? {
                    ...c,
                    ...(isInsert ? {
                      last_message: msg.content,
                      last_direction: msg.direction,
                      last_message_at: msg.created_at,
                    } : {}),
                    unread_count: isInsert && msg.direction === "inbound" && msg.phone !== selectedPhone
                      ? c.unread_count + 1 : c.unread_count,
                  }
                : c
            ).sort((a, b) => new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime());
          }
          return prev;
        });
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [selectedPhone]);

  const handleSendReply = async () => {
    if (!reply.trim() || !selectedPhone) return;
    setSending(true);

    const conv = conversations.find(c => c.phone === selectedPhone && matchesInbox(c))
      || conversations.find(c => c.phone === selectedPhone);

    const currentSenderName = profile?.display_name || user?.email || "You";
    const messageText = reply.trim();
    const localSenderSignature = `${selectedPhone}:${messageText}`;
    if (demoMode) {
      const now = new Date().toISOString();
      const localMessage: Message = {
        id: `demo-local-${Date.now()}`,
        direction: "outbound",
        content: messageText,
        message_type: "text",
        status: "sent",
        template_key: "manual_reply",
        media_url: null,
        created_at: now,
        sender_user_id: "demo-profile",
      };
      setMessages(prev => [...prev, localMessage]);
      setConversations(prev => prev.map(c => c.phone === selectedPhone
        ? { ...c, last_message: messageText, last_direction: "outbound", last_message_at: now, unread_count: 0 }
        : c
      ));
      setLocalSenderNamesBySignature(prev => ({ ...prev, [localSenderSignature]: currentSenderName }));
      setReply("");
      setSending(false);
      return;
    }
    const { data, error } = await invokeEdge<{ message_id?: string; conversation_message_id?: string | null }>("whatsapp-reply", {
      body: {
        phone: selectedPhone,
        message: messageText,
        lead_id: conv?.lead_id || null,
        ...replyChannelPayload(conv),
      },
    });

    if (error) {
      if (error.sessionExpired) {
        toast({ title: "Session expired", description: "Please sign in again, then resend.", variant: "destructive" });
      } else {
        toast({ title: "Failed to send", description: error.message, variant: "destructive" });
      }
    } else {
      setLocalSenderNamesBySignature(prev => ({ ...prev, [localSenderSignature]: currentSenderName }));
      if (data?.message_id) {
        setLocalSenderNamesByWaId(prev => ({ ...prev, [data.message_id!]: currentSenderName }));
      }
      if (data?.conversation_message_id) {
        void invokeEdge("whatsapp-reply-learning", {
          body: {
            action: "ingest_message",
            message_id: data.conversation_message_id,
          },
        });
      }
      setReply("");
    }
    setSending(false);
  };

  const KB_TEMPLATE_KEYS = new Set([
    "kb_apply_link", "kb_campus_addresses", "kb_rankings", "kb_approvals",
    "kb_scholarships", "kb_placements", "kb_eligibility", "kb_fee_structure", "kb_course_details",
  ]);

  const handleSendTemplate = async () => {
    if (!selectedTemplate || !selectedPhone) return;
    setSendingTemplate(true);

    const conv = conversations.find(c => c.phone === selectedPhone && matchesInbox(c))
      || conversations.find(c => c.phone === selectedPhone);
    const leadName = conv?.lead_name || "Student";
    const render = selectedTemplateRender || (selectedTemplateDef
      ? renderWhatsAppTemplate(selectedTemplateDef, templateRenderContext, templateParamOverrides)
      : null);
    const previewText = render?.body || getTemplatePreview(selectedTemplate);
    const appendTemplateBubble = (status: "sent" | "failed", statusError?: any, waMessageId?: string | null) => {
      const now = new Date().toISOString();
      const localMessage: Message = {
        id: waMessageId ? `local-template-${waMessageId}` : `local-template-${status}-${Date.now()}`,
        wa_message_id: waMessageId || null,
        direction: "outbound",
        content: previewText,
        message_type: "template",
        status,
        template_key: selectedTemplate,
        media_url: null,
        created_at: now,
        sender_user_id: demoMode ? "demo-profile" : user?.id || null,
        status_error: statusError || null,
        render_metadata: render,
      };
      setMessages(prev => mergeMessageByIdentity(prev, localMessage));
      setConversations(prev => prev.map(c => c.phone === selectedPhone
        ? { ...c, last_message: previewText, last_direction: "outbound", last_message_at: now, unread_count: 0 }
        : c
      ));
    };

    if (render?.unresolved.length) {
      toast({
        title: "Template details missing",
        description: `Fill ${render.unresolved.map(k => k.replace(/_/g, " ")).join(", ")} before sending.`,
        variant: "destructive",
      });
      setSendingTemplate(false);
      return;
    }

    if (demoMode) {
      appendTemplateBubble("sent", null, `demo-template-${Date.now()}`);
      setSelectedTemplate(null);
      setShowTemplatePicker(false);
      setTemplateParamOverrides({});
      setTemplateSearch("");
      setSendingTemplate(false);
      return;
    }

    // KB quick-reply templates → send as freeform text via whatsapp-reply
    // These only work within the 24-hour WhatsApp conversation window
    if (KB_TEMPLATE_KEYS.has(selectedTemplate)) {
      const { error } = await invokeEdge("whatsapp-reply", {
        body: {
          phone: selectedPhone,
          message: previewText,
          lead_id: conv?.lead_id || null,
          ...replyChannelPayload(conv),
        },
      });
      if (error) {
        const errMsg = error.message || "Unknown error";
        if (error.sessionExpired) {
          toast({ title: "Session expired", description: "Please sign in again, then resend.", variant: "destructive" });
        } else if (errMsg.includes("window") || errMsg.includes("24") || errMsg.includes("expired")) {
          toast({ title: "24-hour window expired", description: "This message can only be sent within 24 hours of the lead's last reply. Use a Meta-approved template instead.", variant: "destructive" });
        } else {
          toast({ title: "Failed to send", description: errMsg, variant: "destructive" });
        }
      } else {
        toast({ title: "Message sent" });
        setSelectedTemplate(null);
        setShowTemplatePicker(false);
        setTemplateParamOverrides({});
        setTemplateSearch("");
      }
      setSendingTemplate(false);
      return;
    }

    // Fetch lead details for accurate template params
    let courseName = "your selected course";
    let campusName = "NIMT campus";
    let leadSource = "enquiry";
    if (conv?.lead_id) {
      const { data: leadInfo } = await supabase
        .from("leads")
        .select("source, courses:course_id(name), campuses:campus_id(name)")
        .eq("id", conv.lead_id)
        .single();
      if (leadInfo) {
        courseName = (leadInfo.courses as any)?.name || courseName;
        campusName = (leadInfo.campuses as any)?.name || campusName;
        leadSource = leadInfo.source || leadSource;
      }
    }

    // Meta-approved templates via whatsapp-send
    let params: string[] = render?.params
      .filter(param => param.required)
      .map(param => param.value) || [];
    let buttonUrls: string[] | undefined;
    switch (selectedTemplate) {
      case "lead_welcome": params = params.length ? params : [leadName, courseName, leadSource]; break;
      case "visit_confirmation": params = [leadName, "the scheduled date", campusName]; buttonUrls = ["1820424915210710582"]; break;
      case "visit_reminder_24hr": params = [leadName, "tomorrow", campusName]; break;
      case "application_received": params = [leadName, "N/A"]; break;
      case "fee_reminder": params = [leadName, "the pending amount", "the due date"]; break;
      case "course_details": params = [leadName, courseName]; break;
      case "nimt_followup_v2": params = [leadName, "soon"]; break;
    }

    const { data, error } = await invokeEdge<any>("whatsapp-send", {
      body: {
        template_key: selectedTemplate,
        phone: selectedPhone,
        params,
        lead_id: conv?.lead_id || null,
        clear_unread_after_send: true,
        rendered_template: render,
        ...(buttonUrls ? { button_urls: buttonUrls } : {}),
      },
    });

    if (error) {
      const errBody = (error as any).data;
      let detail = error.message;
      if (errBody) {
        detail = typeof errBody === "string" ? errBody : errBody?.error || errBody?.meta_error || errBody?.message || JSON.stringify(errBody);
      }
      console.error("whatsapp-send template error:", { error, errBody, data });
      appendTemplateBubble("failed", { message: detail });
      toast({ title: "Failed to send template", description: detail, variant: "destructive" });
    } else if (data?.error) {
      appendTemplateBubble("failed", { message: data.error });
      toast({ title: "Failed to send template", description: data.error, variant: "destructive" });
    } else {
      appendTemplateBubble("sent", null, data?.message_id || null);
      toast({ title: "Template sent" });
      setSelectedTemplate(null);
      setShowTemplatePicker(false);
      setTemplateParamOverrides({});
      setTemplateSearch("");
    }
    setSendingTemplate(false);
  };

  // Build preview text with populated variables
  const getTemplatePreview = (templateKey: string): string => {
    const tmpl = INBOX_TEMPLATES.find(t => t.key === templateKey);
    if (!tmpl) return "";
    return renderWhatsAppTemplate(tmpl, templateRenderContext, templateParamOverrides).body;
  };

  const selectedConv = conversations.find(c => c.phone === selectedPhone && matchesInbox(c))
    || conversations.find(c => c.phone === selectedPhone);

  const selectedTemplateDef = selectedTemplate
    ? INBOX_TEMPLATES.find(t => t.key === selectedTemplate) || null
    : null;

  const templateRenderContext = {
    student_name: selectedCourseInfo?.student_name || selectedConv?.lead_name || null,
    course_name: selectedCourseInfo?.course_name || selectedConv?.course_name || null,
    course_label: selectedCourseInfo?.course_name || selectedConv?.course_name || null,
    lead_source: selectedConv?.lead_source || "WhatsApp enquiry",
    campus_name: selectedCourseInfo?.campus_name || "NIMT campus",
    visit_date: "the scheduled date",
    followup_date: "soon",
    application_id: "N/A",
    amount: "the pending amount",
    due_date: "the due date",
    duration: selectedCourseInfo?.duration || null,
    eligibility: selectedCourseInfo?.eligibility || null,
    approval: selectedCourseInfo?.approval || "NIMT Educational Institutions",
    video_url: selectedCourseInfo?.video_url || null,
    course_url: selectedCourseInfo?.course_url || "https://nimt.ac.in/courses",
    campus_url: selectedCourseInfo?.campus_url || "https://nimt.ac.in/contact",
    apply_url: selectedCourseInfo?.apply_url || "https://uni.nimt.ac.in/apply/nimt",
  };

  const selectedTemplateRender = selectedTemplateDef
    ? renderWhatsAppTemplate(selectedTemplateDef, templateRenderContext, templateParamOverrides)
    : null;

  const visibleTemplates = INBOX_TEMPLATES
    .filter(t => {
      if (!templateSearch.trim()) return true;
      const q = templateSearch.toLowerCase();
      return [t.label, t.key, t.description, inferWhatsAppTemplateCategory(t.key)]
        .some(value => value.toLowerCase().includes(q));
    });

  const templateGroups = visibleTemplates.reduce<Record<string, WhatsAppTemplateDefinition[]>>((groups, template) => {
    const category = template.category || inferWhatsAppTemplateCategory(template.key);
    if (!groups[category]) groups[category] = [];
    groups[category].push(template);
    return groups;
  }, {});

  useEffect(() => {
    setCopilotResult(null);
    setCopilotError(null);
    setShowCopilotPanel(false);
  }, [selectedPhone, businessNumber, isHrScope]);

  const runCopilotAssist = async () => {
    if (!selectedPhone) return;
    setShowCopilotPanel(true);
    setCopilotLoading(true);
    setCopilotError(null);

    const { data, error } = await invokeEdge<CopilotAssistResult>("whatsapp-copilot-assist", {
      body: {
        phone: selectedPhone,
        lead_id: selectedConv?.lead_id || null,
        ...replyChannelPayload(selectedConv),
      },
    });

    setCopilotLoading(false);
    if (error) {
      const message = error.sessionExpired ? "Session expired. Please sign in again." : error.message;
      setCopilotError(message);
      toast({ title: "Copilot unavailable", description: message, variant: "destructive" });
      return;
    }
    if (data) setCopilotResult(data);
  };

  useEffect(() => {
    if (demoMode) {
      if (!selectedConv?.lead_id) { setSelectedCourseInfo(null); return; }
      setSelectedCourseInfo({
        student_name: selectedConv.lead_name || "Student",
        course_name: selectedConv.course_name || "B.Sc Nursing",
        duration: selectedConv.course_name === "MBA" ? "2 years" : "4 years",
        eligibility: "10+2 / graduation as per programme norms",
        approval: "NIMT Educational Institutions",
        campus_name: "Greater Noida campus",
        video_url: "https://nimt.ac.in/courses",
        course_url: "https://nimt.ac.in/courses",
        campus_url: "https://nimt.ac.in/contact",
        apply_url: "https://uni.nimt.ac.in/apply/nimt",
      });
      return;
    }
    if (!selectedConv?.lead_id) { setSelectedCourseInfo(null); return; }
    let cancelled = false;
    (async () => {
      const { data } = await (supabase.rpc as any)("fn_resolve_course_info_params", {
        p_lead_id: selectedConv.lead_id,
      });
      if (!cancelled) setSelectedCourseInfo(data && typeof data === "object" ? data as Record<string, string> : null);
    })();
    return () => { cancelled = true; };
  }, [selectedConv?.lead_id]);

  const getTemplateDefinition = (templateKey: string): WhatsAppTemplateDefinition | null => {
    const knownTemplate = INBOX_TEMPLATES.find(t => t.key === templateKey);
    if (knownTemplate) return knownTemplate;
    const preview = TEMPLATE_MESSAGE_TEXTS[templateKey];
    if (!preview) return null;
    return {
      key: templateKey,
      label: templateKey.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
      description: "Meta-approved WhatsApp template",
      params: Array.from(new Set(
        Array.from(preview.matchAll(/\{\{(\w+)\}\}/g))
          .map(match => match[1])
          .filter(key => !/^\d+$/.test(key))
      )),
      preview,
      category: inferWhatsAppTemplateCategory(templateKey),
      status: "approved",
    };
  };

  const renderStoredTemplate = (templateKey: string) => {
    const text = TEMPLATE_MESSAGE_TEXTS[templateKey];
    if (!text) return null;
    const values: Record<string, string> = {
      student_name: selectedCourseInfo?.student_name || selectedConv?.lead_name || "Student",
      course_name: selectedCourseInfo?.course_name || selectedConv?.course_name || "your selected course",
      course_label: selectedCourseInfo?.course_name || selectedConv?.course_name || "your selected course",
      lead_source: selectedConv?.lead_source || "WhatsApp enquiry",
      campus_name: selectedCourseInfo?.campus_name || "NIMT campus",
      visit_date: "the scheduled date",
      followup_date: "soon",
      application_id: "N/A",
      amount: "the pending amount",
      due_date: "the due date",
      duration: selectedCourseInfo?.duration || "course duration",
      eligibility: selectedCourseInfo?.eligibility || "eligibility criteria",
      approval: selectedCourseInfo?.approval || "NIMT Educational Institutions",
      video_url: selectedCourseInfo?.video_url || "course video link",
      course_url: selectedCourseInfo?.course_url || "https://nimt.ac.in/courses",
      campus_url: selectedCourseInfo?.campus_url || "https://nimt.ac.in/contact",
      apply_url: selectedCourseInfo?.apply_url || "https://uni.nimt.ac.in/apply/nimt",
      "1": selectedCourseInfo?.student_name || selectedConv?.lead_name || "Student",
      "2": selectedCourseInfo?.course_name || selectedConv?.course_name || "your selected course",
      "3": selectedCourseInfo?.course_url || selectedCourseInfo?.duration || "https://nimt.ac.in/courses",
      "4": selectedCourseInfo?.campus_url || selectedCourseInfo?.eligibility || "https://nimt.ac.in/contact",
      "5": selectedCourseInfo?.apply_url || selectedCourseInfo?.approval || "https://uni.nimt.ac.in/apply/nimt",
      "6": selectedCourseInfo?.video_url || "course video link",
    };
    return text.replace(/\{\{(\w+)\}\}/g, (_, key) => values[key] || `{{${key}}}`);
  };

  const getMessageText = (m: Message) => {
    const rendered = getRenderedMessageTemplate(m);
    if (rendered?.body) return rendered.body;
    const fallback = m.content || `[${m.message_type}]`;
    if (!m.template_key) return fallback;
    const match = fallback.match(TEMPLATE_PLACEHOLDER_RE);
    if (!match) return fallback;
    const key = match[1].trim().replace(/\s+/g, "_");
    return renderStoredTemplate(m.template_key) || renderStoredTemplate(key) || fallback;
  };

  const getRenderedMessageTemplate = (m: Message): RenderedWhatsAppTemplate | null => {
    const metadata = (m as any).render_metadata;
    const normalizedMetadata = normalizeRenderedWhatsAppTemplate(metadata);
    if (normalizedMetadata) return normalizedMetadata;
    if (!m.template_key) return null;
    const template = getTemplateDefinition(m.template_key);
    if (!template) return null;
    const placeholderOnly = Boolean(m.content?.match(TEMPLATE_PLACEHOLDER_RE));
    const rendered = renderWhatsAppTemplate(template, templateRenderContext);
    const body = rendered.body || (!placeholderOnly ? m.content : "") || renderStoredTemplate(m.template_key) || "";
    if (!body) return null;
    return {
      key: template.key,
      label: template.label,
      language: template.language || "en",
      category: template.category || inferWhatsAppTemplateCategory(template.key),
      status: template.status || "approved",
      body,
      params: rendered.params,
      unresolved: [],
      buttons: template.buttons || [],
      footer: template.footer,
    };
  };

  const getConversationPreview = (c: Conversation) => {
    const fallback = c.last_message || "[media]";
    const match = fallback.match(TEMPLATE_PLACEHOLDER_RE);
    if (!match) return fallback;
    const key = match[1].trim().replace(/\s+/g, "_");
    const text = TEMPLATE_MESSAGE_TEXTS[key];
    if (!text) return fallback;
    return text.replace(/\{\{(\w+)\}\}/g, (_, param) => {
      if (param === "student_name") return c.lead_name || "Student";
      if (param === "course_name") return c.course_name || "your selected course";
      if (param === "approval") return "NIMT Educational Institutions";
      if (param === "duration") return "course duration";
      if (param === "eligibility") return "eligibility criteria";
      if (param === "video_url") return "course video link";
      return `{{${param}}}`;
    });
  };

  const getOutboundSenderLabel = (m: Message) => {
    if (m.wa_message_id && localSenderNamesByWaId[m.wa_message_id]) return localSenderNamesByWaId[m.wa_message_id];
    if (m.sender_user_id && senderNames[m.sender_user_id]) return senderNames[m.sender_user_id];
    if (m.sender_user_id && m.sender_user_id === user?.id && profile?.display_name) return profile.display_name;
    const localSenderSignature = selectedPhone && m.content ? `${selectedPhone}:${m.content.trim()}` : null;
    if (m.template_key === "manual_reply" && localSenderSignature && localSenderNamesBySignature[localSenderSignature]) {
      return localSenderNamesBySignature[localSenderSignature];
    }
    if (m.template_key === "ai_auto_reply") return "Bot";
    if (m.template_key && m.template_key !== "manual_reply") return "Auto";
    return "Counsellor";
  };

  const STAGE_WA_MESSAGES: Record<string, string> = {
    not_interested:
      "Thank you for your time! 😊 We understand you're not interested at the moment. Should you change your mind in the future, we'd love to help. Best wishes from Team NIMT! 🎓",
    ineligible:
      "Thank you for your interest in NIMT. Based on the details shared, you may not currently meet the eligibility criteria for your preferred programme. However, we offer many other courses that might be a great fit — feel free to reach out anytime. Best wishes! 😊",
    new_lead:
      "Great to hear from you! 🎉 Our counsellor will connect with you shortly to guide you through the admission process. You can also apply online at https://uni.nimt.ac.in/apply/nimt or call us at 📞 +91 9555192192.",
  };

  const markLeadStage = async (leadId: string, stage: string) => {
    const commandByStage: Record<string, WorkflowLeadTransitionCommandName> = {
      not_interested: "classifyNotInterested",
      ineligible: "classifyIneligible",
      new_lead: "classifyLead",
      dnc: "markDnc",
    };
    const command = commandByStage[stage];
    if (!command) return;

    const currentStage = selectedConv?.lead_id === leadId ? selectedConv.lead_stage || "new_lead" : "new_lead";
    const transition = resolveLeadTransitionCommand({ currentStage, command });
    if (!transition.newStage) return;

    await applyResolvedLeadTransition(supabase as any, { leadId, transition });
    setConversations(prev => prev.map(c => c.lead_id === leadId ? { ...c, lead_stage: transition.newStage } : c));

    const message = STAGE_WA_MESSAGES[transition.newStage || stage];
    if (!message || !selectedPhone) {
      toast({ title: "Stage updated" });
      return;
    }

    const { error: replyErr } = await invokeEdge("whatsapp-reply", {
      body: {
        phone: selectedPhone,
        message,
        lead_id: leadId,
        ...replyChannelPayload(selectedConv),
      },
    });

    if (replyErr) {
      toast({
        title: "Stage updated",
        description: replyErr.sessionExpired
          ? "Session expired — sign in again to send the WhatsApp notification."
          : `WhatsApp send failed: ${replyErr.message || "unknown error"}`,
        variant: "destructive",
      });
    } else {
      toast({ title: "Stage updated", description: "WhatsApp notification sent." });
    }
  };

  // Resolve display name: lead name > staff name > phone
  // Course name → short acronym: "Bachelor of Business Administration (BBA)" → "BBA"
  const courseAcronym = (name: string | null) => {
    if (!name) return null;
    // Extract text in parentheses first: "Bachelor of Physiotherapy (BPT)" → "BPT"
    const paren = name.match(/\(([^)]+)\)/);
    if (paren) return paren[1];
    // Fallback: first letters of major words
    return name.split(/\s+/).filter(w => w.length > 2 && w[0] === w[0].toUpperCase()).map(w => w[0]).join("").slice(0, 4) || name.slice(0, 6);
  };

  const sourceLabel = (source: string | null) =>
    source ? source.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()) : null;

  // Format phone: strip 91 prefix for Indian numbers, keep ISD for others
  const formatPhone = (phone: string) => {
    const digits = phone.replace(/\D/g, "");
    if (digits.startsWith("91") && digits.length === 12) return digits.slice(2);
    return phone;
  };
  const getDisplayName = (c: Conversation) => c.lead_name || staffNames[c.phone] || formatPhone(c.phone);
  const isStaffConv = (c: Conversation) => !c.lead_id && !!staffNames[c.phone];

  // Combine real conversations + synthetic staff entries
  const allStaffPhones = new Set(Object.keys(staffNames));
  const loadedConversationPhones = new Set(conversations.map(c => c.phone));
  const syntheticStaffConvs = staffConvs.filter(c => !loadedConversationPhones.has(c.phone));
  const allConvs = (inboxTab === "staff"
    ? [...conversations.filter(c => !c.lead_id && allStaffPhones.has(c.phone)), ...syntheticStaffConvs]
    : conversations).filter(matchesInbox);

  const NON_ADMISSION_ROLES = new Set(["job_applicant", "vendor", "other"]);
  const isOtherCategory = (c: Conversation) => c.lead_person_role && NON_ADMISSION_ROLES.has(c.lead_person_role);
  const isHandoffConversation = (c: Conversation) =>
    c.conversation_state === "needs_counsellor"
    || c.conversation_mode === "human"
    || Boolean(c.handoff_reason);
  const isSlaBreached = (c: Conversation) =>
    Boolean(c.sla_due_at && new Date(c.sla_due_at).getTime() < Date.now());
  const isKnowledgeGap = (c: Conversation) =>
    c.conversation_state === "knowledge_gap" || c.last_bot_action === "knowledge_gap";
  const isUnassignedOps = (c: Conversation) =>
    !c.owner_user_id && !c.counsellor_id && c.has_inbound;
  const isWithinMetaReplyWindow = (iso: string | null | undefined) =>
    Boolean(iso && Date.now() - new Date(iso).getTime() < 24 * 60 * 60 * 1000);
  const isReplyWindowConversation = (c: Conversation) =>
    c.has_inbound
    && c.last_direction === "inbound"
    && c.lead_stage !== "dnc"
    && isWithinMetaReplyWindow(c.last_message_at);

  // Apply mode filter (inbox vs outbound) to get the working set
  const modeFiltered = allConvs.filter(c => {
    if (isOutboundMode) return c.has_inbound === false;
    // Inbox: only conversations with at least one inbound message
    // Synthetic staff entries (no real messages yet, has_inbound undefined) are excluded
    return c.has_inbound === true;
  });

  const filtered = modeFiltered.filter(c => {
    if (opsFilter === "reply_window" && !isReplyWindowConversation(c)) return false;
    if (opsFilter === "handoff" && !isHandoffConversation(c)) return false;
    if (opsFilter === "sla" && !isSlaBreached(c)) return false;
    if (opsFilter === "knowledge" && !isKnowledgeGap(c)) return false;
    if (opsFilter === "unassigned" && !isUnassignedOps(c)) return false;
    // Tab filter
    if (inboxTab === "all") { /* show everything */ }
    else if (inboxTab === "leads" && (!c.lead_id || isOtherCategory(c))) return false;
    else if (inboxTab === "staff" && !allStaffPhones.has(c.phone)) return false;
    else if (inboxTab === "jobs" && c.lead_person_role !== "job_applicant") return false;
    else if (inboxTab === "other" && c.lead_person_role !== "vendor" && c.lead_person_role !== "other") return false;
    // Unreplied-only mode (activated by clicking breakdown pill)
    if (unrepliedOnly && c.unread_count === 0) return false;
    // Search
    if (search) {
      const q = search.toLowerCase();
      return (
        getDisplayName(c).toLowerCase().includes(q) ||
        c.phone.includes(q) ||
        (c.counsellor_name?.toLowerCase().includes(q) ?? false)
      );
    }
    return true;
  }).sort((a, b) => {
    const aReplyNow = isReplyWindowConversation(a) ? 1 : 0;
    const bReplyNow = isReplyWindowConversation(b) ? 1 : 0;
    if (aReplyNow !== bReplyNow) return bReplyNow - aReplyNow;
    if (a.unread_count !== b.unread_count) return b.unread_count - a.unread_count;
    return new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime();
  });

  const totalUnreadMsgs = modeFiltered.reduce((s, c) => s + c.unread_count, 0);
  const totalUnrepliedConvs = modeFiltered.filter(c => c.unread_count > 0).length;

  const leadConvs = modeFiltered.filter(c => c.lead_id && !isOtherCategory(c));
  const leadUnreplied = leadConvs.filter(c => c.unread_count > 0).length;
  const staffConvs2 = [...modeFiltered.filter(c => !c.lead_id && allStaffPhones.has(c.phone)), ...syntheticStaffConvs];
  const staffUnreplied = staffConvs2.filter(c => c.unread_count > 0).length;
  const jobConvs = modeFiltered.filter(c => c.lead_person_role === "job_applicant");
  const jobUnreplied = jobConvs.filter(c => c.unread_count > 0).length;
  const otherConvs = modeFiltered.filter(c => c.lead_person_role === "vendor" || c.lead_person_role === "other");
  const otherUnreplied = otherConvs.filter(c => c.unread_count > 0).length;
  const opsFilters = [
    { key: "all" as const, label: "All ops", count: modeFiltered.length },
    { key: "reply_window" as const, label: "Reply now", count: modeFiltered.filter(isReplyWindowConversation).length },
    { key: "handoff" as const, label: "Handoff", count: modeFiltered.filter(isHandoffConversation).length },
    { key: "sla" as const, label: "SLA", count: modeFiltered.filter(isSlaBreached).length },
    { key: "knowledge" as const, label: "Knowledge", count: modeFiltered.filter(isKnowledgeGap).length },
    { key: "unassigned" as const, label: "Unassigned", count: modeFiltered.filter(isUnassignedOps).length },
  ];

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    if (isToday) return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
    return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
  };

  const getConvDateLabel = (iso: string): string => {
    const d = new Date(iso);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today.getTime() - 86400000);
    const dDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    if (dDay.getTime() === today.getTime()) return "Today";
    if (dDay.getTime() === yesterday.getTime()) return "Yesterday";
    const diffDays = Math.floor((today.getTime() - dDay.getTime()) / 86400000);
    if (diffDays < 7) return d.toLocaleDateString("en-IN", { weekday: "long" });
    return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  };

  // Build grouped conversation list by date (most recent first, like WhatsApp)
  const groupedConvs: { label: string; items: Conversation[] }[] = [];
  const dateGroups: Record<string, Conversation[]> = {};
  for (const c of filtered) {
    const label = getConvDateLabel(c.last_message_at);
    if (!dateGroups[label]) dateGroups[label] = [];
    dateGroups[label].push(c);
  }
  for (const [label, items] of Object.entries(dateGroups)) {
    groupedConvs.push({ label, items });
  }

  const getMsgDateLabel = (iso: string): string => {
    const d = new Date(iso);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today.getTime() - 86400000);
    const dDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    if (dDay.getTime() === today.getTime()) return "Today";
    if (dDay.getTime() === yesterday.getTime()) return "Yesterday";
    return d.toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" });
  };

  if (role && !ALLOWED_ROLES.has(role)) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] text-muted-foreground">
        <p>You don't have access to the WhatsApp Inbox.</p>
      </div>
    );
  }

  if (loading) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="animate-fade-in overflow-hidden">
      <div className="mb-3 hidden items-center justify-between gap-3 sm:flex">
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            {isOutboundMode
              ? (isHrScope ? "HR WhatsApp Outbound" : "WhatsApp Outbound")
              : (isHrScope ? "HR WhatsApp Inbox" : "WhatsApp Inbox")}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {isOutboundMode
              ? `${filtered.length} outbound-only conversation${filtered.length !== 1 ? "s" : ""} (no reply received)`
              : totalUnreadMsgs > 0 || totalUnrepliedConvs > 0
                ? `${totalUnreadMsgs} unread message${totalUnreadMsgs !== 1 ? "s" : ""} · ${totalUnrepliedConvs} unreplied conversation${totalUnrepliedConvs !== 1 ? "s" : ""}`
                : "All caught up"}
          </p>
        </div>
        <div className="flex min-w-0 items-center gap-2">
          {hasOtherInbox && !isHrScope && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex min-w-[260px] items-center gap-2 rounded-lg border border-input bg-background px-3 py-1.5 text-left text-xs font-medium text-foreground transition-colors hover:bg-muted/50 focus:outline-none focus:ring-2 focus:ring-ring/20"
                  title="Select inbox"
                >
                  <WhatsAppInboxIdentity option={selectedInboxOption} compact />
                  <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-[360px] p-1.5">
                {inboxPickerOptions.map(option => (
                  <DropdownMenuItem
                    key={option.id}
                    onSelect={() => { setBusinessNumber(option.id); setSelectedPhone(null); }}
                    className="cursor-pointer p-0 focus:bg-muted"
                  >
                    <WhatsAppInboxIdentity option={option} selected={option.id === businessNumber} />
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {isAdminRole(role) && (
            <button
              onClick={openBackfill}
              className="flex items-center gap-1.5 rounded-lg border border-input bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted/50"
              title="Classify older messages by inbox"
            >
              <Settings className="h-3 w-3" />Backfill Inboxes
            </button>
          )}
          <button
            onClick={() => {
              const base = "/whatsapp-inbox";
              const params = new URLSearchParams();
              if (!isOutboundMode) params.set("mode", "outbound");
              if (isHrScope) params.set("scope", "hr");
              const qs = params.toString();
              navigate(qs ? `${base}?${qs}` : base);
            }}
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
              isOutboundMode
                ? "border-primary bg-primary/10 text-primary"
                : "border-input bg-background text-muted-foreground hover:text-foreground hover:bg-muted/50"
            }`}
          >
            {isOutboundMode ? <MessageSquare className="h-3 w-3" /> : <Send className="h-3 w-3" />}
            {isOutboundMode ? "Switch to Inbox" : "View Outbound"}
          </button>
        </div>
      </div>

      <Card className="overflow-hidden rounded-none border-border/70 bg-[#f0f2f5] shadow-sm sm:rounded-lg">
        <div className="flex h-screen min-h-[620px] sm:h-[calc(100vh-168px)]">
          {/* Conversation list */}
          <div className={`w-full bg-white sm:w-80 lg:w-96 border-r border-slate-200 flex flex-col ${selectedPhone ? "hidden sm:flex" : "flex"}`}>
            {/* Filter pills */}
            <div className="flex flex-wrap gap-1 px-3 py-2 border-b border-border">
              {([
                { key: "all" as const, label: "All", count: modeFiltered.length, unreplied: totalUnrepliedConvs, color: "bg-primary/10 text-primary border-primary/30" },
                { key: "leads" as const, label: "Admission", count: leadConvs.length, unreplied: leadUnreplied, color: "bg-blue-50 text-blue-700 border-blue-200" },
                { key: "staff" as const, label: "Staff", count: staffConvs2.length, unreplied: staffUnreplied, color: "bg-violet-50 text-violet-700 border-violet-200" },
                { key: "jobs" as const, label: "Jobs", count: jobConvs.length, unreplied: jobUnreplied, color: "bg-purple-50 text-purple-700 border-purple-200" },
                { key: "other" as const, label: "Other", count: otherConvs.length, unreplied: otherUnreplied, color: "bg-amber-50 text-amber-700 border-amber-200" },
              ]).map((t) => (
                <button
                  key={t.key}
                  onClick={() => setInboxTab(t.key)}
                  className={`rounded-full px-2.5 py-0.5 text-[10px] font-medium border transition-colors ${
                    inboxTab === t.key ? `${t.color} ring-1 ring-current` : "bg-muted/50 text-muted-foreground border-transparent hover:bg-muted"
                  }`}
                >
                  {t.label} {t.count}{t.unreplied > 0 && (
                    <span className="ml-0.5 inline-flex h-3.5 min-w-[14px] items-center justify-center rounded-full bg-green-500 px-0.5 text-[8px] font-bold text-white">{t.unreplied}</span>
                  )}
                </button>
              ))}
            </div>

            {isAdminRole(role) && (
              <div className="flex flex-wrap gap-1 px-3 py-2 border-b border-border/70 bg-muted/20">
                {opsFilters.map((f) => (
                  <button
                    key={f.key}
                    onClick={() => setOpsFilter(f.key)}
                    className={`rounded-full px-2.5 py-0.5 text-[10px] font-medium border transition-colors ${
                      opsFilter === f.key
                        ? "border-slate-400 bg-slate-100 text-slate-800"
                        : "border-transparent bg-background/70 text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    {f.label} {f.count}
                  </button>
                ))}
              </div>
            )}

            {/* Admin: counsellor filter row */}
            {isAdminRole(role) && (
              <div className="px-3 py-2 border-b border-border bg-muted/20">
                <SelectField
                  value={counsellorFilter}
                  onValueChange={(value) => { setCounsellorFilter(value); setUnrepliedOnly(false); }}
                  options={[
                    { value: "all", label: "All Counsellors" },
                    { value: "unassigned", label: "Unassigned" },
                    ...counsellorList.map((cc) => ({ value: cc.id, label: cc.name })),
                  ]}
                  allowEmpty={false}
                  triggerClassName="h-8 w-full rounded-md border border-input bg-background px-2 py-1 text-xs focus:ring-1 focus:ring-ring/20"
                  ariaLabel="Filter WhatsApp conversations by counsellor"
                />
              </div>
            )}

            <div className="p-3 border-b border-border">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="text"
                  placeholder="Search conversations..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full rounded-lg border border-input bg-background py-2 pl-9 pr-3 text-xs focus:outline-none focus:ring-1 focus:ring-ring/20"
                />
              </div>
            </div>

            {/* Admin: unreplied breakdown panel */}
            {isAdminRole(role) && unrepliedByCC.length > 0 && (
              <div className="border-b border-border bg-amber-50/60 dark:bg-amber-950/20">
                <button
                  onClick={() => setUnrepliedPanelOpen(v => !v)}
                  className="flex w-full items-center justify-between px-3 py-1.5 text-[10px] font-semibold text-amber-700 dark:text-amber-400 uppercase tracking-wide hover:bg-amber-100/40 dark:hover:bg-amber-900/20 transition-colors"
                >
                  <span>Unreplied by Counsellor</span>
                  <ChevronDown className={`h-3 w-3 transition-transform ${unrepliedPanelOpen ? "rotate-180" : ""}`} />
                </button>
                {unrepliedPanelOpen && (
                  <div className="flex flex-wrap gap-1.5 px-3 pb-2">
                    {unrepliedByCC.map((item) => (
                      <button
                        key={item.id}
                        onClick={() => { setCounsellorFilter(item.id === "__unassigned__" ? "unassigned" : item.id); setUnrepliedOnly(true); }}
                        className={`rounded-full px-2 py-0.5 text-[10px] font-medium border transition-colors ${
                          (item.id === "__unassigned__" && counsellorFilter === "unassigned") ||
                          (item.id !== "__unassigned__" && counsellorFilter === item.id)
                            ? "bg-amber-500 border-amber-500 text-white"
                            : "bg-amber-100 dark:bg-amber-900/30 border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-300 hover:bg-amber-200 dark:hover:bg-amber-800/40"
                        }`}
                      >
                        {item.name}: {item.count}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Unreplied-only active indicator */}
            {unrepliedOnly && (
              <div className="flex items-center justify-between px-3 py-1.5 bg-amber-500/10 border-b border-amber-300/40">
                <span className="text-[10px] font-medium text-amber-700">Showing unreplied only</span>
                <button onClick={() => setUnrepliedOnly(false)} className="text-[10px] text-amber-700 hover:underline">
                  Show all
                </button>
              </div>
            )}

            <div
              className="flex-1 overflow-y-auto"
              onScroll={(e) => {
                const el = e.currentTarget;
                if (el.scrollHeight - el.scrollTop - el.clientHeight < 360) {
                  void fetchConversationPage(false);
                }
              }}
            >
              {filtered.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">No conversations yet</p>
              ) : (
                <>
                  {groupedConvs.map((group) => (
                    <div key={group.label}>
                      {/* Date section header */}
                      <div className="sticky top-0 z-10 px-4 py-1 text-[10px] font-semibold uppercase tracking-wide border-b border-border/30 bg-muted/60 backdrop-blur-sm text-muted-foreground">
                        {group.label}
                      </div>
                      {group.items.map((c) => (
                        <button
                          key={`${c.phone}:${c.business_phone_number_id || ""}`}
                          onClick={() => setSelectedPhone(c.phone)}
                            className={`w-full text-left px-3 py-2.5 border-b border-slate-100 transition-colors ${selectedPhone === c.phone ? "bg-[#f0f2f5]" : "hover:bg-[#f5f6f6]"}`}
                          >
                          <div className="flex items-start justify-between gap-2">
                            <Avatar className="mt-0.5 h-10 w-10 shrink-0 bg-slate-100">
                              <AvatarFallback className="bg-emerald-100 text-xs font-semibold text-emerald-700">
                                {getDisplayName(c).slice(0, 2).toUpperCase()}
                              </AvatarFallback>
                            </Avatar>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5">
                                <span className={`text-sm truncate ${c.unread_count > 0 ? "font-semibold text-foreground" : "font-medium text-foreground"}`}>
                                  {getDisplayName(c)}
                                </span>
                                {isStaffConv(c) && (
                                  <Badge variant="outline" className="text-[8px] px-1 py-0 h-3.5 border-violet-300 text-violet-600 dark:text-violet-400">Staff</Badge>
                                )}
                                {c.lead_id && (!c.lead_person_role || c.lead_person_role === "lead" || c.lead_person_role === "applicant") && !isStaffConv(c) && (
                                  <Badge variant="outline" className="text-[8px] px-1 py-0 h-3.5 border-blue-300 text-blue-600">Admission</Badge>
                                )}
                                {c.lead_person_role === "job_applicant" && (
                                  <Badge variant="outline" className="text-[8px] px-1 py-0 h-3.5 border-purple-300 text-purple-600">Job</Badge>
                                )}
                                {c.lead_person_role === "vendor" && (
                                  <Badge variant="outline" className="text-[8px] px-1 py-0 h-3.5 border-amber-300 text-amber-600">Vendor</Badge>
                                )}
                                {c.lead_person_role === "other" && (
                                  <Badge variant="outline" className="text-[8px] px-1 py-0 h-3.5 border-gray-300 text-gray-500">Other</Badge>
                                )}
                                {isReplyWindowConversation(c) && (
                                  <Badge variant="outline" className="text-[8px] px-1 py-0 h-3.5 border-emerald-300 bg-emerald-50 text-emerald-700">24h</Badge>
                                )}
                              </div>
                              <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                                {formatPhone(c.phone)}
                                {c.course_name && <span className="px-1 rounded bg-blue-50 text-blue-600 text-[8px] font-medium">{courseAcronym(c.course_name)}</span>}
                                {c.lead_source && <span className="px-1 rounded bg-emerald-50 text-emerald-700 text-[8px] font-medium capitalize">{sourceLabel(c.lead_source)}</span>}
                                {c.counsellor_name && !isStaffConv(c) && (
                                  <span className="text-[9px] text-muted-foreground/70">· {c.counsellor_name.split(" ")[0]}</span>
                                )}
                              </p>
                              <p className={`text-xs truncate mt-0.5 ${c.unread_count > 0 ? "font-medium text-slate-800" : "text-slate-500"}`}>
                                {c.last_direction === "outbound" ? <span className="text-muted-foreground">You: </span> : ""}{getConversationPreview(c).replace(/\\n/g, " ")}
                              </p>
                            </div>
                            <div className="flex shrink-0 flex-col items-end gap-1">
                              <span className={`text-[10px] whitespace-nowrap ${c.unread_count > 0 ? "text-emerald-600 font-semibold" : "text-muted-foreground"}`}>
                                {formatTime(c.last_message_at)}
                              </span>
                              {c.unread_count > 0 && (
                                <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-[#25d366] px-1.5 text-[10px] font-bold text-white">
                                  {c.unread_count}
                                </span>
                              )}
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  ))}
                  {(loadingMoreConversations || hasMoreConversations) && (
                    <div className="flex items-center justify-center px-4 py-3">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 gap-1.5 text-[10px] text-muted-foreground"
                        disabled={loadingMoreConversations}
                        onClick={() => void fetchConversationPage(false)}
                      >
                        {loadingMoreConversations && <Loader2 className="h-3 w-3 animate-spin" />}
                        {loadingMoreConversations ? "Loading more..." : "Load more"}
                      </Button>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Message thread */}
          <div className={`flex-1 flex flex-col ${!selectedPhone ? "hidden sm:flex" : "flex"}`}>
            {!selectedPhone ? (
              <div className="flex-1 flex items-center justify-center text-muted-foreground">
                <div className="text-center">
                  <MessageSquare className="h-12 w-12 mx-auto mb-3 opacity-30" />
                  {deepLinkNotFound ? (
                    <div className="text-center">
                      <p className="text-sm font-medium text-foreground">Conversation not found</p>
                      <p className="text-xs text-muted-foreground mt-1">No messages found for {phoneFromUrl}. The message may have been unsupported (poll, location, etc.)</p>
                    </div>
                  ) : (
                    <p className="text-sm">Select a conversation</p>
                  )}
                </div>
              </div>
            ) : (
              <>
                {/* Thread header */}
                <div className="sticky top-0 z-20 flex items-center gap-3 border-b border-slate-200 bg-[#f0f2f5] px-3 py-2.5 flex-wrap lg:flex-nowrap">
                  <Button variant="ghost" size="icon" className="sm:hidden h-8 w-8" onClick={() => setSelectedPhone(null)}>
                    <ArrowLeft className="h-4 w-4" />
                  </Button>
                  <Avatar className="h-10 w-10 bg-slate-200">
                    <AvatarFallback className="bg-emerald-100 text-sm font-semibold text-emerald-700">
                      {(selectedConv?.lead_name || selectedPhone || "WA").slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <p className="text-sm font-semibold text-foreground truncate">{selectedConv?.lead_name || (selectedPhone ? formatPhone(selectedPhone) : "")}</p>
                      {selectedConv?.conversation_state && (
                        <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-medium text-slate-700 whitespace-nowrap">
                          {stateLabel(selectedConv.conversation_state)}
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] text-muted-foreground flex items-center gap-1.5 mt-0.5 flex-wrap">
                      {selectedPhone ? formatPhone(selectedPhone) : ""}
                      {selectedConv?.course_name && (
                        <span
                          className="inline-block max-w-[32rem] px-1.5 py-0 rounded bg-blue-100 text-blue-700 text-[9px] font-semibold cursor-pointer hover:bg-blue-200 transition-colors truncate"
                          title={`${selectedConv.course_name} — click to copy`}
                          onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(selectedConv.course_name!); toast({ title: "Copied", description: selectedConv.course_name }); }}
                        >Course: {selectedConv.course_name}</span>
                      )}
                      {selectedConv?.lead_source && (
                        <span
                          className="px-1.5 py-0 rounded bg-emerald-50 text-emerald-700 text-[9px] font-semibold capitalize"
                          title={`Lead source: ${sourceLabel(selectedConv.lead_source)}`}
                        >Source: {sourceLabel(selectedConv.lead_source)}</span>
                      )}
                    </p>
                  </div>
                  <div className="ml-auto flex min-w-0 basis-full items-center gap-2 overflow-x-auto pb-1 sm:basis-auto sm:flex-wrap sm:justify-end sm:overflow-visible sm:pb-0">
                    {selectedConv?.counsellor_name && (
                      <button
                        type="button"
                        title={`${selectedConv.counsellor_name} — click to copy`}
                        onClick={() => { navigator.clipboard.writeText(selectedConv.counsellor_name!); toast({ title: "Copied", description: selectedConv.counsellor_name }); }}
                        className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-violet-100 dark:bg-violet-900/30 border border-violet-200 dark:border-violet-700 px-2.5 py-1.5 text-xs font-medium text-violet-700 dark:text-violet-300 whitespace-nowrap hover:bg-violet-200 dark:hover:bg-violet-900/50 transition-colors"
                      >
                        <User className="h-3 w-3" />
                        {selectedConv.counsellor_name}
                      </button>
                    )}
                    {conversationBusinessKey(selectedConv) && aiMode && (
                      <button
                        onClick={toggleAiMode}
                        disabled={aiModeSaving}
                        title={aiMode === "human"
                          ? "AI is paused — humans handle this chat. Click to re-enable AI auto-reply."
                          : "AI auto-reply is on. Click to pause and handle this chat manually."}
                        className={`flex shrink-0 items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap disabled:opacity-50 ${aiMode === "human"
                          ? "border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
                          : "border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"}`}
                      >
                        {aiMode === "human" ? "🧑 Human" : "🤖 AI"}
                      </button>
                    )}
                    <button
                      onClick={() => {
                        if (copilotResult || copilotError) {
                          setShowCopilotPanel(v => !v);
                        } else {
                          void runCopilotAssist();
                        }
                      }}
                      disabled={copilotLoading}
                      className={`flex shrink-0 items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap disabled:opacity-50 ${
                        showCopilotPanel
                          ? "border-indigo-300 bg-indigo-50 text-indigo-700 hover:bg-indigo-100"
                          : "border-input bg-background text-muted-foreground hover:bg-muted/50"
                      }`}
                    >
                      {copilotLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Bot className="h-3 w-3" />}
                      Copilot
                    </button>
                    {selectedConv?.lead_id && (
                      <button
                        onClick={() => navigate(`/admissions/${selectedConv.lead_id}`)}
                        className="flex shrink-0 items-center gap-1 rounded-lg border border-primary/30 bg-primary/5 px-2.5 py-1.5 text-xs font-medium text-primary hover:bg-primary/10 transition-colors whitespace-nowrap"
                      >
                        View Lead <ExternalLink className="h-3 w-3" />
                      </button>
                    )}
                    {selectedConv?.lead_id && selectedConv?.lead_stage !== "dnc" && (
                      <Button
                        variant="ghost" size="sm"
                        className="shrink-0 gap-1 text-xs text-red-600 hover:text-red-700 hover:bg-red-50"
                        onClick={async () => {
                          if (!selectedConv?.lead_id) return;
                          // Mark DNC first; then send the farewell with bypass_dnc
                          // so the edge function's own DNC guard doesn't swallow it.
                          const dncLeadId = selectedConv.lead_id;
                          const transition = resolveLeadTransitionCommand({
                            currentStage: selectedConv.lead_stage || "new_lead",
                            command: "markDnc",
                          });
                          await applyResolvedLeadTransition(supabase as any, { leadId: dncLeadId, transition });
                          const { error: replyErr } = await invokeEdge("whatsapp-reply", {
                            body: {
                              phone: selectedPhone,
                              message: "You have been added to our Do Not Contact list. We will not reach out to you via call or WhatsApp going forward. If this was a mistake, please reply START or call us at +91 9555192192.",
                              lead_id: dncLeadId,
                              bypass_dnc: true,
                              ...replyChannelPayload(selectedConv),
                            },
                          });
                          // Reflect new DNC status locally so composer disables immediately
                          // without waiting for a view refetch.
                          setConversations(prev => prev.map(c =>
                            c.lead_id === dncLeadId ? { ...c, lead_stage: "dnc" } : c
                          ));
                          if (replyErr) {
                            toast({
                              title: "Lead marked DNC",
                              description: replyErr.sessionExpired
                                ? "Marked, but session expired — sign in again to send the farewell."
                                : `Marked, but farewell send failed: ${replyErr.message || "unknown error"}`,
                              variant: "destructive",
                            });
                          } else {
                            toast({ title: "Lead marked DNC", description: "DNC notification sent via WhatsApp." });
                          }
                        }}
                      >
                        <Ban className="h-3 w-3" /> Mark DNC
                      </Button>
                    )}
                    {selectedConv?.lead_id && selectedConv?.lead_stage === "dnc" && (
                      <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-red-700 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 px-2 py-1 rounded-md">
                        <Ban className="h-3 w-3" /> DNC
                      </span>
                    )}
                  </div>
                </div>
                {/* Quick lead actions — only for lead conversations */}
                {selectedConv?.lead_id && selectedConv?.lead_person_role !== "job_applicant" && selectedConv?.lead_person_role !== "vendor" && (
                  <div className="flex items-center gap-1.5 overflow-x-auto px-3 py-1.5 border-b border-border bg-amber-50/40 dark:bg-amber-950/10 sm:flex-wrap">
                    <span className="text-[9px] text-muted-foreground mr-0.5 shrink-0">Quick:</span>
                    {selectedConv?.lead_stage !== "not_interested" && (
                      <button
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-red-200 bg-red-50 text-red-700 text-[10px] font-medium hover:bg-red-100 transition-colors"
                        onClick={() => selectedConv?.lead_id && markLeadStage(selectedConv.lead_id, "not_interested")}
                      ><ThumbsDown className="h-3 w-3" /> Not Interested</button>
                    )}
                    {selectedConv?.lead_stage !== "ineligible" && (
                      <button
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-orange-200 bg-orange-50 text-orange-700 text-[10px] font-medium hover:bg-orange-100 transition-colors"
                        onClick={() => selectedConv?.lead_id && markLeadStage(selectedConv.lead_id, "ineligible")}
                      ><AlertOctagon className="h-3 w-3" /> Ineligible</button>
                    )}
                    {selectedConv?.lead_stage !== "new_lead" && selectedConv?.lead_stage !== "application_in_progress" && (
                      <button
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-green-200 bg-green-50 text-green-700 text-[10px] font-medium hover:bg-green-100 transition-colors"
                        onClick={() => selectedConv?.lead_id && markLeadStage(selectedConv.lead_id, "new_lead")}
                      ><ThumbsUp className="h-3 w-3" /> Interested</button>
                    )}
                    <button
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-blue-200 bg-blue-50 text-blue-700 text-[10px] font-medium hover:bg-blue-100 transition-colors"
                      onClick={() => { setFollowupDate(""); setFollowupNote(""); setFollowupOpen(true); }}
                    ><CalendarPlus className="h-3 w-3" /> Create Followup</button>
                  </div>
                )}

                {/* Category bar — visible for all conversations */}
                <div className="flex items-center gap-1 overflow-x-auto px-3 py-1 border-b border-border bg-muted/20">
                  <span className="text-[9px] text-muted-foreground mr-1 shrink-0">Mark as:</span>
                  {([
                    { value: "lead", label: "Admission", color: "border-blue-300 bg-blue-50 text-blue-700", activeColor: "ring-2 ring-blue-400 bg-blue-100" },
                    { value: "job_applicant", label: "Job Applicant", color: "border-purple-300 bg-purple-50 text-purple-700", activeColor: "ring-2 ring-purple-400 bg-purple-100" },
                    { value: "vendor", label: "Vendor", color: "border-amber-300 bg-amber-50 text-amber-700", activeColor: "ring-2 ring-amber-400 bg-amber-100" },
                    { value: "other", label: "Other", color: "border-gray-300 bg-gray-50 text-gray-600", activeColor: "ring-2 ring-gray-400 bg-gray-100" },
                  ] as const).map(cat => {
                    const currentRole = selectedConv?.lead_person_role || "lead";
                    const isActive = currentRole === cat.value;
                    return (
                      <button key={cat.value}
                        onClick={async () => {
                          if (!selectedPhone) return;
                          let leadId = selectedConv?.lead_id;

                          // Create a lead if one doesn't exist
                          if (!leadId) {
                            const { data: newLead } = await supabase.from("leads").insert({
                              phone: selectedPhone.startsWith("+") ? selectedPhone : `+${selectedPhone}`,
                              name: selectedConv?.lead_name || selectedPhone,
                              source: "whatsapp",
                              stage: cat.value === "lead" ? "new_lead" : "not_interested",
                              person_role: cat.value,
                            } as any).select("id").single();
                            if (newLead) {
                              leadId = newLead.id;
                              // Link conversation to lead
                              await supabase.from("whatsapp_messages" as any)
                                .update({ lead_id: leadId })
                                .eq("phone", selectedPhone.replace(/\D/g, ""));
                            }
                          } else {
                            await supabase.from("leads").update({ person_role: cat.value, category_locked: true } as any).eq("id", leadId);
                          }

                          setConversations(prev => prev.map(c =>
                            c.phone === selectedPhone ? { ...c, lead_person_role: cat.value, lead_id: leadId || c.lead_id } : c
                          ));

                          // Log training data for learning model
                          const inboundMsgs = messages
                            .filter(m => m.direction === "inbound" && m.content && m.content !== "[unsupported]")
                            .map(m => m.content)
                            .join(" ");
                          if (inboundMsgs) {
                            supabase.rpc("log_category_training" as any, {
                              _category: cat.value,
                              _message_text: inboundMsgs,
                              _phone: selectedPhone,
                            }).catch(() => {}); // non-blocking
                          }

                          toast({ title: "Categorized", description: `Marked as ${cat.label}` });
                        }}
                        className={`px-2 py-0.5 rounded-md border text-[10px] font-medium transition-all ${
                          isActive ? `${cat.color} ${cat.activeColor}` : `${cat.color} opacity-50 hover:opacity-100`
                        }`}
                      >
                        {cat.label}
                      </button>
                    );
                  })}
                </div>

                {showCopilotPanel && (
                  <div className="border-b border-border bg-indigo-50/50 dark:bg-indigo-950/20">
                    <div className="flex items-center justify-between gap-2 px-4 py-2 border-b border-indigo-100 dark:border-indigo-900/50">
                      <div className="flex min-w-0 items-center gap-2">
                        <Bot className="h-4 w-4 shrink-0 text-indigo-600 dark:text-indigo-300" />
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-indigo-900 dark:text-indigo-200">Copilot</p>
                          {copilotResult?.model_unavailable && (
                            <p className="text-[10px] text-amber-700 dark:text-amber-300">Model fallback response</p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 gap-1.5 px-2 text-[10px]"
                          disabled={copilotLoading}
                          onClick={() => void runCopilotAssist()}
                        >
                          {copilotLoading && <Loader2 className="h-3 w-3 animate-spin" />}
                          Refresh
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => setShowCopilotPanel(false)}
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>

                    <div className="px-4 py-3">
                      {copilotLoading ? (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          Reading thread...
                        </div>
                      ) : copilotError ? (
                        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                          {copilotError}
                        </div>
                      ) : copilotResult ? (
                        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(260px,0.9fr)]">
                          <div className="space-y-2">
                            <div>
                              <p className="text-[10px] font-semibold uppercase tracking-wide text-indigo-700 dark:text-indigo-300">Summary</p>
                              <p className="mt-0.5 text-xs leading-relaxed text-foreground">{copilotResult.summary}</p>
                            </div>
                            <div className="grid gap-2 sm:grid-cols-2">
                              <div className="rounded-md border border-indigo-100 bg-background/80 px-3 py-2">
                                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Intent</p>
                                <p className="mt-0.5 text-xs font-medium text-foreground">{copilotResult.intent}</p>
                              </div>
                              <div className="rounded-md border border-indigo-100 bg-background/80 px-3 py-2">
                                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Next Action</p>
                                <p className="mt-0.5 text-xs font-medium text-foreground">{copilotResult.next_action_label}</p>
                                <p className="mt-0.5 text-[10px] text-muted-foreground">{copilotResult.next_action_reason}</p>
                              </div>
                            </div>
                            <div className="flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
                              <span className="rounded-full border border-indigo-200 bg-background/80 px-2 py-0.5">
                                Confidence {Math.round(copilotResult.confidence * 100)}%
                              </span>
                              {copilotResult.should_pause_ai && (
                                <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-amber-700">
                                  Human review
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="rounded-md border border-indigo-100 bg-background/90 p-3">
                            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Draft Reply</p>
                            <p className="mt-2 max-h-32 overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed text-foreground">
                              {copilotResult.draft_reply}
                            </p>
                            <div className="mt-3 flex flex-wrap items-center gap-2">
                              <Button
                                type="button"
                                size="sm"
                                className="h-8 gap-1.5 text-xs"
                                disabled={selectedConv?.lead_stage === "dnc"}
                                onClick={() => {
                                  setReply(copilotResult.draft_reply);
                                  toast({ title: "Draft added to composer" });
                                }}
                              >
                                <Send className="h-3 w-3" />
                                Use Draft
                              </Button>
                              {copilotResult.should_pause_ai && aiMode !== "human" && conversationBusinessKey(selectedConv) && (
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="h-8 gap-1.5 text-xs"
                                  disabled={aiModeSaving}
                                  onClick={() => void toggleAiMode()}
                                >
                                  <Ban className="h-3 w-3" />
                                  Pause AI
                                </Button>
                              )}
                            </div>
                          </div>
                        </div>
                      ) : (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8 gap-1.5 text-xs"
                          onClick={() => void runCopilotAssist()}
                        >
                          <Bot className="h-3.5 w-3.5" />
                          Generate
                        </Button>
                      )}
                    </div>
                  </div>
                )}

                {/* Messages */}
                <div
                  className="flex-1 overflow-y-auto px-3 py-3 sm:px-6 space-y-1.5"
                  style={{
                    backgroundColor: "#efeae2",
                    backgroundImage:
                      "radial-gradient(circle at 1px 1px, rgba(17, 94, 89, 0.08) 1px, transparent 0)",
                    backgroundSize: "18px 18px",
                  }}
                >
                  {messages.map((m, i) => {
                    const prevMsg = messages[i - 1];
                    const showDateChip = !prevMsg || getMsgDateLabel(m.created_at) !== getMsgDateLabel(prevMsg.created_at);
                    const renderedTemplate = getRenderedMessageTemplate(m);
                    const isOutbound = m.direction === "outbound";
                    const failedMessage = m.status === "failed";
                    const statusErrorText = typeof m.status_error?.error?.message === "string"
                      ? m.status_error.error.message
                      : typeof m.status_error?.meta_error === "string"
                        ? m.status_error.meta_error
                        : typeof m.status_error?.message === "string"
                          ? m.status_error.message
                          : null;
                    return (
                    <div key={m.id}>
                      {showDateChip && (
                        <div className="flex justify-center my-2">
                          <span className="rounded-md bg-white/80 px-3 py-1 text-[10px] font-medium text-slate-600 shadow-sm">
                            {getMsgDateLabel(m.created_at)}
                          </span>
                        </div>
                      )}
                    <div className={`flex ${isOutbound ? "justify-end" : "justify-start"}`}>
                      <div className={`max-w-[82%] rounded-lg px-3 py-2 text-slate-900 shadow-sm sm:max-w-[68%] ${
                        isOutbound
                          ? failedMessage
                            ? "bg-red-50 ring-1 ring-red-200"
                            : "bg-[#d9fdd3] rounded-tr-sm"
                          : "bg-white rounded-tl-sm"
                      }`}>
                        {renderedTemplate && (
                          <div className="mb-2 rounded-md border border-emerald-200/80 bg-white/70 p-2">
                            <div className="mb-1 flex flex-wrap items-center gap-1.5">
                              <span className="rounded-sm bg-emerald-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-emerald-700">
                                Template
                              </span>
                              <span className="text-[10px] font-medium text-slate-700">{renderedTemplate.label}</span>
                              <span className="text-[10px] text-slate-500">{renderedTemplate.language.toUpperCase()}</span>
                            </div>
                            {renderedTemplate.buttons.length > 0 && (
                              <div className="mt-2 flex flex-wrap gap-1">
                                {renderedTemplate.buttons.map(button => (
                                  <span key={button} className="rounded border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                                    {button}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                        {/* Media rendering */}
                        {m.media_url && m.message_type === "image" ? (
                          /^\d/.test(m.media_url) ? (
                            <p className="text-sm italic opacity-70">[Media - tap to view]</p>
                          ) : (
                            <img src={m.media_url} alt="image" className="rounded-lg max-w-[240px] mb-1" loading="lazy" />
                          )
                        ) : m.media_url && m.message_type === "video" ? (
                          /^\d/.test(m.media_url) ? (
                            <p className="text-sm italic opacity-70">[Media - tap to view]</p>
                          ) : (
                            <video src={m.media_url} controls className="rounded-lg max-w-[240px] mb-1" />
                          )
                        ) : m.media_url && m.message_type === "audio" ? (
                          /^\d/.test(m.media_url) ? (
                            <p className="text-sm italic opacity-70">[Media - tap to view]</p>
                          ) : (
                            <audio src={m.media_url} controls className="mb-1 max-w-[240px]" />
                          )
                        ) : m.media_url && m.message_type === "document" ? (
                          /^\d/.test(m.media_url) ? (
                            <p className="text-sm italic opacity-70">[Media - tap to view]</p>
                          ) : (
                            <a href={m.media_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-sm underline mb-1">
                              <FileDown className="h-4 w-4" /> Download document
                            </a>
                          )
                        ) : null}
                        {/* Text content / caption */}
                        {(m.content || (!m.media_url && m.message_type !== "text")) && (
                          <p className="whitespace-pre-wrap text-[13px] leading-relaxed">{getMessageText(m).replace(/\\n/g, "\n")}</p>
                        )}
                        {failedMessage && (
                          <div className="mt-2 rounded-md border border-red-200 bg-red-100/70 p-2 text-[11px] text-red-800">
                            <div className="flex items-start gap-2">
                              <AlertOctagon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                              <div className="min-w-0 flex-1">
                                <p className="font-semibold">Message failed</p>
                                {statusErrorText && <p className="mt-0.5 break-words">{statusErrorText}</p>}
                              </div>
                              {statusErrorText && (
                                <button
                                  type="button"
                                  className="shrink-0 text-[10px] font-semibold underline"
                                  onClick={() => navigator.clipboard.writeText(statusErrorText)}
                                >
                                  Copy
                                </button>
                              )}
                            </div>
                          </div>
                        )}
                        <div className="flex items-center justify-end gap-1 mt-0.5">
                          {isOutbound && (() => {
                            const label = getOutboundSenderLabel(m);
                            if (label === "Bot") {
                              return <span className="inline-flex items-center gap-0.5 text-[8px] opacity-50"><Bot className="h-2.5 w-2.5" /> Bot</span>;
                            }
                            if (label === "Auto") {
                              return <span className="inline-flex items-center gap-0.5 text-[8px] opacity-50"><Cpu className="h-2.5 w-2.5" /> Auto</span>;
                            }
                            return <span className="text-[8px] opacity-50">{label}</span>;
                          })()}
                          <span className="text-[9px] opacity-60">
                            {new Date(m.created_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true })}
                          </span>
                          {isOutbound && (
                            <DeliveryReceipt status={m.status} />
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                    );
                  })}
                  <div ref={messagesEndRef} />
                </div>

                <Dialog
                  open={showTemplatePicker && selectedConv?.lead_stage !== "dnc"}
                  onOpenChange={(open) => {
                    setShowTemplatePicker(open);
                    if (!open) {
                      setSelectedTemplate(null);
                      setTemplateSearch("");
                      setTemplateParamOverrides({});
                    }
                  }}
                >
                  <DialogContent className="max-h-[86vh] max-w-5xl overflow-hidden p-0">
                    <DialogHeader className="border-b px-4 py-3">
                      <DialogTitle className="flex items-center gap-2 text-sm">
                        <LayoutTemplate className="h-4 w-4 text-emerald-600" />
                        Send WhatsApp Template
                      </DialogTitle>
                    </DialogHeader>
                    <div className="grid min-h-[620px] grid-cols-1 md:grid-cols-[300px_1fr]">
                      <div className="border-r bg-slate-50/70">
                        <div className="border-b p-3">
                          <div className="relative">
                            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                            <input
                              value={templateSearch}
                              onChange={e => setTemplateSearch(e.target.value)}
                              placeholder="Search templates"
                              className="h-9 w-full rounded-full border border-input bg-white pl-9 pr-3 text-xs outline-none focus:ring-2 focus:ring-emerald-500/20"
                            />
                          </div>
                        </div>
                        <div className="max-h-[540px] overflow-y-auto p-2">
                          {Object.entries(templateGroups).map(([category, templates]) => (
                            <div key={category} className="mb-3">
                              <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                                {category.replace(/_/g, " ")}
                              </p>
                              <div className="space-y-1">
                                {templates.map(t => (
                                  <button
                                    key={t.key}
                                    onClick={() => {
                                      setSelectedTemplate(t.key);
                                      setTemplateParamOverrides({});
                                    }}
                                    className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
                                      selectedTemplate === t.key
                                        ? "border-emerald-300 bg-emerald-50"
                                        : "border-transparent bg-white hover:border-slate-200 hover:bg-slate-100"
                                    }`}
                                  >
                                    <div className="flex items-center justify-between gap-2">
                                      <p className="truncate text-xs font-semibold text-slate-900">{t.label}</p>
                                      <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-emerald-700">
                                        {t.status || "approved"}
                                      </span>
                                    </div>
                                    <p className="mt-0.5 line-clamp-2 text-[10px] leading-snug text-slate-500">{t.description}</p>
                                  </button>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="flex min-h-0 flex-col">
                        <div className="border-b px-4 py-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                              <p className="text-xs font-semibold text-slate-900">
                                {selectedTemplateRender?.label || "Select a template"}
                              </p>
                              <p className="mt-0.5 text-[10px] text-muted-foreground">
                                To {selectedConv?.lead_name || selectedPhone} · {selectedInboxOption?.label || "WhatsApp"}
                              </p>
                            </div>
                            {selectedTemplateRender && (
                              <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                                <span className="rounded bg-slate-100 px-2 py-1 font-medium text-slate-700">{selectedTemplateRender.language.toUpperCase()}</span>
                                <span className="rounded bg-emerald-100 px-2 py-1 font-medium capitalize text-emerald-700">{selectedTemplateRender.category}</span>
                                <span className="rounded bg-blue-100 px-2 py-1 font-medium text-blue-700">
                                  {(() => {
                                    const lastInbound = [...messages].reverse().find(m => m.direction === "inbound");
                                    return lastInbound && Date.now() - new Date(lastInbound.created_at).getTime() < 24 * 60 * 60 * 1000
                                      ? "Reply window open"
                                      : "Template re-engagement";
                                  })()}
                                </span>
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[1fr_260px]">
                          <div
                            className="min-h-[360px] overflow-y-auto p-5"
                            style={{
                              backgroundColor: "#efeae2",
                              backgroundImage: "radial-gradient(circle at 1px 1px, rgba(17,94,89,.08) 1px, transparent 0)",
                              backgroundSize: "18px 18px",
                            }}
                          >
                            {selectedTemplateRender ? (
                              <div className="ml-auto max-w-[86%] rounded-lg rounded-tr-sm bg-[#d9fdd3] px-3 py-2 text-slate-900 shadow-sm sm:max-w-[72%]">
                                <div className="mb-2 rounded-md border border-emerald-200 bg-white/70 p-2">
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    <span className="rounded-sm bg-emerald-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-emerald-700">
                                      Template preview
                                    </span>
                                    <span className="text-[10px] font-medium text-slate-700">{selectedTemplateRender.label}</span>
                                  </div>
                                </div>
                                <p className="whitespace-pre-wrap text-[13px] leading-relaxed">{selectedTemplateRender.body}</p>
                                {selectedTemplateRender.buttons.length > 0 && (
                                  <div className="mt-3 space-y-1">
                                    {selectedTemplateRender.buttons.map(button => (
                                      <div key={button} className="rounded-md border border-emerald-200 bg-white/70 px-3 py-1.5 text-center text-xs font-semibold text-emerald-700">
                                        {button}
                                      </div>
                                    ))}
                                  </div>
                                )}
                                <div className="mt-1 flex justify-end gap-1 text-[9px] text-slate-500">
                                  <span>{new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true })}</span>
                                  <span className="text-sky-600">✓✓</span>
                                </div>
                              </div>
                            ) : (
                              <div className="flex h-full items-center justify-center text-center text-xs text-slate-500">
                                Select a template to see the exact WhatsApp bubble before sending.
                              </div>
                            )}
                          </div>

                          <div className="border-l bg-white p-3">
                            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                              Template variables
                            </p>
                            {selectedTemplateRender ? (
                              <div className="space-y-2">
                                {selectedTemplateRender.params.length === 0 && (
                                  <p className="rounded-md bg-slate-50 p-3 text-xs text-muted-foreground">No variables required.</p>
                                )}
                                {selectedTemplateRender.params.map(param => (
                                  <label key={param.key} className="block">
                                    <span className="mb-1 flex items-center justify-between text-[10px] font-medium text-slate-600">
                                      {param.label}
                                      {param.required && !param.resolved && <span className="text-red-600">Required</span>}
                                    </span>
                                    <input
                                      value={templateParamOverrides[param.key] ?? param.value}
                                      onChange={e => setTemplateParamOverrides(prev => ({ ...prev, [param.key]: e.target.value }))}
                                      className={`h-8 w-full rounded-md border px-2 text-xs outline-none focus:ring-2 focus:ring-emerald-500/20 ${
                                        param.required && !param.resolved ? "border-red-300 bg-red-50" : "border-input"
                                      }`}
                                    />
                                  </label>
                                ))}
                              </div>
                            ) : (
                              <p className="rounded-md bg-slate-50 p-3 text-xs text-muted-foreground">Choose a template from the list.</p>
                            )}
                          </div>
                        </div>

                        <DialogFooter className="border-t px-4 py-3">
                          <Button
                            variant="ghost"
                            onClick={() => {
                              setShowTemplatePicker(false);
                              setSelectedTemplate(null);
                              setTemplateParamOverrides({});
                            }}
                            disabled={sendingTemplate}
                          >
                            Cancel
                          </Button>
                          <Button
                            className="gap-1.5 bg-emerald-600 hover:bg-emerald-700"
                            disabled={!selectedTemplateRender || selectedTemplateRender.unresolved.length > 0 || sendingTemplate}
                            onClick={handleSendTemplate}
                          >
                            {sendingTemplate ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                            Send Template
                          </Button>
                        </DialogFooter>
                      </div>
                    </div>
                  </DialogContent>
                </Dialog>

                {/* Quick replies panel — hidden for DNC leads */}
                {showQuickReplies && selectedConv?.lead_stage !== "dnc" && (
                  <div className="border-t border-border bg-muted/20 px-4 py-2">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Quick Replies</p>
                      <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => setShowQuickReplies(false)}>
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {QUICK_REPLIES.map((qr) => (
                        <button
                          key={qr.label}
                          onClick={() => { setReply(qr.text); setShowQuickReplies(false); }}
                          className="rounded-full border border-primary/30 bg-primary/5 px-3 py-1 text-xs font-medium text-primary hover:bg-primary/10 transition-colors"
                        >
                          {qr.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Reply composer */}
                {(() => {
                  const lastInbound = [...messages].reverse().find(m => m.direction === "inbound");
                  const withinWindow = lastInbound && (Date.now() - new Date(lastInbound.created_at).getTime()) < 24 * 60 * 60 * 1000;
                  const isDnc = selectedConv?.lead_stage === "dnc";

                  // DNC takes precedence over the 24h window — no messages of
                  // any kind (free-form OR template) can go to a DNC lead.
                  if (isDnc) {
                    return (
                      <div className="px-4 py-3 border-t border-border">
                        <div className="flex items-start gap-2 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 px-3 py-2.5">
                          <Ban className="h-4 w-4 text-red-600 dark:text-red-400 mt-0.5 shrink-0" />
                          <div className="text-xs text-red-800 dark:text-red-300">
                            <strong>This lead is on the Do Not Contact list.</strong>
                            <p className="mt-0.5">No further messages can be sent — neither free-form replies nor templates. To resume contact, change the lead's stage from DNC.</p>
                          </div>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div className="border-t border-slate-200 bg-[#f0f2f5] px-3 py-3">
                      {!withinWindow && !showTemplatePicker && (
                        <div className="flex items-start gap-2 rounded-lg bg-yellow-50 dark:bg-yellow-950/40 border border-yellow-200 dark:border-yellow-800 px-3 py-2 mb-2">
                          <AlertTriangle className="h-4 w-4 text-yellow-600 dark:text-yellow-400 mt-0.5 shrink-0" />
                          <p className="text-xs text-yellow-800 dark:text-yellow-300">
                            The 24-hour conversation window has expired. Use a template message to re-engage this contact.
                          </p>
                        </div>
                      )}
                      <form
                        onSubmit={(e) => { e.preventDefault(); handleSendReply(); }}
                        className="flex items-center gap-2"
                      >
                        <Button
                          type="button"
                          variant={showTemplatePicker ? "default" : "ghost"}
                          size="icon"
                          className="h-10 w-10 shrink-0 rounded-full text-slate-600 hover:bg-slate-200"
                          onClick={() => { setShowTemplatePicker(!showTemplatePicker); setSelectedTemplate(null); }}
                          title="Send template message"
                        >
                          <LayoutTemplate className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          variant={showQuickReplies ? "default" : "ghost"}
                          size="icon"
                          className="h-10 w-10 shrink-0 rounded-full text-slate-600 hover:bg-slate-200"
                          onClick={() => setShowQuickReplies(!showQuickReplies)}
                          title="Quick replies"
                          disabled={!withinWindow}
                        >
                          <Zap className="h-4 w-4" />
                        </Button>
                        <input
                          type="text"
                          value={reply}
                          onChange={(e) => setReply(e.target.value)}
                          placeholder={withinWindow ? "Type a message..." : "Window expired — use template"}
                          disabled={!withinWindow}
                          className="h-11 flex-1 rounded-full border-0 bg-white px-4 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                        />
                        <Button type="submit" disabled={!withinWindow || !reply.trim() || sending} size="icon" className="h-10 w-10 rounded-full bg-emerald-600 hover:bg-emerald-700">
                          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                        </Button>
                      </form>
                      {withinWindow && !showTemplatePicker && !showQuickReplies && (
                        <p className="text-[10px] text-muted-foreground mt-1">Free-form replies only work within 24hrs of last inbound message. Use templates otherwise.</p>
                      )}
                    </div>
                  );
                })()}
              </>
            )}
          </div>
        </div>
      </Card>

      {/* Create Followup dialog */}
      <Dialog open={followupOpen} onOpenChange={setFollowupOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CalendarPlus className="h-4 w-4" /> Schedule Followup
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-foreground">Date &amp; Time</label>
              <input
                type="datetime-local"
                value={followupDate}
                onChange={e => setFollowupDate(e.target.value)}
                className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-foreground">Note (optional)</label>
              <textarea
                value={followupNote}
                onChange={e => setFollowupNote(e.target.value)}
                rows={2}
                placeholder="e.g. Interested in MBA, wants fee details"
                className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm resize-none"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setFollowupOpen(false)} disabled={followupSaving}>Cancel</Button>
            <Button
              disabled={!followupDate || followupSaving}
              onClick={async () => {
                if (!selectedConv?.lead_id || !followupDate) return;
                setFollowupSaving(true);
                try {
                  await supabase.from("lead_followups" as any).insert({
                    lead_id: selectedConv.lead_id,
                    scheduled_at: new Date(followupDate).toISOString(),
                    type: "whatsapp",
                    notes: followupNote || "WhatsApp followup",
                    status: "pending",
                    assigned_to: selectedConv.counsellor_id || null,
                  });
                  toast({ title: "Followup scheduled", description: new Date(followupDate).toLocaleString("en-IN") });
                  setFollowupOpen(false);
                } catch (e: any) {
                  toast({ title: "Couldn't save followup", description: e.message, variant: "destructive" });
                } finally {
                  setFollowupSaving(false);
                }
              }}
            >
              {followupSaving && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Inbox backfill dialog */}
      <Dialog open={backfillOpen} onOpenChange={setBackfillOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Settings className="h-4 w-4" />Backfill Older Messages by Inbox
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <p className="text-xs text-muted-foreground">
              For threads still untagged, threads where UniOs ever sent a message go to <strong>primary</strong>;
              the rest are assumed to be on the <strong>secondary</strong> number (AiSensy etc.).
              Already-tagged threads aren't touched.
            </p>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">Primary phone_number_id</label>
              <input
                value={bfPrimaryPnid} onChange={e => setBfPrimaryPnid(e.target.value)}
                placeholder="e.g. 1234567890123"
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm font-mono"
              />
              <input
                value={bfPrimaryNumber} onChange={e => setBfPrimaryNumber(e.target.value)}
                placeholder="Display number, e.g. +91 90000 00000"
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">Secondary phone_number_id (AiSensy)</label>
              <input
                value={bfSecondaryPnid} onChange={e => setBfSecondaryPnid(e.target.value)}
                placeholder="e.g. 9876543210987"
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm font-mono"
              />
              <input
                value={bfSecondaryNumber} onChange={e => setBfSecondaryNumber(e.target.value)}
                placeholder="Display number"
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
              />
            </div>

            {bfResult && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">
                <div className="font-semibold mb-1">Done</div>
                <div>Primary: {bfResult.primary_threads ?? 0} threads · {bfResult.primary_messages ?? 0} messages</div>
                <div>Secondary: {bfResult.secondary_threads ?? 0} threads · {bfResult.secondary_messages ?? 0} messages</div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setBackfillOpen(false)} disabled={bfRunning}>Close</Button>
            <Button onClick={runBackfill} disabled={bfRunning}>
              {bfRunning && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}Run Backfill
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default WhatsAppInbox;
