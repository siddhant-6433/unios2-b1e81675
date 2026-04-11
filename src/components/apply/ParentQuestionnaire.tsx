import { ArrowRight, ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ApplicationData } from "./types";

interface Props {
  data: ApplicationData;
  onChange: (data: Partial<ApplicationData>) => void;
  onNext: () => void;
  onBack?: () => void;
  saving: boolean;
  readOnly?: boolean;
}

const inputCls = "w-full rounded-xl border border-input bg-card py-2.5 px-4 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20";
const textareaCls = "w-full rounded-xl border border-input bg-card py-2.5 px-4 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 min-h-[80px] resize-y";

const QUESTIONS = [
  { key: "reason_for_choosing", label: "Why have you chosen our school for your child?" },
  { key: "learning_style", label: "How would you describe your child's learning style?" },
  { key: "special_needs", label: "Does your child have any special educational needs or medical conditions we should know about?" },
  { key: "extracurricular_interests", label: "What extracurricular activities or interests does your child enjoy?" },
  { key: "expectations", label: "What are your expectations from the school?" },
  { key: "previous_school_reason", label: "Reason for leaving previous school (if applicable)" },
];

export function ParentQuestionnaire({ data, onChange, onNext, onBack, saving, readOnly }: Props) {
  const schoolDetails = (data.school_details || {}) as Record<string, any>;
  const questionnaire: Record<string, string> = schoolDetails.parent_questionnaire || {};

  const updateAnswer = (key: string, value: string) => {
    onChange({
      school_details: {
        ...schoolDetails,
        parent_questionnaire: { ...questionnaire, [key]: value },
      },
    });
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Parent Questionnaire</h2>
        <p className="text-sm text-muted-foreground">
          Help us understand your child better. All fields are optional but recommended.
        </p>
      </div>

      <fieldset disabled={readOnly} className={readOnly ? "pointer-events-none opacity-75" : ""}>
      <div className="space-y-4">
        {QUESTIONS.map(q => (
          <div key={q.key}>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">{q.label}</label>
            <textarea
              value={questionnaire[q.key] || ""}
              onChange={e => updateAnswer(q.key, e.target.value)}
              className={textareaCls}
              rows={3}
            />
          </div>
        ))}
      </div>

      {/* Transport preference */}
      <div>
        <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Transport Preference</label>
        <select
          value={schoolDetails.transport_preference || ""}
          onChange={e => onChange({ school_details: { ...schoolDetails, transport_preference: e.target.value } })}
          className={inputCls}
        >
          <option value="">Select</option>
          <option value="school_bus">School Bus</option>
          <option value="self_drop">Self Drop & Pick-up</option>
          <option value="carpool">Carpool</option>
          <option value="not_decided">Not Decided Yet</option>
        </select>
      </div>

      {/* Medium of instruction preference */}
      <div>
        <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Preferred Medium of Instruction</label>
        <select
          value={schoolDetails.medium_preference || ""}
          onChange={e => onChange({ school_details: { ...schoolDetails, medium_preference: e.target.value } })}
          className={inputCls}
        >
          <option value="">Select</option>
          <option value="english">English</option>
          <option value="hindi">Hindi</option>
          <option value="bilingual">Bilingual (English + Hindi)</option>
        </select>
      </div>
      </fieldset>

      <div className="flex justify-between">
        {onBack ? (
          <Button variant="outline" onClick={onBack} className="gap-2">
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>
        ) : <div />}
        <Button onClick={onNext} disabled={saving} className="gap-2">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
          Save & Continue
        </Button>
      </div>
    </div>
  );
}
