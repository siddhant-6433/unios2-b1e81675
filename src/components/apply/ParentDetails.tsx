import { useState } from "react";
import { ArrowRight, ArrowLeft, Loader2, AlertTriangle, User, Users, UserPlus, CalendarIcon, ChevronLeft, ChevronRight, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { PhoneInput } from "@/components/ui/phone-input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
  icon: any;
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

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function toIsoDate(date: Date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function sameDate(a?: Date, b?: Date) {
  return !!a && !!b
    && a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

function clampMonth(date: Date, minDate: Date, maxDate: Date) {
  const month = new Date(date.getFullYear(), date.getMonth(), 1);
  const minMonth = new Date(minDate.getFullYear(), minDate.getMonth(), 1);
  const maxMonth = new Date(maxDate.getFullYear(), maxDate.getMonth(), 1);
  if (month < minMonth) return minMonth;
  if (month > maxMonth) return maxMonth;
  return month;
}

/* ── DOB calendar picker helper ── */
function ParentDobPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);

  const selected: Date | undefined = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T00:00:00`)
    : undefined;

  const today = new Date();
  const minDate = new Date(today.getFullYear() - 100, 0, 1);
  const maxDate = new Date(today.getFullYear() - 15, today.getMonth(), today.getDate());
  const initialView = clampMonth(selected ?? maxDate, minDate, maxDate);
  const [viewMonth, setViewMonth] = useState(initialView);
  const [draftDate, setDraftDate] = useState<Date | undefined>(selected);
  const [choosingYear, setChoosingYear] = useState(false);

  const displayValue = selected
    ? selected.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
    : "";

  const openPicker = (nextOpen: boolean) => {
    if (nextOpen) {
      const month = clampMonth(selected ?? maxDate, minDate, maxDate);
      setViewMonth(month);
      setDraftDate(selected);
      setChoosingYear(false);
    }
    setOpen(nextOpen);
  };

  const firstDay = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1);
  const startOffset = firstDay.getDay();
  const gridStart = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1 - startOffset);
  const days = Array.from({ length: 42 }, (_, i) => {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + i);
    return date;
  });
  const years = Array.from(
    { length: maxDate.getFullYear() - minDate.getFullYear() + 1 },
    (_, i) => maxDate.getFullYear() - i,
  );
  const canGoPrev = new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1) >= new Date(minDate.getFullYear(), minDate.getMonth(), 1);
  const canGoNext = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1) <= new Date(maxDate.getFullYear(), maxDate.getMonth(), 1);

  return (
    <Popover open={open} onOpenChange={openPicker}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`${inputCls} flex items-center justify-between text-left ${!displayValue ? "text-muted-foreground" : ""}`}
        >
          <span>{displayValue || "Select date of birth"}</span>
          <CalendarIcon className="h-4 w-4 text-muted-foreground shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="z-[80] w-[312px] rounded-3xl border-border bg-popover p-0 shadow-xl"
        align="start"
        side="bottom"
        sideOffset={8}
        collisionPadding={16}
      >
        <div className="space-y-3 p-4">
          <div className="flex items-center justify-between">
            <h4 className="text-base font-semibold text-foreground">Set date</h4>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="Close date picker"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => canGoPrev && setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1))}
              disabled={!canGoPrev}
              className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
              aria-label="Previous month"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={() => setChoosingYear(!choosingYear)}
              className="rounded-full px-4 py-2 text-sm font-semibold text-foreground hover:bg-muted"
            >
              {MONTHS[viewMonth.getMonth()]} {viewMonth.getFullYear()}
            </button>
            <button
              type="button"
              onClick={() => canGoNext && setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1))}
              disabled={!canGoNext}
              className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
              aria-label="Next month"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </div>

          {choosingYear ? (
            <div className="max-h-56 overflow-y-auto pr-1">
              <div className="grid grid-cols-3 gap-2">
                {years.map(year => {
                  const active = year === viewMonth.getFullYear();
                  return (
                    <button
                      key={year}
                      type="button"
                      onClick={() => {
                        setViewMonth(clampMonth(new Date(year, viewMonth.getMonth(), 1), minDate, maxDate));
                        setChoosingYear(false);
                      }}
                      className={`rounded-full px-3 py-2 text-sm font-medium transition-colors ${
                        active ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-muted"
                      }`}
                    >
                      {year}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-7 gap-y-2">
                {WEEKDAYS.map(day => (
                  <div key={day} className="py-1 text-center text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {day}
                  </div>
                ))}
                {days.map(date => {
                  const inMonth = date.getMonth() === viewMonth.getMonth();
                  const disabled = date < minDate || date > maxDate;
                  const active = sameDate(date, draftDate);
                  return (
                    <button
                      key={date.toISOString()}
                      type="button"
                      disabled={disabled}
                      onClick={() => setDraftDate(new Date(date))}
                      className={`mx-auto flex h-8 w-8 items-center justify-center rounded-full text-sm transition-colors ${
                        active
                          ? "bg-primary text-primary-foreground shadow-sm"
                          : inMonth
                            ? "text-foreground hover:bg-muted"
                            : "text-muted-foreground/35"
                      } disabled:cursor-not-allowed disabled:text-muted-foreground/25 disabled:hover:bg-transparent`}
                    >
                      {date.getDate()}
                    </button>
                  );
                })}
              </div>

              <Button
                type="button"
                disabled={!draftDate}
                onClick={() => {
                  if (!draftDate) return;
                  onChange(toIsoDate(draftDate));
                  setOpen(false);
                }}
                className="h-10 w-full rounded-full gap-2"
              >
                Set Date
                <Check className="h-4 w-4" />
              </Button>
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/* ── School Parent Block (comprehensive) ── */
function SchoolParentBlock({
  title,
  value,
  onChange,
  showErrors,
}: {
  title: string;
  value: Record<string, string>;
  onChange: (v: Record<string, string>) => void;
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

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Row 1: First Name, Last Name, DOB */}
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">First Name *</label>
          <input value={value.first_name || ''} onChange={e => set('first_name', e.target.value)} className={`${inputCls} ${showErrors && missing.first_name ? invalidCls : ''}`} />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Last Name *</label>
          <input value={value.last_name || ''} onChange={e => set('last_name', e.target.value)} className={`${inputCls} ${showErrors && missing.last_name ? invalidCls : ''}`} />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Date of Birth</label>
          <ParentDobPicker value={value.dob || ''} onChange={v => set('dob', v)} />
        </div>

        {/* Row 2: Nationality, ID Type + Number */}
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Nationality *</label>
          <select
            value={nationality}
            onChange={e => {
              const nat = e.target.value;
              onChange({
                ...value,
                nationality: nat,
                id_type: nat === 'Indian' ? 'aadhaar' : 'passport',
                id_number: '', // reset on nationality change
              });
            }}
            className={`${inputCls} ${showErrors && missing.nationality ? invalidCls : ''}`}
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

        {/* Row 3: Education, Marital Status, Email */}
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Education *</label>
          <select value={value.education || ''} onChange={e => set('education', e.target.value)} className={`${inputCls} ${showErrors && missing.education ? invalidCls : ''}`}>
            <option value="">Select Education</option>
            {EDUCATION_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Marital Status *</label>
          <select value={value.marital_status || ''} onChange={e => set('marital_status', e.target.value)} className={`${inputCls} ${showErrors && missing.marital_status ? invalidCls : ''}`}>
            <option value="">Select Marital Status</option>
            {MARITAL_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Email Address *</label>
          <input type="email" value={value.email || ''} onChange={e => set('email', e.target.value)} placeholder="Email Address" className={`${inputCls} ${showErrors && missing.email ? invalidCls : ''}`} />
        </div>

        <div className="sm:col-span-3 space-y-3 border-t border-border pt-4">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-foreground">Employment Details</h4>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Employment Status *</label>
              <select
                value={employmentStatus}
                onChange={e => {
                  const status = e.target.value;
                  onChange({
                    ...value,
                    employment_status: status,
                    employer_name: status === "Homemaker" ? "" : value.employer_name,
                    position: status === "Homemaker" ? "" : value.position,
                    current_position: status === "Homemaker" || legacyStatus ? "" : value.current_position,
                  });
                }}
                className={`${inputCls} ${showErrors && missing.employment_status ? invalidCls : ''}`}
              >
                <option value="">Select Status</option>
                {EMPLOYMENT_STATUS_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
            {!isHomemaker && (
              <>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Employer Name *</label>
                  <input value={value.employer_name || ''} onChange={e => set('employer_name', e.target.value)} placeholder="Employer Name" className={`${inputCls} ${showErrors && missing.employer_name ? invalidCls : ''}`} />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Position *</label>
                  <input
                    value={positionValue}
                    onChange={e => onChange({ ...value, position: e.target.value, current_position: e.target.value })}
                    placeholder="Position"
                    className={`${inputCls} ${showErrors && missing.current_position ? invalidCls : ''}`}
                  />
                </div>
              </>
            )}
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Annual Income</label>
              <select value={value.annual_income || ''} onChange={e => set('annual_income', e.target.value)} className={inputCls}>
                <option value="">Select Annual Income</option>
                {INCOME_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
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
  value: Record<string, string>;
  onChange: (v: Record<string, string>) => void;
  /** When true, Name and Phone are mandatory and validated. */
  required?: boolean;
  /** Render inline error messages (only after a failed Save attempt). */
  showErrors?: boolean;
}) {
  const nameMissing = required && !(value.name || '').trim();
  const phoneMissing = required && !PHONE_DIGITS_RE.test((value.phone || '').replace(/\D/g, ''));
  const isOtherOccupation = value.occupation === 'Other';
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <div>
        <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
          Name {required && <span className="text-destructive">*</span>}
        </label>
        <input value={value.name || ''} onChange={e => onChange({ ...value, name: e.target.value })}
          className={`${inputCls} ${showErrors && nameMissing ? 'border-destructive' : ''}`} />
        {showErrors && nameMissing && (
          <p className="mt-1 text-[11px] text-destructive">Name is required.</p>
        )}
      </div>
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
      <div>
        <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Email (optional)</label>
        <input type="email" value={value.email || ''} onChange={e => onChange({ ...value, email: e.target.value })} className={inputCls} />
      </div>
      <div>
        <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Occupation</label>
        <select value={value.occupation || ''}
          onChange={e => onChange({ ...value, occupation: e.target.value, occupation_other: e.target.value === 'Other' ? (value.occupation_other || '') : '' })}
          className={inputCls}>
          <option value="">Select occupation</option>
          {OCCUPATION_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      </div>
      {isOtherOccupation && (
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Specify occupation</label>
          <input value={value.occupation_other || ''} onChange={e => onChange({ ...value, occupation_other: e.target.value })}
            placeholder="e.g. Architect, Chef" className={inputCls} />
        </div>
      )}
      <div className={isOtherOccupation ? '' : 'sm:col-span-2'}>
        <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Workplace / Employer (optional)</label>
        <input value={value.employer_name || ''} onChange={e => onChange({ ...value, employer_name: e.target.value })}
          placeholder="Company, organisation, or self-employed" className={inputCls} />
      </div>
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
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
            Name <span className="text-destructive">*</span>
          </label>
          <input value={value.name || ''} onChange={e => set({ name: e.target.value })}
            className={`${inputCls} ${showErrors && nameMissing ? 'border-destructive' : ''}`} />
          {showErrors && nameMissing && (
            <p className="mt-1 text-[11px] text-destructive">Guardian name is required.</p>
          )}
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
            Mobile <span className="text-destructive">*</span>
          </label>
          <PhoneInput value={value.phone || ''} onChange={(phone) => set({ phone })} invalid={showErrors && phoneMissing} />
          {showErrors && phoneMissing && (
            <p className="mt-1 text-[11px] text-destructive">A valid 10-digit mobile number is required.</p>
          )}
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
            Relationship <span className="text-destructive">*</span>
          </label>
          <select
            value={value.relationship || ''}
            onChange={e => set({ relationship: e.target.value, relationship_other: e.target.value === 'Other' ? (value.relationship_other || '') : undefined })}
            className={`${inputCls} ${showErrors && relMissing ? 'border-destructive' : ''}`}
          >
            <option value="">Select relationship</option>
            {GUARDIAN_RELATIONSHIPS.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
          {showErrors && relMissing && value.relationship !== 'Other' && (
            <p className="mt-1 text-[11px] text-destructive">Relationship is required.</p>
          )}
        </div>
        {value.relationship === 'Other' && (
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
              Specify relationship <span className="text-destructive">*</span>
            </label>
            <input value={value.relationship_other || ''} onChange={e => set({ relationship_other: e.target.value })}
              className={`${inputCls} ${showErrors && relMissing ? 'border-destructive' : ''}`}
              placeholder="e.g. Step-parent, Legal guardian" />
            {showErrors && relMissing && (
              <p className="mt-1 text-[11px] text-destructive">Please specify the relationship.</p>
            )}
          </div>
        )}
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Email (optional)</label>
          <input type="email" value={value.email || ''} onChange={e => set({ email: e.target.value })} className={inputCls} />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Occupation (optional)</label>
          <select value={value.occupation || ''}
            onChange={e => set({ occupation: e.target.value, occupation_other: e.target.value === 'Other' ? (value.occupation_other || '') : undefined })}
            className={inputCls}>
            <option value="">Select occupation</option>
            {OCCUPATION_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
        {isOtherOccupation && (
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Specify occupation</label>
            <input value={value.occupation_other || ''} onChange={e => set({ occupation_other: e.target.value })}
              placeholder="e.g. Architect, Chef" className={inputCls} />
          </div>
        )}
      </div>

      <div className="space-y-3">
        <p className="text-xs font-semibold text-foreground uppercase tracking-wide">
          Guardian Address <span className="text-destructive">*</span>
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Address Line <span className="text-destructive">*</span></label>
            <input value={addr.line1 || ''} onChange={e => setAddr({ line1: e.target.value })}
              className={`${inputCls} ${showErrors && addrMissing.line1 ? 'border-destructive' : ''}`} />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">City <span className="text-destructive">*</span></label>
            <input value={addr.city || ''} onChange={e => setAddr({ city: e.target.value })}
              className={`${inputCls} ${showErrors && addrMissing.city ? 'border-destructive' : ''}`} />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">State <span className="text-destructive">*</span></label>
            <input value={addr.state || ''} onChange={e => setAddr({ state: e.target.value })}
              className={`${inputCls} ${showErrors && addrMissing.state ? 'border-destructive' : ''}`} />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Country <span className="text-destructive">*</span></label>
            <input value={addr.country || 'India'} onChange={e => setAddr({ country: e.target.value })}
              className={`${inputCls} ${showErrors && addrMissing.country ? 'border-destructive' : ''}`} />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">PIN Code <span className="text-destructive">*</span></label>
            <input value={addr.pin_code || ''} onChange={e => setAddr({ pin_code: e.target.value.replace(/\D/g, '').slice(0, 6) })}
              className={`${inputCls} ${showErrors && addrMissing.pin ? 'border-destructive' : ''}`} />
            {showErrors && addrMissing.pin && (
              <p className="mt-1 text-[11px] text-destructive">Enter a valid 6-digit PIN code.</p>
            )}
          </div>
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
            accent="border-blue-500" iconColor="text-blue-600" bg="bg-blue-50/60">
            {isSchool ? (
              <SchoolParentBlock title="" value={data.father as any} onChange={v => onChange({ father: v })} showErrors={showErrors} />
            ) : (
              <SimpleParentBlock value={data.father as any} onChange={v => onChange({ father: v })} required showErrors={showErrors} />
            )}
          </SectionCard>

          <SectionCard title="Mother" icon={User}
            accent="border-pink-500" iconColor="text-pink-600" bg="bg-pink-50/60">
            {isSchool ? (
              <SchoolParentBlock title="" value={data.mother as any} onChange={v => onChange({ mother: v })} showErrors={showErrors} />
            ) : (
              <SimpleParentBlock value={data.mother as any} onChange={v => onChange({ mother: v })} required showErrors={showErrors} />
            )}
          </SectionCard>

          <SectionCard
            title="Guardian"
            subtitle="Optional — add if a guardian other than parents should also be on record."
            icon={guardianOn ? Users : UserPlus}
            accent={guardianOn ? "border-violet-500" : "border-border"}
            iconColor={guardianOn ? "text-violet-600" : "text-muted-foreground"}
            bg={guardianOn ? "bg-violet-50/60" : "bg-muted/30"}
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
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
          Save & Continue
        </Button>
      </div>
    </div>
  );
}
