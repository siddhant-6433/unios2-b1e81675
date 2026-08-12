import { useState, useEffect } from "react";
import { ArrowRight, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ButtonOrb } from "@/components/ui/thinking-orb";
import { PhoneInput } from "@/components/ui/phone-input";
import { DatePickerField, SelectField, TextField } from "@/components/ui/state-fields";
import { ApplicationData } from "./types";
import { validateDobEligibility, fetchEligibilityRules, EligibilityRule } from "./eligibilityRules";
import { getNationalityOptions, isIndianNationality, COUNTRIES } from "./countries";
import { INDIAN_STATES } from "./indianStates";

interface Props {
  data: ApplicationData;
  onChange: (data: Partial<ApplicationData>) => void;
  onNext: () => void;
  saving: boolean;
  readOnly?: boolean;
}

const inputCls = "w-full rounded-xl border border-input bg-card py-2.5 px-4 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20";

const NATIONALITIES = getNationalityOptions();
const genderOptions = ["Male", "Female", "Other"].map((value) => ({ value, label: value }));
const categoryOptions = ["General", "OBC", "SC", "ST", "EWS"].map((value) => ({ value, label: value }));

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PIN_RE = /^\d{6}$/;

export function PersonalDetails({ data, onChange, onNext, saving, readOnly }: Props) {
  const address = data.address || {};
  const isSchool = data.program_category === 'school';
  const isIndian = isIndianNationality(data.nationality);
  const today = new Date();
  const dobFromYear = today.getFullYear() - 80;
  const dobToYear = today.getFullYear() - 3;

  const [showErrors, setShowErrors] = useState(false);

  // The Country select shows "India" as a visual fallback, but a fallback in the
  // displayed value doesn't write to state — so users who never touch the dropdown
  // submit with country undefined and trip "Country is required". Commit the default.
  useEffect(() => {
    if (!readOnly && !address.country) {
      onChange({ address: { ...address, country: 'India' } });
    }
  }, [address.country, readOnly]);

  // Validation predicates — these mirror the on-screen `*` markers.
  const missing = {
    full_name: !data.full_name?.trim(),
    gender: !data.gender,
    dob: !data.dob,
    nationality: !data.nationality,
    category: !data.category,
    email: !data.email || !EMAIL_RE.test(data.email),
    line1: !address.line1?.trim(),
    city: !address.city?.trim(),
    state: !address.state?.trim(),
    country: !address.country?.trim(),
    pin: isIndian ? !PIN_RE.test((address.pin_code || '').trim()) : !address.pin_code?.trim(),
  };
  const hasMissing = Object.values(missing).some(Boolean);

  // Human-readable labels keyed by predicate name. Used by the summary error
  // banner so the user sees exactly which fields are still empty instead of
  // a generic "fill all required fields" message.
  const FIELD_LABELS: Record<keyof typeof missing, string> = {
    full_name: "Full Name",
    gender: "Gender",
    dob: "Date of Birth",
    nationality: "Nationality",
    category: "Category",
    email: data.email && !EMAIL_RE.test(data.email) ? "Email (invalid format)" : "Email",
    line1: "Address Line",
    city: "City",
    state: "State",
    country: "Country",
    pin: isIndian ? "PIN Code (6 digits)" : "PIN / ZIP Code",
  };
  const missingLabels: string[] = (Object.keys(missing) as Array<keyof typeof missing>)
    .filter(k => missing[k])
    .map(k => FIELD_LABELS[k]);

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
    <div className="space-y-6">
      <h2 className="text-lg font-semibold text-foreground">
        {isSchool ? 'Child Details' : 'Personal Details'}
      </h2>

      <fieldset disabled={readOnly} className={readOnly ? "pointer-events-none opacity-75" : ""}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-5">
        <TextField
          label="Full Name"
          required
          value={data.full_name || ""}
          onValueChange={(value) => onChange({ full_name: value })}
          error={showErrors && missing.full_name ? "Full name is required." : undefined}
          inputClassName={inputCls}
        />
        <SelectField
          label="Gender"
          required
          value={data.gender || ""}
          onValueChange={(value) => onChange({ gender: value })}
          options={genderOptions}
          placeholder="Select"
          error={showErrors && missing.gender ? "Gender is required." : undefined}
          triggerClassName={inputCls}
        />
        <div>
          <DatePickerField
            label="Date of Birth"
            required
            value={data.dob || ""}
            onValueChange={(value) => onChange({ dob: value })}
            disabled={readOnly}
            error={showErrors && missing.dob ? "Date of birth is required." : undefined}
            placeholder="Select date of birth"
            fromYear={dobFromYear}
            toYear={dobToYear}
            maxDate={today}
            defaultMonth={new Date(dobToYear, 5, 1)}
            triggerClassName={inputCls}
          />
          {dobWarning && (
            <div className="mt-1.5 flex items-start gap-1.5 text-destructive">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span className="text-xs">{dobWarning.message}</span>
            </div>
          )}
        </div>
        <SelectField
          label="Nationality"
          required
          value={data.nationality || "Indian"}
          onValueChange={(nat) => {
              onChange({
                nationality: nat,
                aadhaar: nat === 'Indian' ? data.aadhaar : '',
                passport_number: nat !== 'Indian' ? data.passport_number : '',
              });
          }}
          options={NATIONALITIES}
          error={showErrors && missing.nationality ? "Nationality is required." : undefined}
          triggerClassName={inputCls}
        />
        <SelectField
          label="Category"
          required
          value={data.category || ""}
          onValueChange={(value) => onChange({ category: value })}
          options={categoryOptions}
          placeholder="Select"
          error={showErrors && missing.category ? "Category is required." : undefined}
          triggerClassName={inputCls}
        />
        {/* Conditional: Aadhaar for Indian, Passport for others */}
        {isIndian ? (
          <TextField
            label="🇮🇳 Aadhaar No (optional)"
            value={data.aadhaar || ""}
            onValueChange={(value) => onChange({ aadhaar: value.replace(/\D/g, '').slice(0, 12) })}
            placeholder="12-digit number"
            inputClassName={inputCls}
          />
        ) : (
          <TextField
            label="🛂 Passport No (optional)"
            value={data.passport_number || ""}
            onValueChange={(value) => onChange({ passport_number: value.toUpperCase().slice(0, 15) })}
            placeholder="Passport number"
            inputClassName={inputCls}
          />
        )}
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Phone *</label>
          <PhoneInput value={data.phone} onChange={() => {}} disabled />
        </div>
        <TextField
          label="Email"
          required
          type="email"
          value={data.email || ""}
          onValueChange={(value) => onChange({ email: value })}
          error={showErrors && missing.email ? "A valid email address is required." : undefined}
          inputClassName={inputCls}
        />
      </div>

      {/* APAAR / PEN */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-5 mt-1">
        <TextField
          label="APAAR ID (optional)"
          value={data.apaar_id || ""}
          onValueChange={(value) => onChange({ apaar_id: value.replace(/\D/g, '').slice(0, 12) })}
          placeholder="12-digit Academic Bank ID"
          inputClassName={inputCls}
        />
        {isSchool && (
          <TextField
            label="PEN Number (optional)"
            value={data.pen_number || ""}
            onValueChange={(value) => onChange({ pen_number: value })}
            inputClassName={inputCls}
          />
        )}
      </div>

      {/* Address */}
      <h3 className="text-sm font-semibold text-foreground mt-6 pt-4 border-t border-border/40">Address <span className="text-destructive">*</span></h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-5">
        <TextField
          label="Address Line"
          required
          value={address.line1 || ""}
          onValueChange={(value) => onChange({ address: { ...address, line1: value } })}
          error={showErrors && missing.line1 ? "Address line is required." : undefined}
          containerClassName="sm:col-span-2"
          inputClassName={inputCls}
        />
        <TextField
          label="City"
          required
          value={address.city || ""}
          onValueChange={(value) => onChange({ address: { ...address, city: value } })}
          error={showErrors && missing.city ? "City is required." : undefined}
          inputClassName={inputCls}
        />
        <div>
          {/* When country is India, restrict to the canonical 28+8 list. Falls back
              to a free-text input for other countries since province/state names
              vary widely. */}
          {(address.country || 'India') === 'India' ? (
            <SelectField
              label="State"
              required
              value={address.state || ''}
              onValueChange={(value) => onChange({ address: { ...address, state: value } })}
              options={INDIAN_STATES.map((state) => ({ value: state, label: state }))}
              placeholder="Select state"
              error={showErrors && missing.state ? "State is required." : undefined}
              triggerClassName={inputCls}
            />
          ) : (
            <TextField
              label="State"
              required
              value={address.state || ''}
              onValueChange={(value) => onChange({ address: { ...address, state: value } })}
              placeholder="State / Province / Region"
              error={showErrors && missing.state ? "State is required." : undefined}
              inputClassName={inputCls}
            />
          )}
        </div>
        <SelectField
          label="Country"
          required
          value={address.country || 'India'}
          onValueChange={(newCountry) => {
              // Reset state when switching country since the state list changes.
              onChange({ address: { ...address, country: newCountry, state: newCountry === address.country ? address.state : '' } });
          }}
          options={COUNTRIES.map((country) => ({ value: country.name, label: `${country.flag} ${country.name}` }))}
          error={showErrors && missing.country ? "Country is required." : undefined}
          triggerClassName={inputCls}
        />
        <TextField
          label="PIN Code"
          required
          value={address.pin_code || ""}
          onValueChange={(value) => onChange({ address: { ...address, pin_code: value.replace(/\D/g, '').slice(0, 6) } })}
          error={showErrors && missing.pin ? (isIndian ? "Enter a valid 6-digit PIN code." : "PIN / ZIP code is required.") : undefined}
          inputClassName={inputCls}
        />
      </div>

      {showErrors && hasMissing && (
        <div className="p-3 rounded-xl bg-destructive/10 border border-destructive/20 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
          <div className="text-xs text-destructive font-medium space-y-1">
            <p>
              {missingLabels.length === 1
                ? "Please fill this required field:"
                : `Please fill these ${missingLabels.length} required fields:`}
            </p>
            <ul className="list-disc pl-4 font-normal text-destructive/90">
              {missingLabels.map(l => <li key={l}>{l}</li>)}
            </ul>
          </div>
        </div>
      )}

      </fieldset>

      <div className="flex justify-end">
        <Button
          onClick={() => {
            if (hasMissing) { setShowErrors(true); return; }
            onNext();
          }}
          disabled={saving || !!dobWarning}
          className="gap-2"
        >
          {saving ? <ButtonOrb state="working" onFilled /> : <ArrowRight className="h-4 w-4" />}
          Save & Continue
        </Button>
      </div>
    </div>
  );
}
