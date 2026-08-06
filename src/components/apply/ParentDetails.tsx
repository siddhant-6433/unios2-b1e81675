import { useState, type ComponentType } from "react";
import { ArrowRight, ArrowLeft, AlertTriangle, User, Users, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ButtonOrb } from "@/components/ui/thinking-orb";
import { Switch } from "@/components/ui/switch";
import { PhoneInput } from "@/components/ui/phone-input";
import { DatePickerField, SelectField, TextField } from "@/components/ui/state-fields";
import { ApplicationData } from "./types";
import { usePortal } from "./PortalContext";
import { getNationalityOptions, isIndianNationality } from "./countries";

const PHONE_DIGITS_RE = /\d{10,}/; // accepts +91XXXXXXXXXX, 91XXXXXXXXXX, or 10-digit local

const GUARDIAN_RELATIONSHIPS = [
  "Uncle", "Aunt", "Grandfather", "Grandmother",
  "Brother", "Sister", "Cousin", "Family Friend", "Other",
];

const OCCUPATION_OPTIONS = [
  "Government Employee", "Private Sector Employee", "Business Owner",
  "Self-Employed / Professional", "Doctor", "Engineer", "Teacher",
  "Farmer", "Defence / Armed Forces", "Homemaker", "Retired",
  "Unemployed", "Other",
];

/** Card wrapper for a parent/guardian section — coloured accent + icon header. */
function SectionCard({
  title, subtitle, icon: Icon, accent, iconColor, bg, headerRight, children,
}: {
  title: string;
  subtitle?: string;
  icon: ComponentType<{ className?: string }>;
  accent: string;
  iconColor: string;
  bg: string;
  headerRight?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className={`rounded-2xl border border-border bg-card overflow-hidden border-l-4 ${accent}`}>
      <header className={`px-4 py-3 ${bg} flex items-center justify-between gap-3`}>
        <div className="flex items-center gap-2.5">
          <Icon className={`h-5 w-5 ${iconColor}`} />
          <div>
            <h3 className="text-base font-semibold text-foreground">{title}</h3>
            {subtitle && <p className="text-[11px] text-muted-foreground">{subtitle}</p>}
          </div>
        </div>
        {headerRight}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

interface Props {
  data: ApplicationData;
  onChange: (data: Partial<ApplicationData>) => void;
  onNext: () => void;
  onBack?: () => void;
  saving: boolean;
  readOnly?: boolean;
}

const inputCls = "w-full rounded-xl border border-input bg-card py-2.5 px-4 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20";
const invalidCls = "border-destructive ring-1 ring-destructive/30 focus:ring-destructive/30";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

const EMPLOYMENT_STATUS_OPTIONS = [
  "Employed", "Self-Employed", "Business Owner", "Professional",
  "Government Employee", "Homemaker", "Retired", "Other",
];
const educationOptions = EDUCATION_OPTIONS.map((value) => ({ value, label: value }));
const incomeOptions = INCOME_OPTIONS.map((value) => ({ value, label: value }));
const maritalOptions = MARITAL_OPTIONS.map((value) => ({ value, label: value }));
const employmentStatusOptions = EMPLOYMENT_STATUS_OPTIONS.map((value) => ({ value, label: value }));
const occupationOptions = OCCUPATION_OPTIONS.map((value) => ({ value, label: value }));
const guardianRelationshipOptions = GUARDIAN_RELATIONSHIPS.map((value) => ({ value, label: value }));

type ParentRecord = ApplicationData["father"] | ApplicationData["mother"];

/* ── School Parent Block (comprehensive) ── */
function SchoolParentBlock({
  title,
  value,
  onChange,
  showErrors,
}: {
  title: string;
  value: ParentRecord;
  onChange: (v: ParentRecord) => void;
  showErrors?: boolean;
}) {
  const nationality = value.nationality || "Indian";
  const isIndian = isIndianNationality(nationality);
  const set = (field: string, val: string) => onChange({ ...value, [field]: val });
  const legacyStatus = EMPLOYMENT_STATUS_OPTIONS.includes(value.current_position || "")
    ? value.current_position || ""
    : "";
  const employmentStatus = value.employment_status || legacyStatus;
  const positionValue = value.position || (legacyStatus ? "" : value.current_position || "");
  const isHomemaker = employmentStatus === "Homemaker";
  const missing = {
    first_name: !value.first_name?.trim(),
    last_name: !value.last_name?.trim(),
    nationality: !nationality.trim(),
    education: !value.education?.trim(),
    employment_status: !employmentStatus,
    employer_name: !isHomemaker && !value.employer_name?.trim(),
    current_position: !isHomemaker && !positionValue.trim(),
    marital_status: !value.marital_status?.trim(),
    email: !value.email?.trim() || !EMAIL_RE.test(value.email),
    phone_mobile: !PHONE_DIGITS_RE.test((value.phone_mobile || value.phone || '').replace(/\D/g, '')),
  };
  const today = new Date();
  const minDob = new Date(today.getFullYear() - 100, 0, 1);
  const maxDob = new Date(today.getFullYear() - 15, today.getMonth(), today.getDate());

  return (
    <div className="space-y-5">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-4 gap-y-5">
        {/* Row 1: First Name, Last Name, DOB */}
        <TextField
          label="First Name"
          required
          value={value.first_name || ''}
          onValueChange={(nextValue) => set('first_name', nextValue)}
          error={showErrors && missing.first_name ? "First name is required." : undefined}
          inputClassName={inputCls}
        />
        <TextField
          label="Last Name"
          required
          value={value.last_name || ''}
          onValueChange={(nextValue) => set('last_name', nextValue)}
          error={showErrors && missing.last_name ? "Last name is required." : undefined}
          inputClassName={inputCls}
        />
        <div>
          <DatePickerField
            label="Date of Birth"
            value={value.dob || ''}
            onValueChange={v => set('dob', v)}
            placeholder="Select date of birth"
            minDate={minDob}
            maxDate={maxDob}
            fromYear={minDob.getFullYear()}
            toYear={maxDob.getFullYear()}
            defaultMonth={maxDob}
            triggerClassName={inputCls}
          />
        </div>

        {/* Row 2: Nationality, ID Type + Number */}
        <SelectField
          label="Nationality"
          required
          value={nationality}
          onValueChange={(nat) => {
              onChange({
                ...value,
                nationality: nat,
                id_type: nat === 'Indian' ? 'aadhaar' : 'passport',
                id_number: '', // reset on nationality change
              });
          }}
          options={NATIONALITIES}
          error={showErrors && missing.nationality ? "Nationality is required." : undefined}
          triggerClassName={`${inputCls} ${showErrors && missing.nationality ? invalidCls : ''}`}
        />
        <TextField
          label={isIndian ? '🇮🇳 Aadhaar No' : '🛂 Passport No'}
          value={value.id_number || ''}
          onValueChange={(nextValue) => {
              const val = isIndian
                ? nextValue.replace(/\D/g, '').slice(0, 12)
                : nextValue.toUpperCase().slice(0, 15);
              set('id_number', val);
          }}
          placeholder={isIndian ? '12-digit Aadhaar number' : 'Passport number'}
          containerClassName="sm:col-span-2"
          inputClassName={inputCls}
        />

        {/* Row 3: Education, Marital Status, Email */}
        <SelectField
          label="Education"
          required
          value={value.education || ''}
          onValueChange={(nextValue) => set('education', nextValue)}
          options={educationOptions}
          placeholder="Select Education"
          error={showErrors && missing.education ? "Education is required." : undefined}
          triggerClassName={`${inputCls} ${showErrors && missing.education ? invalidCls : ''}`}
        />
        <SelectField
          label="Marital Status"
          required
          value={value.marital_status || ''}
          onValueChange={(nextValue) => set('marital_status', nextValue)}
          options={maritalOptions}
          placeholder="Select Marital Status"
          error={showErrors && missing.marital_status ? "Marital status is required." : undefined}
          triggerClassName={`${inputCls} ${showErrors && missing.marital_status ? invalidCls : ''}`}
        />
        <TextField
          label="Email Address"
          required
          type="email"
          value={value.email || ''}
          onValueChange={(nextValue) => set('email', nextValue)}
          placeholder="Email Address"
          error={showErrors && missing.email ? "A valid email address is required." : undefined}
          inputClassName={inputCls}
        />

        <div className="sm:col-span-3 space-y-3 border-t border-border pt-4">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-foreground">Employment Details</h4>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-x-4 gap-y-5">
            <SelectField
              label="Employment Status"
              required
              value={employmentStatus}
              onValueChange={(status) => {
                  onChange({
                    ...value,
                    employment_status: status,
                    employer_name: status === "Homemaker" ? "" : value.employer_name,
                    position: status === "Homemaker" ? "" : value.position,
                    current_position: status === "Homemaker" || legacyStatus ? "" : value.current_position,
                  });
              }}
              options={employmentStatusOptions}
              placeholder="Select Status"
              error={showErrors && missing.employment_status ? "Employment status is required." : undefined}
              triggerClassName={`${inputCls} ${showErrors && missing.employment_status ? invalidCls : ''}`}
            />
            {!isHomemaker && (
              <>
                <TextField
                  label="Employer Name"
                  required
                  value={value.employer_name || ''}
                  onValueChange={(nextValue) => set('employer_name', nextValue)}
                  placeholder="Employer Name"
                  error={showErrors && missing.employer_name ? "Employer name is required." : undefined}
                  inputClassName={`${inputCls} ${showErrors && missing.employer_name ? invalidCls : ''}`}
                />
                <TextField
                  label="Position"
                  required
                  value={positionValue}
                  onValueChange={(nextValue) => onChange({ ...value, position: nextValue, current_position: nextValue })}
                  placeholder="Position"
                  error={showErrors && missing.current_position ? "Position is required." : undefined}
                  inputClassName={`${inputCls} ${showErrors && missing.current_position ? invalidCls : ''}`}
                />
              </>
            )}
            <SelectField
              label="Annual Income"
              value={value.annual_income || ''}
              onValueChange={(nextValue) => set('annual_income', nextValue)}
              options={incomeOptions}
              placeholder="Select Annual Income"
              triggerClassName={inputCls}
            />
          </div>
        </div>

        {/* Row 5: Phone (Mobile), Phone (Home) */}
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Phone Number (Mobile) *</label>
          <PhoneInput value={value.phone_mobile || value.phone || ''} onChange={v => set('phone_mobile', v)} invalid={showErrors && missing.phone_mobile} />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Phone Number (Home)</label>
          <PhoneInput value={value.phone_home || ''} onChange={v => set('phone_home', v)} />
        </div>
      </div>
    </div>
  );
}

/* ── Simple Parent Block (non-school father / mother) ── */
function SimpleParentBlock({
  value,
  onChange,
  required,
  showErrors,
}: {
  value: ParentRecord;
  onChange: (v: ParentRecord) => void;
  /** When true, Name and Phone are mandatory and validated. */
  required?: boolean;
  /** Render inline error messages (only after a failed Save attempt). */
  showErrors?: boolean;
}) {
  const nameMissing = required && !(value.name || '').trim();
  const phoneMissing = required && !PHONE_DIGITS_RE.test((value.phone || '').replace(/\D/g, ''));
  const isOtherOccupation = value.occupation === 'Other';
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-5">
      <TextField
        label="Name"
        required={required}
        value={value.name || ''}
        onValueChange={(nextValue) => onChange({ ...value, name: nextValue })}
        error={showErrors && nameMissing ? "Name is required." : undefined}
        inputClassName={inputCls}
      />
      <div>
        <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
          Mobile {required && <span className="text-destructive">*</span>}
        </label>
        <PhoneInput
          value={value.phone || ''}
          onChange={(phone) => onChange({ ...value, phone })}
          invalid={showErrors && phoneMissing}
        />
        {showErrors && phoneMissing && (
          <p className="mt-1 text-[11px] text-destructive">A valid 10-digit mobile number is required.</p>
        )}
      </div>
      <TextField
        label="Email (optional)"
        type="email"
        value={value.email || ''}
        onValueChange={(nextValue) => onChange({ ...value, email: nextValue })}
        inputClassName={inputCls}
      />
      <SelectField
        label="Occupation"
        value={value.occupation || ''}
        onValueChange={(nextValue) => onChange({ ...value, occupation: nextValue, occupation_other: nextValue === 'Other' ? (value.occupation_other || '') : '' })}
        options={occupationOptions}
        placeholder="Select occupation"
        triggerClassName={inputCls}
      />
      {isOtherOccupation && (
        <TextField
          label="Specify occupation"
          value={value.occupation_other || ''}
          onValueChange={(nextValue) => onChange({ ...value, occupation_other: nextValue })}
          placeholder="e.g. Architect, Chef"
          inputClassName={inputCls}
        />
      )}
      <TextField
        label="Workplace / Employer (optional)"
        value={value.employer_name || ''}
        onValueChange={(nextValue) => onChange({ ...value, employer_name: nextValue })}
        placeholder="Company, organisation, or self-employed"
        containerClassName={isOtherOccupation ? '' : 'sm:col-span-2'}
        inputClassName={inputCls}
      />
    </div>
  );
}

/* ── Guardian Block ── */
type Guardian = NonNullable<ApplicationData['guardian']>;

function GuardianBlock({
  value,
  onChange,
  showErrors,
}: {
  value: Guardian;
  onChange: (v: Guardian) => void;
  showErrors?: boolean;
}) {
  const set = (patch: Partial<Guardian>) => onChange({ ...value, ...patch });
  const setAddr = (patch: Record<string, string>) => onChange({ ...value, address: { ...(value.address || {}), ...patch } });
  const addr = value.address || {};

  const nameMissing = !(value.name || '').trim();
  const phoneMissing = !PHONE_DIGITS_RE.test((value.phone || '').replace(/\D/g, ''));
  const relMissing = !(value.relationship || '').trim()
    || (value.relationship === 'Other' && !(value.relationship_other || '').trim());
  const isOtherOccupation = value.occupation === 'Other';
  const addrMissing = {
    line1: !addr.line1?.trim(),
    city: !addr.city?.trim(),
    state: !addr.state?.trim(),
    country: !(addr.country || 'India').trim(),
    pin: !/^\d{6}$/.test((addr.pin_code || '').trim()),
  };

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-5">
        <TextField
          label="Name"
          required
          value={value.name || ''}
          onValueChange={(nextValue) => set({ name: nextValue })}
          error={showErrors && nameMissing ? "Guardian name is required." : undefined}
          inputClassName={inputCls}
        />
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
            Mobile <span className="text-destructive">*</span>
          </label>
          <PhoneInput value={value.phone || ''} onChange={(phone) => set({ phone })} invalid={showErrors && phoneMissing} />
          {showErrors && phoneMissing && (
            <p className="mt-1 text-[11px] text-destructive">A valid 10-digit mobile number is required.</p>
          )}
        </div>
        <SelectField
          label="Relationship"
          required
          value={value.relationship || ''}
          onValueChange={(nextValue) => set({ relationship: nextValue, relationship_other: nextValue === 'Other' ? (value.relationship_other || '') : undefined })}
          options={guardianRelationshipOptions}
          placeholder="Select relationship"
          error={showErrors && relMissing && value.relationship !== 'Other' ? "Relationship is required." : undefined}
          triggerClassName={`${inputCls} ${showErrors && relMissing ? invalidCls : ''}`}
        />
        {value.relationship === 'Other' && (
          <TextField
            label="Specify relationship"
            required
            value={value.relationship_other || ''}
            onValueChange={(nextValue) => set({ relationship_other: nextValue })}
            error={showErrors && relMissing ? "Please specify the relationship." : undefined}
            placeholder="e.g. Step-parent, Legal guardian"
            inputClassName={inputCls}
          />
        )}
        <TextField
          label="Email (optional)"
          type="email"
          value={value.email || ''}
          onValueChange={(nextValue) => set({ email: nextValue })}
          inputClassName={inputCls}
        />
        <SelectField
          label="Occupation (optional)"
          value={value.occupation || ''}
          onValueChange={(nextValue) => set({ occupation: nextValue, occupation_other: nextValue === 'Other' ? (value.occupation_other || '') : undefined })}
          options={occupationOptions}
          placeholder="Select occupation"
          triggerClassName={inputCls}
        />
        {isOtherOccupation && (
          <TextField
            label="Specify occupation"
            value={value.occupation_other || ''}
            onValueChange={(nextValue) => set({ occupation_other: nextValue })}
            placeholder="e.g. Architect, Chef"
            inputClassName={inputCls}
          />
        )}
      </div>

      <div className="space-y-3">
        <p className="text-xs font-semibold text-foreground uppercase tracking-wide">
          Guardian Address <span className="text-destructive">*</span>
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-5">
          <TextField
            label="Address Line"
            required
            value={addr.line1 || ''}
            onValueChange={(nextValue) => setAddr({ line1: nextValue })}
            error={showErrors && addrMissing.line1 ? "Address line is required." : undefined}
            containerClassName="sm:col-span-2"
            inputClassName={inputCls}
          />
          <TextField
            label="City"
            required
            value={addr.city || ''}
            onValueChange={(nextValue) => setAddr({ city: nextValue })}
            error={showErrors && addrMissing.city ? "City is required." : undefined}
            inputClassName={inputCls}
          />
          <TextField
            label="State"
            required
            value={addr.state || ''}
            onValueChange={(nextValue) => setAddr({ state: nextValue })}
            error={showErrors && addrMissing.state ? "State is required." : undefined}
            inputClassName={inputCls}
          />
          <TextField
            label="Country"
            required
            value={addr.country || 'India'}
            onValueChange={(nextValue) => setAddr({ country: nextValue })}
            error={showErrors && addrMissing.country ? "Country is required." : undefined}
            inputClassName={inputCls}
          />
          <TextField
            label="PIN Code"
            required
            value={addr.pin_code || ''}
            onValueChange={(nextValue) => setAddr({ pin_code: nextValue.replace(/\D/g, '').slice(0, 6) })}
            error={showErrors && addrMissing.pin ? "Enter a valid 6-digit PIN code." : undefined}
            inputClassName={inputCls}
          />
        </div>
      </div>
    </div>
  );
}

export function ParentDetails({ data, onChange, onNext, onBack, saving, readOnly }: Props) {
  const portal = usePortal();
  const isSchool = portal.programCategories.includes("school");
  const [showErrors, setShowErrors] = useState(false);

  const father = (data.father as Record<string, string>) || {};
  const mother = (data.mother as Record<string, string>) || {};
  const guardian = (data.guardian || {}) as Guardian;

  // Guardian section toggle — start ON if any guardian field is already filled.
  const guardianHasData =
    !!(guardian.name || guardian.phone || guardian.relationship || guardian.email
       || guardian.occupation || guardian.address?.line1);
  const [guardianOn, setGuardianOn] = useState(guardianHasData);

  const validPhone = (p?: string) => PHONE_DIGITS_RE.test((p || '').replace(/\D/g, ''));
  const schoolParentOk = (p: Record<string, string>) => {
    const legacyStatus = EMPLOYMENT_STATUS_OPTIONS.includes(p.current_position || "")
      ? p.current_position || ""
      : "";
    const employmentStatus = p.employment_status || legacyStatus;
    const isHomemaker = employmentStatus === "Homemaker";
    const positionValue = p.position || (legacyStatus ? "" : p.current_position || "");
    const nationality = p.nationality || "Indian";

    return !!(
      p.first_name?.trim()
      && p.last_name?.trim()
      && nationality.trim()
      && p.education?.trim()
      && employmentStatus
      && (isHomemaker || p.employer_name?.trim())
      && (isHomemaker || positionValue.trim())
      && p.marital_status?.trim()
      && p.email?.trim()
      && EMAIL_RE.test(p.email)
      && validPhone(p.phone_mobile || p.phone)
    );
  };
  const parentsOk = isSchool
    ? schoolParentOk(father) && schoolParentOk(mother)
    : !!(father.name?.trim() && validPhone(father.phone)
        && mother.name?.trim() && validPhone(mother.phone));
  const guardianOk = !guardianOn || (
    !!guardian.name?.trim()
    && validPhone(guardian.phone)
    && !!guardian.relationship
    && (guardian.relationship !== 'Other' || !!guardian.relationship_other?.trim())
    && !!guardian.address?.line1?.trim()
    && !!guardian.address?.city?.trim()
    && !!guardian.address?.state?.trim()
    && !!(guardian.address?.country || 'India').trim()
    && /^\d{6}$/.test((guardian.address?.pin_code || '').trim())
  );
  const requiredOk = parentsOk && guardianOk;

  const handleContinue = () => {
    if (!requiredOk) {
      setShowErrors(true);
      return;
    }
    // If user toggled guardian off, clear stored data so we don't carry stale state.
    if (!guardianOn && guardianHasData) onChange({ guardian: {} });
    onNext();
  };

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold text-foreground">Parent / Guardian Details</h2>

      <fieldset disabled={readOnly} className={readOnly ? "pointer-events-none opacity-75" : ""}>
        <div className="space-y-6">
          <SectionCard title="Father" icon={User}
            accent="border-info/35" iconColor="text-info-foreground" bg="bg-info/5/60">
            {isSchool ? (
              <SchoolParentBlock title="" value={data.father} onChange={v => onChange({ father: v })} showErrors={showErrors} />
            ) : (
              <SimpleParentBlock value={data.father} onChange={v => onChange({ father: v })} required showErrors={showErrors} />
            )}
          </SectionCard>

          <SectionCard title="Mother" icon={User}
            accent="border-pink-500" iconColor="text-pink-600" bg="bg-pink-50/60">
            {isSchool ? (
              <SchoolParentBlock title="" value={data.mother} onChange={v => onChange({ mother: v })} showErrors={showErrors} />
            ) : (
              <SimpleParentBlock value={data.mother} onChange={v => onChange({ mother: v })} required showErrors={showErrors} />
            )}
          </SectionCard>

          <SectionCard
            title="Guardian"
            subtitle="Optional — add if a guardian other than parents should also be on record."
            icon={guardianOn ? Users : UserPlus}
            accent={guardianOn ? "border-primary/35" : "border-border"}
            iconColor={guardianOn ? "text-primary" : "text-muted-foreground"}
            bg={guardianOn ? "bg-primary/5/60" : "bg-muted/30"}
            headerRight={
              <Switch checked={guardianOn} onCheckedChange={setGuardianOn} aria-label="Toggle guardian section" />
            }
          >
            {guardianOn ? (
              <GuardianBlock value={guardian} onChange={v => onChange({ guardian: v })} showErrors={showErrors} />
            ) : (
              <p className="text-xs text-muted-foreground">Toggle on to add guardian details.</p>
            )}
          </SectionCard>
        </div>
      </fieldset>

      {showErrors && !requiredOk && (
        <div className="p-3 rounded-xl bg-destructive/10 border border-destructive/20 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
          <p className="text-xs text-destructive font-medium">
            {!parentsOk
              ? "Please complete all required Father and Mother fields to continue."
              : "Please complete the Guardian's name, mobile, relationship and address — or toggle the Guardian section off."}
          </p>
        </div>
      )}

      <div className="flex justify-between">
        {onBack ? (
          <Button variant="outline" onClick={onBack} className="gap-2">
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>
        ) : <div />}
        <Button onClick={handleContinue} disabled={saving} className="gap-2">
          {saving ? <ButtonOrb state="working" onFilled /> : <ArrowRight className="h-4 w-4" />}
          Save & Continue
        </Button>
      </div>
    </div>
  );
}
