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

function ParentBlock({
  title,
  value,
  onChange,
  showRelationship,
}: {
  title: string;
  value: Record<string, string>;
  onChange: (v: Record<string, string>) => void;
  showRelationship?: boolean;
}) {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Name</label>
          <input value={value.name || ''} onChange={e => onChange({ ...value, name: e.target.value })} className={inputCls} />
        </div>
        {showRelationship && (
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Relationship</label>
            <input value={value.relationship || ''} onChange={e => onChange({ ...value, relationship: e.target.value })} className={inputCls} />
          </div>
        )}
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Phone</label>
          <input value={value.phone || ''} onChange={e => onChange({ ...value, phone: e.target.value })} className={inputCls} />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Email (optional)</label>
          <input type="email" value={value.email || ''} onChange={e => onChange({ ...value, email: e.target.value })} className={inputCls} />
        </div>
        {!showRelationship && (
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Occupation</label>
            <input value={value.occupation || ''} onChange={e => onChange({ ...value, occupation: e.target.value })} className={inputCls} />
          </div>
        )}
      </div>
    </div>
  );
}

export function ParentDetails({ data, onChange, onNext, onBack, saving }: Props) {
  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold text-foreground">Parent / Guardian Details</h2>

      <ParentBlock title="Father" value={data.father as any} onChange={v => onChange({ father: v })} />
      <ParentBlock title="Mother" value={data.mother as any} onChange={v => onChange({ mother: v })} />
      <ParentBlock title="Guardian (optional)" value={data.guardian as any} onChange={v => onChange({ guardian: v })} showRelationship />

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
