import { useState, useEffect } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Users, MessageSquare, Phone, Calendar, MapPin, Clock, FileText,
  Bot, IndianRupee, ChevronRight, ChevronLeft, Inbox, Search,
  ArrowRight, CheckCircle, Mail, Zap,
} from "lucide-react";

const STEPS = [
  {
    title: "Welcome to NIMT UniOs!",
    subtitle: "Your Admissions CRM — let's get you started in 2 minutes",
    icon: Users,
    color: "bg-primary/10 text-primary",
    content: (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground leading-relaxed">
          UniOs helps you manage your leads from first contact to admission. Here's a quick overview of your key tools.
        </p>
        <div className="grid grid-cols-2 gap-2">
          {[
            { icon: Users, label: "Leads", desc: "Your assigned leads" },
            { icon: MessageSquare, label: "WhatsApp", desc: "Message leads" },
            { icon: Inbox, label: "Lead Buckets", desc: "Pick new leads" },
            { icon: Search, label: "Search", desc: "Find any lead" },
          ].map(({ icon: I, label, desc }) => (
            <div key={label} className="flex items-center gap-2.5 rounded-xl bg-muted/50 p-3">
              <I className="h-4 w-4 text-primary shrink-0" />
              <div>
                <p className="text-xs font-semibold text-foreground">{label}</p>
                <p className="text-[10px] text-muted-foreground">{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    ),
  },
  {
    title: "Your Leads Pipeline",
    subtitle: "Track every lead through the admission journey",
    icon: ArrowRight,
    color: "bg-blue-100 text-blue-600 dark:bg-blue-900/30",
    content: (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground leading-relaxed">
          Each lead flows through stages. Your job is to move them forward:
        </p>
        <div className="space-y-1.5">
          {[
            { stage: "New Lead", desc: "Just assigned — make first contact", color: "bg-blue-500" },
            { stage: "Counsellor Call", desc: "Called — discuss course & campus", color: "bg-orange-500" },
            { stage: "Visit Scheduled", desc: "Campus visit booked", color: "bg-yellow-500" },
            { stage: "Interview", desc: "Conduct interview & score", color: "bg-indigo-500" },
            { stage: "Offer Sent", desc: "Send admission offer letter", color: "bg-teal-500" },
            { stage: "Token Paid", desc: "Payment received — almost there!", color: "bg-emerald-500" },
            { stage: "Admitted", desc: "Converted to student", color: "bg-green-600" },
          ].map(({ stage, desc, color }) => (
            <div key={stage} className="flex items-center gap-3">
              <div className={`h-2.5 w-2.5 rounded-full ${color} shrink-0`} />
              <div className="flex-1">
                <span className="text-xs font-semibold text-foreground">{stage}</span>
                <span className="text-[10px] text-muted-foreground ml-2">{desc}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    ),
  },
  {
    title: "Quick Actions",
    subtitle: "One-click actions on any lead page",
    icon: Zap,
    color: "bg-amber-100 text-amber-600 dark:bg-amber-900/30",
    content: (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground leading-relaxed">
          Open any lead and use the icon bar at the top for instant actions:
        </p>
        <div className="grid grid-cols-3 gap-2">
          {[
            { icon: Phone, label: "Call", color: "text-blue-600 bg-blue-100" },
            { icon: MessageSquare, label: "WhatsApp", color: "text-green-600 bg-green-100" },
            { icon: Clock, label: "Follow Up", color: "text-orange-600 bg-orange-100" },
            { icon: MapPin, label: "Visit", color: "text-violet-600 bg-violet-100" },
            { icon: Mail, label: "Email", color: "text-sky-600 bg-sky-100" },
            { icon: Bot, label: "AI Call", color: "text-amber-600 bg-amber-100" },
            { icon: FileText, label: "Offer", color: "text-teal-600 bg-teal-100" },
            { icon: IndianRupee, label: "Payment", color: "text-emerald-600 bg-emerald-100" },
            { icon: CheckCircle, label: "Convert", color: "text-primary bg-primary/10" },
          ].map(({ icon: I, label, color }) => (
            <div key={label} className="flex flex-col items-center gap-1 py-2">
              <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${color}`}>
                <I className="h-3.5 w-3.5" />
              </div>
              <span className="text-[10px] font-medium text-muted-foreground">{label}</span>
            </div>
          ))}
        </div>
      </div>
    ),
  },
  {
    title: "Lead Buckets",
    subtitle: "Self-assign leads from the unassigned pool",
    icon: Inbox,
    color: "bg-violet-100 text-violet-600 dark:bg-violet-900/30",
    content: (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground leading-relaxed">
          New leads come in from the website, JustDial, CollegeDunia, and more. They land in <strong>Lead Buckets</strong> — an unassigned pool.
        </p>
        <div className="rounded-xl bg-muted/50 p-4 space-y-2">
          <p className="text-xs font-semibold text-foreground">How to pick leads:</p>
          <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
            <li>Go to <strong>Admissions → Lead Buckets</strong></li>
            <li>Browse unassigned leads by course/campus</li>
            <li>Click <strong>"Assign to Me"</strong> to claim a lead</li>
            <li>The lead appears in your Leads list immediately</li>
          </ol>
        </div>
        <p className="text-[11px] text-amber-600 dark:text-amber-400 font-medium">
          Tip: Leads have an SLA timer — make first contact quickly or the lead returns to the bucket!
        </p>
      </div>
    ),
  },
  {
    title: "WhatsApp & Communication",
    subtitle: "Stay connected with leads via WhatsApp, calls, and email",
    icon: MessageSquare,
    color: "bg-green-100 text-green-600 dark:bg-green-900/30",
    content: (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground leading-relaxed">
          Use the <strong>WhatsApp Inbox</strong> to see all conversations. Send pre-approved templates or free-text replies.
        </p>
        <div className="space-y-2">
          <div className="rounded-xl bg-green-50 dark:bg-green-950/20 p-3">
            <p className="text-[10px] font-semibold text-green-800 dark:text-green-400 uppercase mb-1">Available Templates</p>
            <div className="grid grid-cols-2 gap-1">
              {["Lead Welcome", "Visit Confirmation", "Visit Reminder", "Fee Reminder", "Course Details", "Application Received"].map(t => (
                <p key={t} className="text-[10px] text-green-700 dark:text-green-300">• {t}</p>
              ))}
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Free-text replies only work within <strong>24 hours</strong> of the lead's last message. Use templates to re-engage after that.
          </p>
        </div>
      </div>
    ),
  },
  {
    title: "You're All Set!",
    subtitle: "Start converting leads into students",
    icon: CheckCircle,
    color: "bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30",
    content: (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground leading-relaxed">
          That's all you need to get started! Here's your daily workflow:
        </p>
        <div className="space-y-2">
          {[
            "Check Lead Buckets for new leads to pick up",
            "Call or WhatsApp your assigned leads",
            "Schedule follow-ups so nothing falls through the cracks",
            "Book campus visits and send confirmations",
            "Move leads through the pipeline to admission",
          ].map((step, i) => (
            <div key={i} className="flex items-start gap-2.5">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground shrink-0">{i + 1}</span>
              <p className="text-xs text-foreground leading-relaxed">{step}</p>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground mt-2">
          Need help? Contact your Admission Head or the admin team.
        </p>
      </div>
    ),
  },
];

const ONBOARDING_KEY = "unios_counsellor_onboarding_seen";

export function CounsellorOnboarding() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    const seen = localStorage.getItem(ONBOARDING_KEY);
    if (!seen) {
      // Small delay so the dashboard loads first
      const timer = setTimeout(() => setOpen(true), 800);
      return () => clearTimeout(timer);
    }
  }, []);

  const handleClose = () => {
    localStorage.setItem(ONBOARDING_KEY, "true");
    setOpen(false);
    setStep(0);
  };

  const current = STEPS[step];
  const Icon = current.icon;
  const isLast = step === STEPS.length - 1;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent className="max-w-md p-0 overflow-hidden gap-0">
        {/* Header with icon */}
        <div className="px-6 pt-6 pb-4">
          <div className="flex items-center gap-3 mb-3">
            <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${current.color}`}>
              <Icon className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-foreground">{current.title}</h2>
              <p className="text-[11px] text-muted-foreground">{current.subtitle}</p>
            </div>
          </div>

          {/* Content */}
          <div className="mt-2">
            {current.content}
          </div>
        </div>

        {/* Footer with pagination + buttons */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-border bg-muted/20">
          {/* Step dots */}
          <div className="flex items-center gap-1.5">
            {STEPS.map((_, i) => (
              <button
                key={i}
                onClick={() => setStep(i)}
                className={`h-1.5 rounded-full transition-all ${
                  i === step ? "w-6 bg-primary" : "w-1.5 bg-muted-foreground/30 hover:bg-muted-foreground/50"
                }`}
              />
            ))}
          </div>

          {/* Navigation */}
          <div className="flex items-center gap-2">
            {step > 0 && (
              <Button variant="ghost" size="sm" onClick={() => setStep(s => s - 1)} className="gap-1 text-xs h-8">
                <ChevronLeft className="h-3.5 w-3.5" /> Back
              </Button>
            )}
            {step === 0 && (
              <Button variant="ghost" size="sm" onClick={handleClose} className="text-xs h-8 text-muted-foreground">
                Skip
              </Button>
            )}
            <Button
              size="sm"
              onClick={isLast ? handleClose : () => setStep(s => s + 1)}
              className="gap-1 text-xs h-8"
            >
              {isLast ? "Get Started" : "Next"}
              {!isLast && <ChevronRight className="h-3.5 w-3.5" />}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Button to re-open the onboarding guide (for help menu / settings) */
export function ResetOnboardingButton() {
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => {
        localStorage.removeItem(ONBOARDING_KEY);
        window.location.reload();
      }}
      className="gap-1.5 text-xs"
    >
      <Zap className="h-3.5 w-3.5" /> Show Onboarding Guide
    </Button>
  );
}
