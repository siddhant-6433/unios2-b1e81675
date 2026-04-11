import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { MessageSquare, Send, Loader2, Check } from "lucide-react";

const TEMPLATES = [
  {
    key: "lead_welcome",
    label: "Lead Welcome",
    description: "Welcome message with course info",
    buildParams: (lead: any, courseName?: string) => [lead.name, courseName || "your selected course", lead.source || "Website"],
    preview: "Hi {{1}}, welcome to NIMT Educational Institutions! We're excited about your interest in {{2}}. Our counsellor will connect with you shortly.",
  },
  {
    key: "visit_confirmation",
    label: "Visit Confirmation",
    description: "Confirm scheduled campus visit",
    buildParams: (lead: any, courseName?: string, campusName?: string) => [lead.name, "your scheduled date", campusName || "NIMT Educational Institutions"],
    preview: "Hi {{1}}, your campus visit is confirmed for {{2}} at {{3}}. We look forward to welcoming you!",
  },
  {
    key: "visit_reminder_24hr",
    label: "Visit Reminder",
    description: "Remind about upcoming visit",
    buildParams: (lead: any, courseName?: string, campusName?: string) => [lead.name, "tomorrow", campusName || "NIMT Educational Institutions"],
    preview: "Hi {{1}}, this is a reminder that your campus visit is scheduled for {{2}} at {{3}}. See you soon!",
  },
  {
    key: "application_received",
    label: "Application Received",
    description: "Acknowledge application submission",
    buildParams: (lead: any) => [lead.name, lead.application_id || "N/A"],
    preview: "Hi {{1}}, we've received your application (ID: {{2}}). Our admissions team will review it shortly.",
  },
  {
    key: "fee_reminder",
    label: "Fee Reminder",
    description: "Remind about pending fee payment",
    buildParams: (lead: any) => [lead.name, "the pending amount", "the due date"],
    preview: "Hi {{1}}, this is a reminder that your fee of ₹{{2}} is due by {{3}}. Please complete the payment to secure your seat.",
  },
  {
    key: "course_details",
    label: "Course Details",
    description: "Send course information",
    buildParams: (lead: any, courseName?: string) => [lead.name, courseName || "your selected course"],
    preview: "Hi {{1}}, here are the details for {{2}} at NIMT Educational Institutions. Feel free to reach out with any questions!",
  },
  {
    key: "course_info_video",
    label: "Course Info + Video",
    description: "Course details with video brochure",
    buildParams: (lead: any, courseName?: string, campusName?: string, courseDuration?: number, courseType?: string) => [
      lead.name,
      courseName || "your selected course",
      courseDuration ? `${courseDuration} year(s)` : "N/A",
      "As per university norms",
      campusName || "NIMT Educational Institutions",
    ],
    preview: "Hi {{1}}, here's everything about {{2}}:\nDuration: {{3}}\nEligibility: {{4}}\nCampus: {{5}}",
  },
  {
    key: "student_welcome",
    label: "Student Welcome",
    description: "Welcome on admission (PAN/AN)",
    buildParams: (lead: any, courseName?: string, campusName?: string) => [lead.name, lead.admission_no || lead.pre_admission_no || "N/A", courseName || "your course", campusName || "NIMT Educational Institutions"],
    preview: "Congratulations {{1}}!\n\nWelcome to NIMT Educational Institutions.\n\nAdmission No: {{2}}\nCourse: {{3}}\nCampus: {{4}}\n\nYou can access the student portal at https://uni.nimt.ac.in\n\nWe wish you a great academic journey ahead!",
  },
  {
    key: "applicant_welcome",
    label: "Applicant Welcome",
    description: "Welcome on application start",
    buildParams: (lead: any, courseName?: string) => [lead.name, lead.application_id || "N/A", courseName || "your selected course"],
    preview: "Hi {{1}}, thank you for starting your application at NIMT Educational Institutions!\n\nYour Application ID: {{2}}\nCourse: {{3}}\n\nComplete your application at https://uni.nimt.ac.in/apply/nimt/\n\nOur admissions team is here to help. Feel free to reach out anytime!",
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

    const params = selectedTmpl.buildParams(lead, courseName, campusName, courseDuration, courseType);

    try {
      // Direct fetch to edge function so we can read the raw response body
      // (supabase.functions.invoke hides the actual error from Meta)
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

      const response = await fetch(`${supabaseUrl}/functions/v1/whatsapp-send`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken || anonKey}`,
          apikey: anonKey,
        },
        body: JSON.stringify({
          template_key: selectedTemplate,
          phone: lead.phone,
          params,
          lead_id: lead.id,
        }),
      });

      const responseBody = await response.json().catch(() => ({ error: "Invalid response" }));
      setSending(false);

      if (!response.ok) {
        const detail = responseBody?.error || responseBody?.meta_error || `HTTP ${response.status}`;
        console.error("whatsapp-send failed:", { status: response.status, body: responseBody });
        toast({ title: "Failed to send", description: detail, variant: "destructive" });
        return;
      }

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
                  <p className={`text-sm font-medium ${selectedTemplate === t.key ? "text-green-700 dark:text-green-400" : ""}`}>{t.label}</p>
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
