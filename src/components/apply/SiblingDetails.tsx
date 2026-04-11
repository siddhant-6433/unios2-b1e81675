import { Plus, X, ArrowRight, ArrowLeft, Loader2 } from "lucide-react";
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

interface Sibling {
  name: string;
  age: string;
  grade: string;
  school: string;
  studying_here: boolean;
}

const inputCls = "w-full rounded-xl border border-input bg-card py-2.5 px-4 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20";

export function SiblingDetails({ data, onChange, onNext, onBack, saving, readOnly }: Props) {
  const schoolDetails = (data.school_details || {}) as Record<string, any>;
  const siblings: Sibling[] = schoolDetails.siblings || [];

  const updateSiblings = (updated: Sibling[]) => {
    onChange({ school_details: { ...schoolDetails, siblings: updated } });
  };

  const addSibling = () => {
    updateSiblings([...siblings, { name: "", age: "", grade: "", school: "", studying_here: false }]);
  };

  const removeSibling = (index: number) => {
    updateSiblings(siblings.filter((_, i) => i !== index));
  };

  const updateSibling = (index: number, field: keyof Sibling, value: string | boolean) => {
    const updated = siblings.map((s, i) => i === index ? { ...s, [field]: value } : s);
    updateSiblings(updated);
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Sibling Details</h2>
        <p className="text-sm text-muted-foreground">
          Add details of siblings if applicable. Siblings studying at our school may qualify for a fee concession.
        </p>
      </div>

      <fieldset disabled={readOnly} className={readOnly ? "pointer-events-none opacity-75" : ""}>
      {siblings.map((sib, i) => (
        <div key={i} className="p-4 rounded-xl border border-border/60 bg-muted/30 space-y-3 relative">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold text-foreground">Sibling {i + 1}</h4>
            <button onClick={() => removeSibling(i)} className="text-muted-foreground hover:text-destructive">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Name</label>
              <input value={sib.name} onChange={e => updateSibling(i, "name", e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Age</label>
              <input value={sib.age} onChange={e => updateSibling(i, "age", e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Current Grade/Class</label>
              <input value={sib.grade} onChange={e => updateSibling(i, "grade", e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">School Name</label>
              <input value={sib.school} onChange={e => updateSibling(i, "school", e.target.value)} className={inputCls} />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={sib.studying_here}
              onChange={e => updateSibling(i, "studying_here", e.target.checked)}
              className="rounded border-border"
            />
            Studying at our school
          </label>
        </div>
      ))}

      <Button variant="outline" size="sm" onClick={addSibling} className="gap-1.5 text-xs">
        <Plus className="h-3.5 w-3.5" /> Add Sibling
      </Button>
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
