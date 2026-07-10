import { ArrowRight, ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TextAreaField, TextField } from "@/components/ui/state-fields";
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
const textareaCls = `${inputCls} resize-none`;

export function ExtracurricularDetails({ data, onChange, onNext, onBack, saving, readOnly }: Props) {
  const ext = data.extracurricular || {};
  const update = (field: string, val: string) => {
    onChange({ extracurricular: { ...ext, [field]: val } });
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Extracurricular Activities</h2>
        <p className="text-sm text-muted-foreground">Optional — share your achievements and interests.</p>
      </div>

      <fieldset disabled={readOnly} className={readOnly ? "pointer-events-none opacity-75" : ""}>
      <div className="space-y-4">
        <TextAreaField
          label="Achievements & Awards"
          rows={2}
          value={ext.achievements || ''}
          onValueChange={(value) => update('achievements', value)}
          placeholder="Any notable achievements..."
          textareaClassName={textareaCls}
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-5">
          <TextField label="Competitions" value={ext.competitions || ''} onValueChange={(value) => update('competitions', value)} inputClassName={inputCls} />
          <TextField label="Leadership Roles" value={ext.leadership || ''} onValueChange={(value) => update('leadership', value)} inputClassName={inputCls} />
          <TextField label="Sports" value={ext.sports || ''} onValueChange={(value) => update('sports', value)} inputClassName={inputCls} />
          <TextField label="Volunteer Work" value={ext.volunteer || ''} onValueChange={(value) => update('volunteer', value)} inputClassName={inputCls} />
          <TextField label="Portfolio URL" type="url" value={ext.portfolio || ''} onValueChange={(value) => update('portfolio', value)} placeholder="https://..." inputClassName={inputCls} />
          <TextField label="LinkedIn" type="url" value={ext.linkedin || ''} onValueChange={(value) => update('linkedin', value)} placeholder="https://linkedin.com/in/..." inputClassName={inputCls} />
        </div>
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
