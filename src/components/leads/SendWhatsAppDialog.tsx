import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { MessageSquare, Send, Loader2, Check } from "lucide-react";
import {
  WhatsAppTemplatePreviewBubble,
  templateTextPreviewFromComponents,
  type WhatsAppTemplateComponent,
} from "@/components/templates/WhatsAppTemplatePreviewBubble";
import {
  cahetDeadlineDescription,
  cahetDeadlineMessage,
} from "@/lib/deadlineRollover";

// Course/institution → video URL mapping (matched against actual NIMT courses)
const COURSE_VIDEO_MAP: { pattern: RegExp; url: string; label: string }[] = [
  // Nursing & Allied Health
  { pattern: /b\.?sc.*nurs|nursing/i, url: "https://youtu.be/CyLpFGx67u4?si=7CepKXL3Dm2GfmaK", label: "B.Sc Nursing" },
  { pattern: /gnm|general\s*nursing/i, url: "https://youtu.be/CyLpFGx67u4?si=7CepKXL3Dm2GfmaK", label: "GNM" },
  // Physiotherapy
  { pattern: /bpt|bachelor.*physiotherapy/i, url: "https://youtu.be/CyLpFGx67u4?si=7CepKXL3Dm2GfmaK", label: "BPT" },
  { pattern: /dpt|diploma.*physiotherapy/i, url: "https://youtu.be/CyLpFGx67u4?si=7CepKXL3Dm2GfmaK", label: "DPT" },
  { pattern: /mpt|master.*physiotherapy/i, url: "https://youtu.be/CyLpFGx67u4?si=7CepKXL3Dm2GfmaK", label: "MPT" },
  // Radiology & Imaging
  { pattern: /bmrit|radiology|imaging/i, url: "https://youtu.be/CyLpFGx67u4?si=7CepKXL3Dm2GfmaK", label: "BMRIT" },
  { pattern: /mmrit|m\.?sc.*radiology/i, url: "https://youtu.be/CyLpFGx67u4?si=7CepKXL3Dm2GfmaK", label: "MMRIT" },
  // OTT
  { pattern: /ott|operation\s*theat/i, url: "https://youtu.be/CyLpFGx67u4?si=7CepKXL3Dm2GfmaK", label: "D-OTT" },
  // Pharmacy
  { pattern: /d\.?pharm|diploma.*pharm/i, url: "https://youtu.be/CyLpFGx67u4?si=7CepKXL3Dm2GfmaK", label: "D.Pharma" },
  // Management
  { pattern: /mba|master.*business/i, url: "https://youtu.be/CyLpFGx67u4?si=7CepKXL3Dm2GfmaK", label: "MBA" },
  { pattern: /pgdm|post.*graduate.*diploma.*management/i, url: "https://youtu.be/CyLpFGx67u4?si=7CepKXL3Dm2GfmaK", label: "PGDM" },
  { pattern: /bba|bachelor.*business/i, url: "https://youtu.be/CyLpFGx67u4?si=7CepKXL3Dm2GfmaK", label: "BBA" },
  { pattern: /bca|bachelor.*computer/i, url: "https://youtu.be/CyLpFGx67u4?si=7CepKXL3Dm2GfmaK", label: "BCA" },
  // Law
  { pattern: /ballb|ba\s*llb/i, url: "https://youtu.be/CyLpFGx67u4?si=7CepKXL3Dm2GfmaK", label: "BA LLB" },
  { pattern: /llb|bachelor.*law/i, url: "https://youtu.be/CyLpFGx67u4?si=7CepKXL3Dm2GfmaK", label: "LLB" },
  // Education
  { pattern: /b\.?ed|bachelor.*education/i, url: "https://youtu.be/CyLpFGx67u4?si=7CepKXL3Dm2GfmaK", label: "B.Ed" },
  { pattern: /d\.?el\.?ed|diploma.*elementary/i, url: "https://youtu.be/CyLpFGx67u4?si=7CepKXL3Dm2GfmaK", label: "D.El.Ed" },
  // Schools
  { pattern: /beacon|bsa|bsav|cbse|grade|nursery|lkg|ukg|toddler/i, url: "https://www.instagram.com/reel/DXuOmFMkVXQ/", label: "NIMT Beacon School" },
  { pattern: /mirai|mes|pyp|myp|eyp|montessori|ib/i, url: "https://www.instagram.com/p/DXMsuIBgYwF/", label: "Mirai School" },
];
const DEFAULT_VIDEO_URL = "https://youtu.be/CyLpFGx67u4?si=7CepKXL3Dm2GfmaK";
const CUET_2026_COUNSELLING_IMAGE_URL =
  "https://deylhigsisuexszsmypq.supabase.co/storage/v1/object/public/whatsapp-media/template-assets/cuet_2026_counselling_open.jpeg";
const CUET_2026_COUNSELLING_PREVIEW =
  "The CUET 2026 result is out, and admission counselling is now open at NIMT.\n\nIf you're planning your next step after CUET, we're here to help.\n\nDuring your counselling session, our admission expert will guide you with:\n\n• Choosing the right course for your career goals\n• Scholarship opportunities based on your CUET score\n• Admission process, eligibility, fees, and required documents\n• Placements, internships, and career opportunities\n\nWe look forward to helping you build a successful future.\n\nTeam NIMT Educational Institutions";
const CUET_COUNSELLING_BOOKING_PREVIEW =
  "CUET counselling booking is now open at NIMT. Share this approved Meta template with CUET leads so they can book a counselling session with the admissions team.";
const DEFAULT_VISIBLE_WHEN_UNCONFIGURED = new Set([
  "cuet_2026_counselling_open",
  "cuet_counselling_booking",
]);

interface WhatsAppPickerTemplate {
  key: string;
  label: string;
  description: string;
  badge: string | null;
  followUpMsg: null | string | ((courseName?: string, campusName?: string) => string);
  buildParams: (lead: any, courseName?: string, campusName?: string, courseDuration?: number, courseType?: string) => string[];
  preview: string;
  headerImageUrl?: string;
  isQuickReply?: boolean;
  quickReplyText?: string;
}

const hasDynamicUrlButton = (components?: Array<{ type?: string; buttons?: Array<{ type?: string; url?: string }> }> | null) =>
  (components || []).some((component) =>
    component.type === "BUTTONS" &&
    (component.buttons || []).some((button) => button.type === "URL" && typeof button.url === "string" && button.url.includes("{{"))
  );

const getVideoUrl = (courseName?: string, campusName?: string): string => {
  const text = `${courseName || ""} ${campusName || ""}`;
  const match = COURSE_VIDEO_MAP.find(m => m.pattern.test(text));
  return match?.url || DEFAULT_VIDEO_URL;
};

const TEMPLATES: WhatsAppPickerTemplate[] = [
  {
    key: "lead_welcome",
    label: "Lead Welcome",
    description: "Welcome message with course info",
    badge: null,
    followUpMsg: null,
    buildParams: (lead: any, courseName?: string) => [lead.name, courseName || "your selected course", lead.source || "Website"],
    preview: "Hi {{1}}, welcome to NIMT Educational Institutions! We're excited about your interest in {{2}}. Our counsellor will connect with you shortly.",
  },
  {
    key: "course_info_video_v2",
    label: "Course Info + Video",
    description: "Course page, campus location & apply link + campus video",
    badge: "Video",
    followUpMsg: (courseName?: string, campusName?: string) => `🎥 Watch our campus video: ${getVideoUrl(courseName, campusName)}`,
    // Empty params → whatsapp-send resolves course page / campus Maps / apply
    // links per-lead (with /courses listing & /contact fallbacks) server-side.
    buildParams: () => [],
    preview: "Hi {{1}}, here are the details you requested for {{2}}:\n📚 Course information: <course page or /courses>\n📍 Campus locations: <campus map or /contact>\n📝 Application portal: uni.nimt.ac.in/apply/nimt\n\n🎥 Campus video will be sent as follow-up",
  },
  {
    key: "bpt_bmrit_cahet_deadline",
    label: "BPT/BMRIT CAHET Deadline",
    description: cahetDeadlineDescription(),
    badge: "Deadline",
    followUpMsg: null,
    buildParams: () => [],
    preview: cahetDeadlineMessage(),
  },
  {
    key: "cnet_not_qualified_bpt_bmrit",
    label: "CNET Not Qualified → BPT/BMRIT",
    description: "Bilingual CNET result follow-up with BPT/BMRIT and CAHET instructions",
    badge: "CNET",
    followUpMsg: null,
    buildParams: (lead: any) => [lead.name],
    preview: "Dear {{1}}\n\nCNET result is declared. If you have NOT qualified, you can still choose healthcare career options: *BPT* or *BMRIT*.\n\nLast date: *14th June 2026*.\n\nBoth are mandatory:\n1. NIMT application: https://apply.nimt.ac.in\n2. *ABVMUP CAHET registration by 14th June, 11:59 PM*: https://www.abvmucet26.co.in/entrance2026/login?form=4\n\nHelp: 7428499849, 9667641872, 9555192192\n\n---\n\nप्रिय {{1}}\n\nCNET result आ गया है। यदि आप qualify नहीं हुए हैं, तब भी healthcare career के लिए *BPT* या *BMRIT* option है।\n\nLast date: *14th June 2026*.\n\nदोनों mandatory हैं:\n1. NIMT application: https://apply.nimt.ac.in\n2. *ABVMUP CAHET registration by 14th June, 11:59 PM*: https://www.abvmucet26.co.in/entrance2026/login?form=4\n\nHelp: 7428499849, 9667641872, 9555192192",
  },
  {
    key: "cuet_2026_counselling_open",
    label: "CUET 2026 Counselling Open",
    description: "CUET result follow-up with counselling guidance",
    badge: "CUET",
    followUpMsg: null,
    buildParams: () => [],
    headerImageUrl: CUET_2026_COUNSELLING_IMAGE_URL,
    preview: CUET_2026_COUNSELLING_PREVIEW,
  },
  {
    key: "cuet_counselling_booking",
    label: "CUET Counselling Booking",
    description: "Approved CUET counselling booking template",
    badge: "CUET",
    followUpMsg: null,
    buildParams: () => [],
    preview: CUET_COUNSELLING_BOOKING_PREVIEW,
  },
  {
    key: "course_details",
    label: "Course Details",
    description: "Send course information",
    badge: null,
    followUpMsg: null,
    buildParams: (lead: any, courseName?: string) => [lead.name, courseName || "your selected course"],
    preview: "Hi {{1}}, here are the details for {{2}} at NIMT Educational Institutions. Feel free to reach out with any questions!",
  },
  {
    key: "kb_placements",
    label: "Placements & Packages",
    description: "Placement stats, top recruiters, packages",
    badge: null,
    followUpMsg: null,
    buildParams: () => [],
    isQuickReply: true,
    quickReplyText: "💼 *NIMT Placement Highlights*\n\n📈 Highest Package: INR 18.75 LPA\n📊 Average Package: INR 5.40 LPA\n🏢 1,200+ corporate placement partners\n🎯 60+ companies visit campus annually\n\n*Top Recruiters:*\nFortis, KPMG, Cognizant, ICICI Bank, Wipro, HCL, Dell, Airtel, Kotak Mahindra, Infosys, Deloitte, TCS\n\n*By Course:*\n• MBA/PGDM: Highest 18.75 LPA, Avg 5.40 LPA\n• B.Sc Nursing: Highest 10 LPA, Avg 3 LPA (~98% placement)\n• BPT: Hospitals & sports medicine\n• Law: Top law firms & corporate legal\n\nWant placement details for a specific course?",
    preview: "💼 NIMT Placement Highlights\n📈 Highest: 18.75 LPA | Avg: 5.40 LPA\n🏢 1,200+ recruiters | 60+ campus drives\nTop: KPMG, Wipro, Deloitte, TCS, Infosys...",
  },
  {
    key: "kb_internships",
    label: "Internships",
    description: "Paid internship details for healthcare courses",
    badge: null,
    followUpMsg: null,
    buildParams: () => [],
    isQuickReply: true,
    quickReplyText: "🏥 *Paid Internship Program at NIMT*\n\n💰 Stipend: ₹10,000/month\n📍 At our own 500-bed campus hospital\n⏱️ Duration: As per university norms\n\n*Available for:*\n• B.Sc Nursing — clinical rotations\n• GNM — hospital posting\n• BPT — physiotherapy clinic\n• D-OTT — operation theatre training\n• BMRIT — radiology & imaging\n\n*Benefits:*\n✅ Real patient experience from Day 1\n✅ Paid stipend during training\n✅ Hospital placement priority after graduation\n✅ International placement opportunities (Nursing)\n\nWould you like to know more about a specific course's internship?",
    preview: "🏥 Paid Internships: ₹10K/month\nAt our 500-bed campus hospital\nFor: Nursing, GNM, BPT, OTT, BMRIT",
  },
  {
    key: "kb_rankings",
    label: "Rankings & Recognition",
    description: "NIMT rankings, approvals, accreditations",
    badge: "Video",
    followUpMsg: () => "🎥 Watch NIMT Rankings & Campus Tour: https://youtu.be/CyLpFGx67u4?si=7CepKXL3Dm2GfmaK",
    buildParams: () => [],
    isQuickReply: true,
    quickReplyText: "🏆 *NIMT Rankings & Recognition*\n\n⭐ #1 in UP — EW Higher Education Rankings\n📊 Ranked 34th B-School — Business India\n⭐ PGDM ranked #8 in India\n📰 #57 Law in India — India Today 2025\n🎖️ AA+ rated — Digital Learning Magazine\n✅ 6 institutions NIRF ranked 2025\n\n*Approvals:*\nAICTE, UGC, Bar Council of India, NCTE, Indian Nursing Council, Pharmacy Council of India\n\n*Affiliations:*\nAKTU, GGSIPU, ABVMU, CCSU, University of Rajasthan\n\n🏫 Est. 1987 — 37+ years in education\n5 campuses, 36+ programmes, 21 colleges\n\nWould you like to know more about a specific course?",
    preview: "🏆 NIMT Rankings\n⭐ #1 in UP | #8 PGDM | #57 Law India\n✅ 6 NIRF ranked | AA+ rated\n🎥 Rankings video auto-attached",
  },
  {
    key: "visit_confirmation",
    label: "Visit Confirmation",
    description: "Confirm scheduled campus visit with location",
    badge: "Location",
    followUpMsg: (_c?: string, campusName?: string) => `📍 Campus Location: https://maps.google.com/?q=${encodeURIComponent((campusName || "NIMT Greater Noida") + " NIMT")}`,
    buildParams: (lead: any, courseName?: string, campusName?: string) => [lead.name, "your scheduled date", campusName || "NIMT Educational Institutions"],
    preview: "Hi {{1}}, your campus visit is confirmed for {{2}} at {{3}}.\n\n📍 Google Maps location will be sent as follow-up",
  },
  {
    key: "visit_reminder_24hr",
    label: "Visit Reminder",
    description: "Remind about upcoming visit with location",
    badge: "Location",
    followUpMsg: (_c?: string, campusName?: string) => `📍 Campus Location: https://maps.google.com/?q=${encodeURIComponent((campusName || "NIMT Greater Noida") + " NIMT")}`,
    buildParams: (lead: any, courseName?: string, campusName?: string) => [lead.name, "tomorrow", campusName || "NIMT Educational Institutions"],
    preview: "Hi {{1}}, reminder: your campus visit is scheduled for {{2}} at {{3}}.\n\n📍 Google Maps location will be sent as follow-up",
  },
  {
    key: "application_received",
    label: "Application Received",
    description: "Acknowledge application submission",
    badge: null,
    followUpMsg: null,
    buildParams: (lead: any) => [lead.name, lead.application_id || "N/A"],
    preview: "Hi {{1}}, we've received your application (ID: {{2}}). Our admissions team will review it shortly.",
  },
  {
    key: "fee_reminder",
    label: "Fee Reminder",
    description: "Remind about pending fee payment",
    badge: null,
    followUpMsg: null,
    buildParams: (lead: any) => [lead.name, "the pending amount", "the due date"],
    preview: "Hi {{1}}, this is a reminder that your fee of ₹{{2}} is due by {{3}}. Please complete the payment to secure your seat.",
  },
  {
    key: "student_welcome",
    label: "Student Welcome",
    description: "Welcome on admission (PAN/AN)",
    badge: null,
    followUpMsg: null,
    buildParams: (lead: any, courseName?: string, campusName?: string) => [lead.name, lead.admission_no || lead.pre_admission_no || "N/A", courseName || "your course", campusName || "NIMT Educational Institutions"],
    preview: "Congratulations {{1}}!\n\nWelcome to NIMT Educational Institutions.\n\nAdmission No: {{2}}\nCourse: {{3}}\nCampus: {{4}}\n\nAccess portal: https://uni.nimt.ac.in",
  },
  {
    key: "applicant_welcome",
    label: "Applicant Welcome",
    description: "Welcome on application start",
    badge: null,
    followUpMsg: null,
    buildParams: (lead: any, courseName?: string) => [lead.name, lead.application_id || "N/A", courseName || "your selected course"],
    preview: "Hi {{1}}, thank you for starting your application!\n\nApplication ID: {{2}}\nCourse: {{3}}\n\nComplete at: https://uni.nimt.ac.in/apply/nimt",
  },
];

interface SendWhatsAppDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lead: {
    id: string;
    name: string;
    phone: string;
    application_id?: string | null;
    source?: string | null;
  };
  courseName?: string;
  campusName?: string;
  courseDuration?: number;
  courseType?: string;
  onSuccess?: () => void;
}

export function SendWhatsAppDialog({ open, onOpenChange, lead, courseName, campusName, courseDuration, courseType, onSuccess }: SendWhatsAppDialogProps) {
  const { toast } = useToast();
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  // Visibility set from whatsapp_template_settings — only templates with
  // show_in_lead_picker=true (AND any team/user scoping the admin set) are
  // surfaced. While loading we render nothing rather than the full
  // hardcoded list, so admins who toggle a template off see it disappear
  // immediately instead of after a refresh.
  const [allowedKeys, setAllowedKeys] = useState<Set<string> | null>(null);
  const [dynamicTemplates, setDynamicTemplates] = useState<WhatsAppPickerTemplate[]>([]);
  const [metaTemplateOverrides, setMetaTemplateOverrides] = useState<Record<string, Partial<Pick<WhatsAppPickerTemplate, "preview">>>>({});
  const [templateComponentsByKey, setTemplateComponentsByKey] = useState<Record<string, WhatsAppTemplateComponent[]>>({});

  useEffect(() => {
    if (!open) return;
    (async () => {
      setDynamicTemplates([]);
      setMetaTemplateOverrides({});
      setTemplateComponentsByKey({});
      const { data: { user } } = await supabase.auth.getUser();
      const { data, error } = await (supabase as any)
        .from("whatsapp_template_settings")
        .select("template_key, display_name, description, category, show_in_lead_picker, allowed_team_ids, allowed_user_ids");
      if (error) {
        // Fail open — show everything rather than a blank picker.
        setAllowedKeys(new Set(TEMPLATES.map(t => t.key)));
        setDynamicTemplates([]);
        setTemplateComponentsByKey({});
        return;
      }
      const userId = user?.id || null;
      const keys = new Set<string>();
      const settingsRows = (data || []) as Array<{
        template_key: string;
        display_name?: string | null;
        description?: string | null;
        category?: string | null;
        show_in_lead_picker?: boolean | null;
        allowed_team_ids?: string[] | null;
        allowed_user_ids?: string[] | null;
      }>;
      const settingsByKey = new Map(settingsRows.map((row) => [row.template_key, row]));
      settingsRows.forEach((r: any) => {
        if (r.show_in_lead_picker !== true) return;
        const teamScoped = Array.isArray(r.allowed_team_ids) && r.allowed_team_ids.length > 0;
        const userScoped = Array.isArray(r.allowed_user_ids) && r.allowed_user_ids.length > 0;
        // Team scoping (when active) is enforced server-side via RLS-aware
        // joins in a future iteration. For now, user-scoping is honored
        // client-side; team-scoping falls through to all-users.
        if (userScoped && (!userId || !r.allowed_user_ids.includes(userId))) return;
        if (teamScoped) {
          // No team check client-side yet; trust the admin's intent and show.
          // (Admins choosing to set allowed_team_ids should also set
          // allowed_user_ids if they want hard enforcement.)
        }
        keys.add(r.template_key);
      });
      TEMPLATES.forEach((template) => {
        if (DEFAULT_VISIBLE_WHEN_UNCONFIGURED.has(template.key) && !settingsByKey.has(template.key)) {
          keys.add(template.key);
        }
      });
      setAllowedKeys(keys);
      const knownKeys = new Set(TEMPLATES.map((template) => template.key));
      const { data: approvedRows } = await (supabase as any)
        .from("whatsapp_templates")
        .select("name, components, placeholder_count, has_media, header_format")
        .eq("status", "APPROVED");
      const overrides: Record<string, Partial<Pick<WhatsAppPickerTemplate, "preview">>> = {};
      const componentsByKey: Record<string, WhatsAppTemplateComponent[]> = {};
      ((approvedRows || []) as Array<{
        name: string;
        components?: WhatsAppTemplateComponent[] | null;
      }>).forEach((row) => {
        if (row.name && row.components) componentsByKey[row.name] = row.components;
        if (!row.name || !knownKeys.has(row.name)) return;
        const preview = templateTextPreviewFromComponents(row.components);
        if (preview) overrides[row.name] = { preview };
      });
      setMetaTemplateOverrides(overrides);
      setTemplateComponentsByKey(componentsByKey);
      const dynamic = ((approvedRows || []) as Array<{
        name: string;
        components?: WhatsAppTemplateComponent[] | null;
        placeholder_count?: number | null;
        has_media?: boolean | null;
        header_format?: string | null;
      }>)
        .filter((row) =>
          row.name &&
          keys.has(row.name) &&
          !knownKeys.has(row.name) &&
          row.placeholder_count === 0 &&
          row.has_media !== true &&
          !["IMAGE", "VIDEO", "DOCUMENT"].includes(String(row.header_format || "").toUpperCase()) &&
          !hasDynamicUrlButton(row.components)
        )
        .map((row) => {
          const setting = settingsByKey.get(row.name);
          const body = row.components?.find((component) => component.type === "BODY")?.text || setting?.description || row.name;
          return {
            key: row.name,
            label: setting?.display_name || row.name.replace(/_/g, " "),
            description: setting?.description || "Approved Meta template",
            badge: null,
            followUpMsg: null,
            buildParams: () => [],
            preview: templateTextPreviewFromComponents(row.components) || body,
          };
        });
      setDynamicTemplates(dynamic);
    })();
  }, [open]);

  const visibleTemplates = useMemo(() => {
    if (!allowedKeys) return [];
    const configuredTemplates = TEMPLATES.map((template) => ({ ...template, ...(metaTemplateOverrides[template.key] || {}) }));
    return [...configuredTemplates, ...dynamicTemplates].filter(t => allowedKeys.has(t.key));
  }, [allowedKeys, dynamicTemplates, metaTemplateOverrides]);

  const selectedTmpl = visibleTemplates.find(t => t.key === selectedTemplate) || TEMPLATES.find(t => t.key === selectedTemplate);
  const previewParams = selectedTmpl?.buildParams(lead, courseName, campusName, courseDuration, courseType) || [];
  const previewText = selectedTmpl?.preview.replace(/\{\{(\d+)\}\}/g, (_, idx) => previewParams[parseInt(idx) - 1] || "…") || "";

  const handleSend = async () => {
    if (!selectedTemplate || !selectedTmpl) return;
    setSending(true);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      const authHeaders = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken || anonKey}`,
        apikey: anonKey,
      };

      // KB quick replies → send as freeform text via whatsapp-reply
      if ((selectedTmpl as any).isQuickReply && (selectedTmpl as any).quickReplyText) {
        const response = await fetch(`${supabaseUrl}/functions/v1/whatsapp-reply`, {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({ phone: lead.phone, message: (selectedTmpl as any).quickReplyText, lead_id: lead.id }),
        });
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          toast({ title: "Failed to send", description: body?.error || `HTTP ${response.status}`, variant: "destructive" });
          setSending(false);
          return;
        }
      } else {
        // Template-based send
        const params = selectedTmpl.buildParams(lead, courseName, campusName, courseDuration, courseType);
        // Build button_urls for templates with dynamic URL buttons
        let button_urls: string[] | undefined;
        if (selectedTemplate === "course_info_video") {
          const campusQuery = encodeURIComponent((campusName || "NIMT Greater Noida").replace(/\s+/g, "+"));
          button_urls = [campusQuery, "nimt"];
        }
        const response = await fetch(`${supabaseUrl}/functions/v1/whatsapp-send`, {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            template_key: selectedTemplate,
            phone: lead.phone,
            params,
            lead_id: lead.id,
            ...(button_urls ? { button_urls } : {}),
            ...((selectedTmpl as any).headerImageUrl ? { header_image_url: (selectedTmpl as any).headerImageUrl } : {}),
          }),
        });
        const responseBody = await response.json().catch(() => ({ error: "Invalid response" }));
        if (!response.ok) {
          const detail = responseBody?.error || responseBody?.meta_error || `HTTP ${response.status}`;
          toast({ title: "Failed to send", description: detail, variant: "destructive" });
          setSending(false);
          return;
        }
      }

      // Send follow-up message (video link, location, etc.) if defined
      if (selectedTmpl.followUpMsg) {
        const followUp = typeof selectedTmpl.followUpMsg === "function"
          ? selectedTmpl.followUpMsg(courseName, campusName)
          : selectedTmpl.followUpMsg;
        if (followUp) {
          await fetch(`${supabaseUrl}/functions/v1/whatsapp-reply`, {
            method: "POST",
            headers: authHeaders,
            body: JSON.stringify({ phone: lead.phone, message: followUp, lead_id: lead.id }),
          }).catch(() => {});
        }
      }

      setSending(false);

      setSent(true);
      toast({ title: "WhatsApp sent successfully" });
      setTimeout(() => {
        setSent(false);
        setSelectedTemplate(null);
        onOpenChange(false);
        onSuccess?.();
      }, 1200);
    } catch (e: any) {
      setSending(false);
      console.error("whatsapp-send exception:", e);
      toast({ title: "Failed to send", description: e.message, variant: "destructive" });
    }
  };

  const handleClose = (v: boolean) => {
    if (!sending) {
      setSelectedTemplate(null);
      setSent(false);
      onOpenChange(v);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5 text-success" />
            Send WhatsApp
          </DialogTitle>
        </DialogHeader>

        {/* Recipient info */}
        <div className="flex items-center justify-between py-2 px-1">
          <div>
            <p className="text-[11px] text-muted-foreground">Sending to</p>
            <p className="text-sm font-medium text-foreground">{lead.name}</p>
          </div>
          <p className="text-sm text-muted-foreground font-mono">{lead.phone}</p>
        </div>

        {/* Template selection */}
        <div className="space-y-1.5">
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Choose Template</p>
          <div className="border border-border rounded-xl overflow-hidden divide-y divide-border max-h-[220px] overflow-y-auto">
            {allowedKeys === null && (
              <div className="px-4 py-3 text-xs text-muted-foreground flex items-center gap-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading templates…
              </div>
            )}
            {allowedKeys !== null && visibleTemplates.length === 0 && (
              <div className="px-4 py-6 text-xs text-muted-foreground text-center">
                No templates available. Ask an admin to enable templates in Template Manager → Template Visibility.
              </div>
            )}
            {visibleTemplates.map((t) => (
              <button
                key={t.key}
                onClick={() => setSelectedTemplate(t.key)}
                className={`w-full text-left px-4 py-2.5 transition-colors flex items-start gap-3 ${
                  selectedTemplate === t.key
                    ? "bg-success/5 dark:bg-success/90/20 border-l-2 border-l-green-500"
                    : "text-foreground hover:bg-muted/50 border-l-2 border-l-transparent"
                }`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className={`text-sm font-medium ${selectedTemplate === t.key ? "text-success dark:text-success" : ""}`}>{t.label}</p>
                    {t.badge === "Video" && <span className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-destructive/10 text-destructive">VIDEO</span>}
                    {t.badge === "Location" && <span className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-info/10 text-info-foreground">LOCATION</span>}
                    {(t as any).isQuickReply && <span className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-primary/10 text-primary">KB</span>}
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5">{t.description}</p>
                </div>
                {selectedTemplate === t.key && <Check className="h-4 w-4 text-success shrink-0 mt-0.5" />}
              </button>
            ))}
          </div>
        </div>

        {/* Preview */}
        {selectedTemplate && (
          <div className="space-y-1.5">
            <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Preview</p>
            <WhatsAppTemplatePreviewBubble
              templateKey={selectedTemplate}
              components={templateComponentsByKey[selectedTemplate]}
              bodyText={previewText}
              fallbackText={previewText}
              className="max-h-[280px] overflow-y-auto"
            />
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => handleClose(false)} disabled={sending}>
            Cancel
          </Button>
          <Button
            onClick={handleSend}
            disabled={!selectedTemplate || sending || sent}
            className="gap-2 bg-success hover:bg-success/60"
          >
            {sending ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> Sending...</>
            ) : sent ? (
              <><Check className="h-4 w-4" /> Sent!</>
            ) : (
              <><Send className="h-4 w-4" /> Send WhatsApp</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
