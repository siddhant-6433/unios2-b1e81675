import { ArrowRight, ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PhoneInput } from "@/components/ui/phone-input";
import { ApplicationData } from "./types";
import { usePortal } from "./PortalContext";
import { getNationalityOptions, isIndianNationality } from "./countries";

interface Props {
  data: ApplicationData;
  onChange: (data: Partial<ApplicationData>) => void;
  onNext: () => void;
  onBack: () => void;
  saving: boolean;
  readOnly?: boolean;
}

const inputCls = "w-full rounded-xl border border-input bg-card py-2.5 px-4 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20";

const NATIONALITIES = getNationalityOptions();

const EDUCATION_OPTIONS = [
  "Below 10th", "10th Pass", "12th Pass", "Diploma", "Graduate",
  "Post Graduate", "Doctorate / PhD", "Professional Degree",
];

const INCOME_OPTIONS = [
  "Below ₹3 Lakh", "₹3–5 Lakh", "₹5–10 Lakh", "₹10–15 Lakh",
  "₹15–25 Lakh", "₹25–50 Lakh", "Above ₹50 Lakh",
];

const MARITAL_OPTIONS = ["Married", "Single", "Divorced", "Widowed", "Separated"];

const POSITION_OPTIONS = [
  "Employed", "Self-Employed", "Business Owner", "Professional",
  "Government Employee", "Homemaker", "Retired", "Other",
];

/* ── DOB text input helper ── */
function DobTextInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      type="text"
      placeholder="dd/mm/yy"
      value={value ? (() => {
        const d = new Date(value);
        if (isNaN(d.getTime())) return value;
        const dd = String(d.getDate()).padStart(2, '0');
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const yy = String(d.getFullYear()).slice(-2);
        return `${dd}/${mm}/${yy}`;
      })() : ''}
      onChange={e => {
        let val = e.target.value.replace(/[^\d/]/g, '');
        const digits = val.replace(/\//g, '');
        if (digits.length <= 2) val = digits;
        else if (digits.length <= 4) val = digits.slice(0, 2) + '/' + digits.slice(2);
        else val = digits.slice(0, 2) + '/' + digits.slice(2, 4) + '/' + digits.slice(4, 6);
        const parts = val.split('/');
        if (parts.length === 3 && parts[0].length === 2 && parts[1].length === 2 && parts[2].length === 2) {
          const year = parseInt(parts[2], 10);
          const fullYear = year <= 50 ? 2000 + year : 1900 + year;
          onChange(`${fullYear}-${parts[1]}-${parts[0]}`);
        } else {
          onChange(val);
        }
      }}
      maxLength={8}
      className={inputCls}
    />
  );
}

/* ── School Parent Block (comprehensive) ── */
function SchoolParentBlock({
  title,
  value,
  onChange,
}: {
  title: string;
  value: Record<string, string>;
  onChange: (v: Record<string, string>) => void;
}) {
  const isIndian = isIndianNationality(value.nationality);
  const set = (field: string, val: string) => onChange({ ...value, [field]: val });

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Row 1: First Name, Last Name, DOB */}
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">First Name *</label>
          <input value={value.first_name || ''} onChange={e => set('first_name', e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Last Name *</label>
          <input value={value.last_name || ''} onChange={e => set('last_name', e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Date of Birth</label>
          <DobTextInput value={value.dob || ''} onChange={v => set('dob', v)} />
        </div>

        {/* Row 2: Nationality, ID Type + Number */}
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Nationality *</label>
          <select
            value={value.nationality || 'Indian'}
            onChange={e => {
              const nat = e.target.value;
              onChange({
                ...value,
                nationality: nat,
                id_type: nat === 'Indian' ? 'aadhaar' : 'passport',
                id_number: '', // reset on nationality change
              });
            }}
            className={inputCls}
          >
            {NATIONALITIES.map(n => (
              <option key={n.value} value={n.value}>{n.label}</option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
            {isIndian ? '🇮🇳 Aadhaar No' : '🛂 Passport No'}
          </label>
          <input
            value={value.id_number || ''}
            onChange={e => {
              const val = isIndian
                ? e.target.value.replace(/\D/g, '').slice(0, 12)
                : e.target.value.toUpperCase().slice(0, 15);
              set('id_number', val);
            }}
            placeholder={isIndian ? '12-digit Aadhaar number' : 'Passport number'}
            className={inputCls}
          />
        </div>

        {/* Row 3: Education, Annual Income, Employer Name */}
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Education *</label>
          <select value={value.education || ''} onChange={e => set('education', e.target.value)} className={inputCls}>
            <option value="">Select Education</option>
            {EDUCATION_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Annual Income</label>
          <select value={value.annual_income || ''} onChange={e => set('annual_income', e.target.value)} className={inputCls}>
            <option value="">Select Annual Income</option>
            {INCOME_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Employer Name *</label>
          <input value={value.employer_name || ''} onChange={e => set('employer_name', e.target.value)} placeholder="Employer Name" className={inputCls} />
        </div>

        {/* Row 4: Current Position, Marital Status, Email */}
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Current Position *</label>
          <select value={value.current_position || ''} onChange={e => set('current_position', e.target.value)} className={inputCls}>
            <option value="">Select Current Position</option>
            {POSITION_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Marital Status *</label>
          <select value={value.marital_status || ''} onChange={e => set('marital_status', e.target.value)} className={inputCls}>
            <option value="">Select Marital Status</option>
            {MARITAL_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Email Address *</label>
          <input type="email" value={value.email || ''} onChange={e => set('email', e.target.value)} placeholder="Email Address" className={inputCls} />
        </div>

        {/* Row 5: Phone (Mobile), Phone (Home) */}
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Phone Number (Mobile) *</label>
          <PhoneInput value={value.phone_mobile || value.phone || ''} onChange={v => set('phone_mobile', v)} />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Phone Number (Home)</label>
          <PhoneInput value={value.phone_home || ''} onChange={v => set('phone_home', v)} />
        </div>
      </div>
    </div>
  );
}

/* ── Simple Parent Block (non-school) ── */
function SimpleParentBlock({
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
          <PhoneInput
            value={value.phone || ''}
            onChange={(phone) => onChange({ ...value, phone })}
          />
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

export function ParentDetails({ data, onChange, onNext, onBack, saving, readOnly }: Props) {
  const portal = usePortal();
  const isSchool = portal.programCategories.includes("school");

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold text-foreground">Parent / Guardian Details</h2>

      <fieldset disabled={readOnly} className={readOnly ? "pointer-events-none opacity-75" : ""}>
        {isSchool ? (
          <>
            <SchoolParentBlock title="Parent Details - Father" value={data.father as any} onChange={v => onChange({ father: v })} />
            <hr className="border-border" />
            <SchoolParentBlock title="Parent Details - Mother" value={data.mother as any} onChange={v => onChange({ mother: v })} />
            <hr className="border-border" />
            <SimpleParentBlock title="Guardian (optional)" value={data.guardian as any} onChange={v => onChange({ guardian: v })} showRelationship />
          </>
        ) : (
          <>
            <SimpleParentBlock title="Father" value={data.father as any} onChange={v => onChange({ father: v })} />
            <SimpleParentBlock title="Mother" value={data.mother as any} onChange={v => onChange({ mother: v })} />
            <SimpleParentBlock title="Guardian (optional)" value={data.guardian as any} onChange={v => onChange({ guardian: v })} showRelationship />
          </>
        )}
      </fieldset>

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
