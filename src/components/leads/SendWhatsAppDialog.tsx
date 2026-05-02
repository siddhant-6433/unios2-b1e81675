import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { MessageSquare, Send, Loader2, Check } from "lucide-react";

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

const getVideoUrl = (courseName?: string, campusName?: string): string => {
  const text = `${courseName || ""} ${campusName || ""}`;
  const match = COURSE_VIDEO_MAP.find(m => m.pattern.test(text));
  return match?.url || DEFAULT_VIDEO_URL;
};

const TEMPLATES = [
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
    key: "course_info_video",
    label: "Course Info + Video",
    description: "Course details + campus video auto-attached",
    badge: "Video",
    followUpMsg: (courseName?: string, campusName?: string) => `🎥 Watch our campus video: ${getVideoUrl(courseName, campusName)}`,
    buildParams: (lead: any, courseName?: string, campusName?: string, courseDuration?: number) => [
      lead.name,
      courseName || "your selected course",
      courseDuration ? `${courseDuration} year(s)` : "N/A",
      "As per university norms",
      campusName || "NIMT Educational Institutions",
    ],
    preview: "Hi {{1}}, here's everything about {{2}}:\n📅 Duration: {{3}}\n📋 Eligibility: {{4}}\n📍 Campus: {{5}}\n\n🎥 Campus video will be sent as follow-up",
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

  const selectedTmpl = TEMPLATES.find(t => t.key === selectedTemplate);
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
          body: JSON.stringify({ template_key: selectedTemplate, phone: lead.phone, params, lead_id: lead.id, ...(button_urls ? { button_urls } : {}) }),
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
            <MessageSquare className="h-5 w-5 text-green-600" />
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
            {TEMPLATES.map((t) => (
              <button
                key={t.key}
                onClick={() => setSelectedTemplate(t.key)}
                className={`w-full text-left px-4 py-2.5 transition-colors flex items-start gap-3 ${
                  selectedTemplate === t.key
                    ? "bg-green-50 dark:bg-green-950/20 border-l-2 border-l-green-500"
                    : "text-foreground hover:bg-muted/50 border-l-2 border-l-transparent"
                }`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className={`text-sm font-medium ${selectedTemplate === t.key ? "text-green-700 dark:text-green-400" : ""}`}>{t.label}</p>
                    {t.badge === "Video" && <span className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-red-100 text-red-600">VIDEO</span>}
                    {t.badge === "Location" && <span className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-blue-100 text-blue-600">LOCATION</span>}
                    {(t as any).isQuickReply && <span className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-violet-100 text-violet-600">KB</span>}
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5">{t.description}</p>
                </div>
                {selectedTemplate === t.key && <Check className="h-4 w-4 text-green-600 shrink-0 mt-0.5" />}
              </button>
            ))}
          </div>
        </div>

        {/* Preview */}
        {selectedTemplate && (
          <div className="space-y-1.5">
            <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Preview</p>
            <div className="rounded-xl bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800/40 p-3">
              <p className="text-xs text-green-900 dark:text-green-200 whitespace-pre-wrap leading-relaxed">
                {previewText}
              </p>
            </div>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => handleClose(false)} disabled={sending}>
            Cancel
          </Button>
          <Button
            onClick={handleSend}
            disabled={!selectedTemplate || sending || sent}
            className="gap-2 bg-green-600 hover:bg-green-700"
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
