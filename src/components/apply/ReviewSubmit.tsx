import { useState } from "react";
import { ArrowLeft, Loader2, Send, CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ApplicationData } from "./types";

interface Props {
  data: ApplicationData;
  onBack: () => void;
  onSubmit: () => Promise<void>;
  saving: boolean;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <div className="bg-muted/50 rounded-xl p-4 text-sm space-y-1">{children}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-foreground font-medium">{value}</span>
    </div>
  );
}

export function ReviewSubmit({ data, onBack, onSubmit, saving }: Props) {
  const [agreed, setAgreed] = useState(false);
  const addr = data.address || {};
  const academic = data.academic_details || {};

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold text-foreground">Review & Submit</h2>

      <Section title="Courses Selected">
        {data.course_selections.map((cs, i) => (
          <div key={i} className="flex justify-between">
            <span className="text-muted-foreground">Preference {cs.preference_order}</span>
            <span className="text-foreground font-medium">{cs.course_name} — {cs.campus_name}</span>
          </div>
        ))}
      </Section>

      <Section title="Personal Details">
        <Row label="Name" value={data.full_name} />
        <Row label="Gender" value={data.gender} />
        <Row label="Date of Birth" value={data.dob} />
        <Row label="Phone" value={data.phone} />
        <Row label="Email" value={data.email} />
        <Row label="Nationality" value={data.nationality} />
        <Row label="Category" value={data.category} />
        <Row label="Address" value={[addr.line1, addr.city, addr.state, addr.pin_code].filter(Boolean).join(', ')} />
      </Section>

      <Section title="Parent Details">
        <Row label="Father" value={data.father?.name} />
        <Row label="Mother" value={data.mother?.name} />
        {data.guardian?.name && <Row label="Guardian" value={data.guardian.name} />}
      </Section>

      <Section title="Academic Details">
        {(academic as any).class_10?.board && <Row label="Class 10 Board" value={(academic as any).class_10.board} />}
        {(academic as any).class_12?.board && <Row label="Class 12 Board" value={(academic as any).class_12.board} />}
        {(academic as any).graduation?.degree && <Row label="Graduation" value={(academic as any).graduation.degree} />}
      </Section>

      <Section title="Payment">
        <Row label="Fee Amount" value={`₹${data.fee_amount.toLocaleString('en-IN')}`} />
        <Row label="Status" value={data.payment_status === 'paid' ? '✅ Paid' : data.fee_amount === 0 ? '✅ Waived' : '⏳ Pending'} />
      </Section>

      {data.flags.length > 0 && (
        <Section title="Application Flags">
          <div className="flex flex-wrap gap-2">
            {data.flags.map(f => (
              <span key={f} className="text-xs px-2 py-1 rounded-full bg-warning/10 text-warning font-medium">
                {f.replace(/_/g, ' ')}
              </span>
            ))}
          </div>
        </Section>
      )}

      <div className="flex items-start gap-3 p-4 rounded-xl border border-border bg-card">
        <Checkbox id="declaration" checked={agreed} onCheckedChange={v => setAgreed(v === true)} />
        <label htmlFor="declaration" className="text-xs text-muted-foreground leading-relaxed cursor-pointer">
          I hereby declare that all information provided in this application is true and correct to the best of my knowledge. 
          I understand that any false information may lead to cancellation of my admission.
        </label>
      </div>

      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack} className="gap-2">
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
        <Button onClick={onSubmit} disabled={!agreed || saving} className="gap-2">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          Submit Application
        </Button>
      </div>
    </div>
  );
}
