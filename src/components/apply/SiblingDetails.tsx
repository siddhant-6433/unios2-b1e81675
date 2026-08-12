import { Plus, X, ArrowRight, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ButtonOrb } from "@/components/ui/thinking-orb";
import { Checkbox } from "@/components/ui/checkbox";
import { TextField } from "@/components/ui/state-fields";
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
  const schoolDetails = (data.school_details || {}) as Record<string, unknown>;
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
            <TextField label="Name" value={sib.name} onValueChange={(value) => updateSibling(i, "name", value)} inputClassName={inputCls} />
            <TextField label="Age" value={sib.age} onValueChange={(value) => updateSibling(i, "age", value)} inputClassName={inputCls} />
            <TextField label="Current Grade/Class" value={sib.grade} onValueChange={(value) => updateSibling(i, "grade", value)} inputClassName={inputCls} />
            <TextField label="School Name" value={sib.school} onValueChange={(value) => updateSibling(i, "school", value)} inputClassName={inputCls} />
          </div>
          <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
            <Checkbox
              checked={sib.studying_here}
              onCheckedChange={(checked) => updateSibling(i, "studying_here", checked === true)}
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
          {saving ? <ButtonOrb state="working" onFilled /> : <ArrowRight className="h-4 w-4" />}
          Save & Continue
        </Button>
      </div>
    </div>
  );
}
