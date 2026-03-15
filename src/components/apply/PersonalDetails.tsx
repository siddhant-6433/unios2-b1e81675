import { useState, useEffect } from "react";
import { ArrowRight, Loader2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PhoneInput } from "@/components/ui/phone-input";
import { ApplicationData } from "./types";
import { validateDobEligibility, fetchEligibilityRules, EligibilityRule } from "./eligibilityRules";
import { getNationalityOptions, isIndianNationality } from "./countries";

interface Props {
  data: ApplicationData;
  onChange: (data: Partial<ApplicationData>) => void;
  onNext: () => void;
  saving: boolean;
}

const inputCls = "w-full rounded-xl border border-input bg-card py-2.5 px-4 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20";

const NATIONALITIES = getNationalityOptions();

function DobInput({ value, onChange, className }: { value: string; onChange: (v: string) => void; className?: string }) {
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
      className={className || inputCls}
    />
  );
}

export function PersonalDetails({ data, onChange, onNext, saving }: Props) {
  const address = data.address || {};
  const isSchool = data.program_category === 'school';
  const isIndian = isIndianNationality(data.nationality);

  // Fetch DB-driven eligibility rules for age validation
  const [mergedRule, setMergedRule] = useState<EligibilityRule | undefined>(undefined);

  useEffect(() => {
    const courseIds = (data.course_selections || []).map(s => s.course_id);
    if (courseIds.length) {
      fetchEligibilityRules(courseIds).then(rules => {
        if (Object.keys(rules).length > 0) {
          const merged = Object.values(rules).reduce<EligibilityRule>((acc, r) => ({
            minAge: Math.max(acc.minAge || 0, r.minAge || 0) || undefined,
            maxAge: acc.maxAge && r.maxAge ? Math.min(acc.maxAge, r.maxAge) : (acc.maxAge || r.maxAge),
          }), {});
          setMergedRule(merged);
        }
      });
    }
  }, [data.course_selections]);

  const dobWarning = data.program_category !== 'school'
    ? validateDobEligibility(data.program_category, data.dob, 2026, mergedRule)
    : null;

  return (
    <div className="space-y-5">
      <h2 className="text-lg font-semibold text-foreground">
        {isSchool ? 'Child Details' : 'Personal Details'}
      </h2>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Full Name *</label>
          <input value={data.full_name} onChange={e => onChange({ full_name: e.target.value })} className={inputCls} />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Gender</label>
          <select value={data.gender} onChange={e => onChange({ gender: e.target.value })} className={inputCls}>
            <option value="">Select</option>
            <option value="Male">Male</option>
            <option value="Female">Female</option>
            <option value="Other">Other</option>
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
            Date of Birth {isSchool ? '*' : ''}
          </label>
          <DobInput value={data.dob} onChange={v => onChange({ dob: v })} className={inputCls} />
          {dobWarning && (
            <div className="mt-1.5 flex items-start gap-1.5 text-destructive">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span className="text-xs">{dobWarning.message}</span>
            </div>
          )}
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Nationality</label>
          <select
            value={data.nationality || 'Indian'}
            onChange={e => {
              const nat = e.target.value;
              onChange({
                nationality: nat,
                // Clear the other field when switching
                aadhaar: nat === 'Indian' ? data.aadhaar : '',
                passport_number: nat !== 'Indian' ? data.passport_number : '',
              });
            }}
            className={inputCls}
          >
            {NATIONALITIES.map(n => (
              <option key={n.value} value={n.value}>{n.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Category</label>
          <select value={data.category} onChange={e => onChange({ category: e.target.value })} className={inputCls}>
            <option value="">Select</option>
            {["General", "OBC", "SC", "ST", "EWS"].map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        {/* Conditional: Aadhaar for Indian, Passport for others */}
        {isIndian ? (
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
              🇮🇳 Aadhaar No (optional)
            </label>
            <input
              value={data.aadhaar}
              onChange={e => onChange({ aadhaar: e.target.value.replace(/\D/g, '').slice(0, 12) })}
              placeholder="12-digit number"
              className={inputCls}
            />
          </div>
        ) : (
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
              🛂 Passport No (optional)
            </label>
            <input
              value={data.passport_number}
              onChange={e => onChange({ passport_number: e.target.value.toUpperCase().slice(0, 15) })}
              placeholder="Passport number"
              className={inputCls}
            />
          </div>
        )}
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Phone *</label>
          <PhoneInput value={data.phone} onChange={() => {}} disabled />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Email</label>
          <input type="email" value={data.email} onChange={e => onChange({ email: e.target.value })} className={inputCls} />
        </div>
      </div>

      {/* APAAR / PEN */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">APAAR ID (optional)</label>
          <input value={data.apaar_id} onChange={e => onChange({ apaar_id: e.target.value.replace(/\D/g, '').slice(0, 12) })} placeholder="12-digit Academic Bank ID" className={inputCls} />
        </div>
        {isSchool && (
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">PEN Number (optional)</label>
            <input value={data.pen_number} onChange={e => onChange({ pen_number: e.target.value })} className={inputCls} />
          </div>
        )}
      </div>

      {/* Address */}
      <h3 className="text-sm font-semibold text-foreground mt-2">Address</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="sm:col-span-2">
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Address Line</label>
          <input value={address.line1 || ''} onChange={e => onChange({ address: { ...address, line1: e.target.value } })} className={inputCls} />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">City</label>
          <input value={address.city || ''} onChange={e => onChange({ address: { ...address, city: e.target.value } })} className={inputCls} />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">State</label>
          <input value={address.state || ''} onChange={e => onChange({ address: { ...address, state: e.target.value } })} className={inputCls} />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Country</label>
          <input value={address.country || 'India'} onChange={e => onChange({ address: { ...address, country: e.target.value } })} className={inputCls} />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">PIN Code</label>
          <input value={address.pin_code || ''} onChange={e => onChange({ address: { ...address, pin_code: e.target.value.replace(/\D/g, '').slice(0, 6) } })} className={inputCls} />
        </div>
      </div>

      <div className="flex justify-end">
        <Button onClick={onNext} disabled={saving || !data.full_name.trim() || !!dobWarning} className="gap-2">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
          Save & Continue
        </Button>
      </div>
    </div>
  );
}
