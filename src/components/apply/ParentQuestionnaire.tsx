import { ArrowRight, ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SelectField, TextAreaField } from "@/components/ui/state-fields";
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
const transportOptions = [
  { value: "school_bus", label: "School Bus" },
  { value: "self_drop", label: "Self Drop & Pick-up" },
  { value: "carpool", label: "Carpool" },
  { value: "not_decided", label: "Not Decided Yet" },
];
const mediumOptions = [
  { value: "english", label: "English" },
  { value: "hindi", label: "Hindi" },
  { value: "bilingual", label: "Bilingual (English + Hindi)" },
];
// Fee-driving school mode. Values match src/lib/offerFeeTerms (SchoolFeeSelection)
// so the admissions team's offer prefills from what the parent declares here.
const attendanceModeOptions = [
  { value: "day_scholar", label: "Day Scholar" },
  { value: "day_boarder", label: "Day Boarding" },
  { value: "boarder", label: "Boarder (Hostel)" },
];
const boardingTypeOptions = [
  { value: "non_ac", label: "Non-AC" },
  { value: "ac_central", label: "AC (C Block)" },
  { value: "ac_individual", label: "AC (B Block)" },
];
const transportZoneOptions = [
  { value: "zone_1", label: "Within 5 km" },
  { value: "zone_2", label: "5–10 km" },
  { value: "zone_3", label: "Over 10 km" },
];

const QUESTIONS = [
  { key: "reason_for_choosing", label: "Why have you chosen our school for your child?" },
  { key: "learning_style", label: "How would you describe your child's learning style?" },
  { key: "special_needs", label: "Does your child have any special educational needs or medical conditions we should know about?" },
  { key: "extracurricular_interests", label: "What extracurricular activities or interests does your child enjoy?" },
  { key: "expectations", label: "What are your expectations from the school?" },
  { key: "previous_school_reason", label: "Reason for leaving previous school (if applicable)" },
];

export function ParentQuestionnaire({ data, onChange, onNext, onBack, saving, readOnly }: Props) {
  const schoolDetails = (data.school_details || {}) as Record<string, unknown>;
  const questionnaire: Record<string, string> = (schoolDetails.parent_questionnaire || {}) as Record<string, string>;

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
          <TextAreaField
            key={q.key}
            label={q.label}
            value={questionnaire[q.key] || ""}
            onValueChange={(value) => updateAnswer(q.key, value)}
            textareaClassName={textareaCls}
            rows={3}
          />
        ))}
      </div>

      {/* Transport preference */}
      <SelectField
        label="Transport Preference"
        value={String(schoolDetails.transport_preference || "")}
        onValueChange={(value) => onChange({ school_details: { ...schoolDetails, transport_preference: value } })}
        options={transportOptions}
        placeholder="Select"
        triggerClassName={inputCls}
      />

      {/* Medium of instruction preference */}
      <SelectField
        label="Preferred Medium of Instruction"
        value={String(schoolDetails.medium_preference || "")}
        onValueChange={(value) => onChange({ school_details: { ...schoolDetails, medium_preference: value } })}
        options={mediumOptions}
        placeholder="Select"
        triggerClassName={inputCls}
      />

      {/* Attendance mode — drives boarding/transport fees on the admission offer. */}
      <SelectField
        label="How will your child attend?"
        value={String(schoolDetails.student_type || "")}
        onValueChange={(value) => onChange({ school_details: {
          ...schoolDetails,
          student_type: value,
          // Clear boarding tier if not a boarder.
          ...(value === "boarder" ? {} : { hostel_type: "" }),
        } })}
        options={attendanceModeOptions}
        placeholder="Select"
        triggerClassName={inputCls}
      />

      {/* Boarding tier — only relevant for boarders. */}
      {schoolDetails.student_type === "boarder" && (
        <SelectField
          label="Preferred Boarding Type"
          value={String(schoolDetails.hostel_type || "")}
          onValueChange={(value) => onChange({ school_details: { ...schoolDetails, hostel_type: value } })}
          options={boardingTypeOptions}
          placeholder="Select"
          triggerClassName={inputCls}
        />
      )}

      {/* Transport zone (by distance) — drives transport fee. */}
      <SelectField
        label="School Transport (by distance from home)"
        value={String(schoolDetails.transport_zone || "")}
        onValueChange={(value) => onChange({ school_details: { ...schoolDetails, transport_zone: value } })}
        options={transportZoneOptions}
        placeholder="Not required"
        triggerClassName={inputCls}
      />
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
