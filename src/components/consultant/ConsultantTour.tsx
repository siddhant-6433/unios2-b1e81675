import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { X, ChevronLeft, ChevronRight, Sparkles, Users, IndianRupee, Mic, BookOpen } from "lucide-react";

interface TourStep {
  title: string;
  body: string;
  icon: any;
  highlight?: string; // CSS selector to spotlight
}

const TOUR_STEPS: TourStep[] = [
  {
    title: "Welcome to NIMT Consultant Portal",
    body: "Hi 👋 — let's take a quick 60-second tour to show you around. You'll learn how to add leads, track commissions, and chat with our admission team.",
    icon: Sparkles,
  },
  {
    title: "Add Leads in One Click",
    body: "Click the 'Add Lead' button in the top right to register a new student. Fill in their basic details, choose a course and campus, and they'll appear in your pipeline instantly.",
    icon: Users,
    highlight: "[data-tour='add-lead']",
  },
  {
    title: "Track Your Pipeline",
    body: "The Leads tab shows all your students and their stage in the admission process. Click any lead to see their full details, payments, and next steps.",
    icon: Users,
    highlight: "[data-tour='leads-tab']",
  },
  {
    title: "Earn & Track Commissions",
    body: "Every successful admission earns you a commission. Your earnings, pending payouts, and history are all visible in the Commissions tab.",
    icon: IndianRupee,
    highlight: "[data-tour='commissions-tab']",
  },
  {
    title: "Send Voice Messages",
    body: "Got a question? Use the microphone button to record a quick voice note for our admission team. We'll respond as soon as possible.",
    icon: Mic,
    highlight: "[data-tour='voice-message']",
  },
  {
    title: "Browse Courses & Fees",
    body: "Use the 'Courses & Fees' menu to view detailed fee structures for every program — including school grades, transport zones, and boarding options.",
    icon: BookOpen,
  },
  {
    title: "Open the Full Visual Guide",
    body: "Click below to open the full illustrated guide. Every feature is explained with visuals — and you can download it as PDF for offline reading. You're all set — let's get started!",
    icon: BookOpen,
  },
];

export function ConsultantTour({ onDownloadGuide }: { onDownloadGuide: () => void }) {
  const { user, role } = useAuth();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [completed, setCompleted] = useState(false);

  useEffect(() => {
    if (role !== "consultant" || !user?.id) return;
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("consultant_tour_completed")
        .eq("user_id", user.id)
        .single();
      if (data && !(data as any).consultant_tour_completed) {
        setOpen(true);
      }
    })();
  }, [role, user?.id]);

  const finishTour = async () => {
    setCompleted(true);
    setOpen(false);
    if (user?.id) {
      await supabase
        .from("profiles")
        .update({ consultant_tour_completed: true } as any)
        .eq("user_id", user.id);
    }
  };

  const skip = () => finishTour();

  const next = () => {
    if (step < TOUR_STEPS.length - 1) {
      setStep(step + 1);
    } else {
      finishTour();
    }
  };

  const prev = () => {
    if (step > 0) setStep(step - 1);
  };

  if (!open || completed) return null;

  const current = TOUR_STEPS[step];
  const Icon = current.icon;
  const isLast = step === TOUR_STEPS.length - 1;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm animate-in fade-in duration-200" onClick={skip} />

      {/* Tour card centered */}
      <div className="fixed inset-0 z-[101] flex items-center justify-center pointer-events-none p-4">
        <div className="pointer-events-auto w-full max-w-md rounded-2xl bg-card border border-border shadow-2xl overflow-hidden animate-in zoom-in-95 fade-in duration-300">
          {/* Header with icon */}
          <div className="relative bg-gradient-to-br from-primary/10 via-primary/5 to-transparent px-6 pt-6 pb-4">
            <button
              onClick={skip}
              className="absolute right-4 top-4 rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground mb-3">
              <Icon className="h-6 w-6" />
            </div>
            <h2 className="text-lg font-bold text-foreground">{current.title}</h2>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Step {step + 1} of {TOUR_STEPS.length}
            </p>
          </div>

          {/* Body */}
          <div className="px-6 py-5">
            <p className="text-sm text-foreground/80 leading-relaxed">{current.body}</p>

            {isLast && (
              <Button
                onClick={() => { onDownloadGuide(); finishTour(); }}
                className="mt-4 w-full gap-2"
                variant="outline"
              >
                <BookOpen className="h-4 w-4" /> Open Visual Guide
              </Button>
            )}
          </div>

          {/* Progress bar */}
          <div className="h-1 bg-muted">
            <div
              className="h-full bg-primary transition-all duration-300"
              style={{ width: `${((step + 1) / TOUR_STEPS.length) * 100}%` }}
            />
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-6 py-4">
            <button
              onClick={skip}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Skip tour
            </button>
            <div className="flex items-center gap-2">
              {step > 0 && (
                <Button onClick={prev} variant="outline" size="sm" className="gap-1">
                  <ChevronLeft className="h-3.5 w-3.5" /> Back
                </Button>
              )}
              <Button onClick={next} size="sm" className="gap-1">
                {isLast ? "Finish" : "Next"}
                {!isLast && <ChevronRight className="h-3.5 w-3.5" />}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
