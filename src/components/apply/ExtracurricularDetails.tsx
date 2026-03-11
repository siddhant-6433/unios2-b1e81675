import { ArrowRight, ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ApplicationData } from "./types";

interface Props {
  data: ApplicationData;
  onChange: (data: Partial<ApplicationData>) => void;
  onNext: () => void;
  onBack: () => void;
  saving: boolean;
}

const inputCls = "w-full rounded-xl border border-input bg-card py-2.5 px-4 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20";
const textareaCls = `${inputCls} resize-none`;

export function ExtracurricularDetails({ data, onChange, onNext, onBack, saving }: Props) {
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

      <div className="space-y-4">
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Achievements & Awards</label>
          <textarea rows={2} value={ext.achievements || ''} onChange={e => update('achievements', e.target.value)} placeholder="Any notable achievements..." className={textareaCls} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Competitions</label>
            <input value={ext.competitions || ''} onChange={e => update('competitions', e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Leadership Roles</label>
            <input value={ext.leadership || ''} onChange={e => update('leadership', e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Sports</label>
            <input value={ext.sports || ''} onChange={e => update('sports', e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Volunteer Work</label>
            <input value={ext.volunteer || ''} onChange={e => update('volunteer', e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Portfolio URL</label>
            <input type="url" value={ext.portfolio || ''} onChange={e => update('portfolio', e.target.value)} placeholder="https://..." className={inputCls} />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">LinkedIn</label>
            <input type="url" value={ext.linkedin || ''} onChange={e => update('linkedin', e.target.value)} placeholder="https://linkedin.com/in/..." className={inputCls} />
          </div>
        </div>
      </div>

      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack} className="gap-2">
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
        <Button onClick={onNext} disabled={saving} className="gap-2">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
          Save & Continue
        </Button>
      </div>
    </div>
  );
}
