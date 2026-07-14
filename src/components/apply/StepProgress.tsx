import { CheckCircle, User, Users, BookOpen, Trophy, CreditCard, Upload, FileSearch } from "lucide-react";

const STEPS = [
  { key: "personal", label: "Personal", icon: User },
  { key: "parents", label: "Parents", icon: Users },
  { key: "academic", label: "Academic", icon: BookOpen },
  { key: "extracurricular", label: "Extra", icon: Trophy },
  { key: "payment", label: "Payment", icon: CreditCard },
  { key: "documents", label: "Documents", icon: Upload },
  { key: "review", label: "Review", icon: FileSearch },
] as const;

interface StepProgressProps {
  currentStep: number;
  completedSections: Record<string, boolean>;
  onStepClick: (step: number) => void;
}

export function StepProgress({ currentStep, completedSections, onStepClick }: StepProgressProps) {
  const completedCount = STEPS.filter((s) => completedSections[s.key]).length;
  const progressPercent = Math.round((completedCount / STEPS.length) * 100);

  return (
    <div className="mb-8 space-y-3">
      {/* Progress bar */}
      <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-secondary">
        <div
          className="h-full rounded-full bg-primary transition-all duration-480 ease-standard"
          style={{ width: `${progressPercent}%` }}
        />
      </div>
      {/* Step pills */}
      <div className="flex items-center gap-1 overflow-x-auto pb-1">
        {STEPS.map((s, i) => {
          const done = completedSections[s.key] === true;
          const active = currentStep === i;
          return (
            <button
              key={s.key}
              onClick={() => onStepClick(i)}
              className={`flex-1 min-w-[44px] flex items-center justify-center gap-1.5 px-2 py-2.5 rounded-xl text-xs font-medium transition-all duration-240 ease-standard ${
                done
                  ? "bg-primary/10 text-primary"
                  : active
                  ? "bg-card border border-border text-foreground elevation-low"
                  : "text-muted-foreground hover:bg-muted"
              }`}
            >
              {done ? (
                <CheckCircle className="h-4 w-4 shrink-0 animate-rs-scale-in" />
              ) : (
                <s.icon className="h-4 w-4 shrink-0" />
              )}
              <span className="hidden md:inline truncate">{s.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export { STEPS };
