import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Phone, Mail, MapPin, FileText, Building2, User, Globe, UserCheck, Sparkles, Pencil, Check, X, GraduationCap,
} from "lucide-react";
import type { CourseOption, CampusOption } from "@/hooks/useCourseCampusLink";

const STAGE_LABELS: Record<string, string> = {
  new_lead: "New Lead", application_in_progress: "Application In Progress", application_submitted: "Application Submitted",
  ai_called: "AI Called", counsellor_call: "Counsellor Call",
  visit_scheduled: "Visit Scheduled", interview: "Interview", offer_sent: "Offer Sent",
  token_paid: "Token Paid", pre_admitted: "Pre-Admitted", admitted: "Admitted", rejected: "Rejected",
};

interface LeadInfoCardProps {
  lead: any;
  counsellorName?: string;
  courseName?: string;
  campusName?: string;
  campusCity?: string;
  coursesByDepartment?: { department: string; courses: { id: string; name: string }[] }[];
  getCampusesForCourse?: (courseId: string | null) => CampusOption[];
  onStageChange: (stage: string) => void;
  onFieldUpdate?: (field: string, value: string | null, label: string) => void;
}

export function LeadInfoCard({
  lead, counsellorName, courseName, campusName, campusCity,
  coursesByDepartment, getCampusesForCourse,
  onStageChange, onFieldUpdate,
}: LeadInfoCardProps) {
  const initials = lead.name
    .split(" ")
    .map((n: string) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const filteredCampuses = getCampusesForCourse?.(lead.course_id) || [];

  return (
    <Card className="border-border/60 overflow-hidden">
      <CardContent className="p-0">
        {/* Avatar + Name */}
        <div className="flex items-center gap-4 p-5 pb-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-lg font-bold text-primary-foreground shrink-0">
            {initials}
          </div>
          <div className="min-w-0">
            <EditableText field="name" label="Name" value={lead.name} onSave={onFieldUpdate} className="text-lg font-bold text-foreground" />
            <EditableText field="phone" label="Phone" value={lead.phone} onSave={onFieldUpdate} className="text-sm text-muted-foreground" />
          </div>
        </div>

        {/* Current Stage */}
        <div className="px-5 pb-4">
          <label className="block text-[11px] font-medium text-muted-foreground mb-1.5">Current Stage</label>
          <select
            value={lead.stage}
            onChange={(e) => onStageChange(e.target.value)}
            className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20"
          >
            {Object.entries(STAGE_LABELS).map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
        </div>

        {/* Info rows */}
        <div className="border-t border-border divide-y divide-border">
          {/* Course — grouped dropdown */}
          <EditableSelectRow
            icon={<GraduationCap className="h-4 w-4" />}
            iconColor="bg-violet-100 text-violet-600 dark:bg-violet-900/30 dark:text-violet-400"
            label="Course"
            value={lead.course_id}
            displayValue={courseName || "Not set"}
            groups={coursesByDepartment}
            field="course_id"
            fieldLabel="Course"
            onSave={(field, value, label) => {
              onFieldUpdate?.(field, value, label);
              if (value && getCampusesForCourse) {
                const campuses = getCampusesForCourse(value);
                if (campuses.length === 1 && campuses[0].id !== lead.campus_id) {
                  onFieldUpdate?.("campus_id", campuses[0].id, "Campus");
                }
              }
            }}
          />

          {/* Campus — filtered by course */}
          <EditableSelectRow
            icon={<Building2 className="h-4 w-4" />}
            iconColor="bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400"
            label="Campus"
            value={lead.campus_id}
            displayValue={campusName || "Not set"}
            options={filteredCampuses.map(c => ({ value: c.id, label: c.name }))}
            field="campus_id"
            fieldLabel="Campus"
            onSave={onFieldUpdate}
            disabled={filteredCampuses.length <= 1}
          />

          {/* City — auto-derived from campus */}
          {campusCity && (
            <InfoRow
              icon={<MapPin className="h-4 w-4" />}
              iconColor="bg-rose-100 text-rose-600 dark:bg-rose-900/30 dark:text-rose-400"
              label="City"
              value={campusCity}
            />
          )}

          {/* Email — inline text edit */}
          <EditableInfoRow
            icon={<Mail className="h-4 w-4" />}
            iconColor="bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400"
            label="Email" field="email" fieldLabel="Email"
            value={lead.email || ""} onSave={onFieldUpdate}
          />

          <InfoRow
            icon={<Globe className="h-4 w-4" />}
            iconColor="bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400"
            label="Source" value={lead.source?.replace(/_/g, " ")} className="capitalize"
          />

          {counsellorName && (
            <InfoRow
              icon={<UserCheck className="h-4 w-4" />}
              iconColor="bg-pink-100 text-pink-600 dark:bg-pink-900/30 dark:text-pink-400"
              label="Assigned to" value={counsellorName}
            />
          )}

          {/* Guardian — inline text edit */}
          <EditableGuardianRow lead={lead} onSave={onFieldUpdate} />

          {(lead.pre_admission_no || lead.admission_no) && (
            <div className="px-5 py-3 flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 shrink-0">
                <Sparkles className="h-4 w-4 text-primary" />
              </div>
              <div className="flex gap-2 flex-wrap">
                {lead.pre_admission_no && <Badge variant="outline" className="text-xs text-primary border-primary/30">PAN: {lead.pre_admission_no}</Badge>}
                {lead.admission_no && <Badge className="text-xs bg-primary text-primary-foreground">AN: {lead.admission_no}</Badge>}
              </div>
            </div>
          )}
        </div>

        {lead.interview_score != null && (
          <div className="px-5 py-3 border-t border-border flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Interest Level</span>
            <Badge
              className={`text-xs font-semibold border-0 ${
                lead.interview_score >= 7 ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                : lead.interview_score >= 4 ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400"
                : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
              }`}
            >
              {lead.interview_score >= 7 ? "High" : lead.interview_score >= 4 ? "Medium" : "Low"}
            </Badge>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Inline editable text (click to edit) ────────────────────

function validateField(field: string, value: string): string | null {
  if (field === "email" && value) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(value)) return "Invalid email address";
  }
  if ((field === "phone" || field === "guardian_phone") && value) {
    const phoneRegex = /^[+]?[\d\s\-()]{7,20}$/;
    if (!phoneRegex.test(value)) return "Invalid phone number";
  }
  if (field === "name" && !value.trim()) return "Name cannot be empty";
  return null;
}

function EditableText({ field, label, value, onSave, className }: {
  field: string; label: string; value: string; onSave?: (field: string, value: string | null, label: string) => void; className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    const trimmed = draft.trim();
    const validationError = validateField(field, trimmed);
    if (validationError) { setError(validationError); return; }
    if (trimmed && trimmed !== value) onSave?.(field, trimmed, label);
    setError(null);
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="space-y-1">
        <div className="flex items-center gap-1.5">
          <input value={draft} onChange={e => { setDraft(e.target.value); setError(null); }} onKeyDown={e => e.key === "Enter" && save()}
            className={`rounded-lg border ${error ? "border-destructive" : "border-input"} bg-background px-2 py-0.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 min-w-0 flex-1`}
            autoFocus maxLength={200} />
          <button onClick={save} className="text-primary hover:text-primary/80 p-0.5"><Check className="h-3.5 w-3.5" /></button>
          <button onClick={() => { setDraft(value); setError(null); setEditing(false); }} className="text-muted-foreground hover:text-foreground p-0.5"><X className="h-3.5 w-3.5" /></button>
        </div>
        {error && <p className="text-[11px] text-destructive">{error}</p>}
      </div>
    );
  }

  return (
    <div className="group flex items-center gap-1.5 cursor-pointer" onClick={() => { setDraft(value); setEditing(true); }}>
      <span className={className}>{value || "—"}</span>
      <Pencil className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
    </div>
  );
}

// ── Editable info row (text input) ──────────────────────────

function EditableInfoRow({ icon, iconColor, label, field, fieldLabel, value, onSave }: {
  icon: React.ReactNode; iconColor: string; label: string; field: string; fieldLabel: string;
  value: string; onSave?: (field: string, value: string | null, label: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    const trimmed = draft.trim();
    const validationError = validateField(field, trimmed);
    if (validationError) { setError(validationError); return; }
    if (trimmed !== value) onSave?.(field, trimmed || null, fieldLabel);
    setError(null);
    setEditing(false);
  };

  return (
    <div className="px-5 py-3 flex items-start gap-3">
      <div className={`flex h-8 w-8 items-center justify-center rounded-lg shrink-0 mt-0.5 ${iconColor}`}>
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] text-muted-foreground">{label}</p>
        {editing ? (
          <div className="space-y-1 mt-0.5">
            <div className="flex items-center gap-1.5">
              <input value={draft} onChange={e => { setDraft(e.target.value); setError(null); }} onKeyDown={e => e.key === "Enter" && save()}
                className={`rounded-lg border ${error ? "border-destructive" : "border-input"} bg-background px-2 py-0.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 min-w-0 flex-1`}
                autoFocus maxLength={255} />
              <button onClick={save} className="text-primary p-0.5"><Check className="h-3.5 w-3.5" /></button>
              <button onClick={() => { setDraft(value); setError(null); setEditing(false); }} className="text-muted-foreground p-0.5"><X className="h-3.5 w-3.5" /></button>
            </div>
            {error && <p className="text-[11px] text-destructive">{error}</p>}
          </div>
        ) : (
          <div className="group flex items-center gap-1.5 cursor-pointer mt-0.5" onClick={() => { setDraft(value); setEditing(true); }}>
            <p className="text-sm font-medium text-foreground">{value || "Not set"}</p>
            <Pencil className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Editable select row (dropdown with optional groups) ─────

function EditableSelectRow({ icon, iconColor, label, value, displayValue, options, groups, field, fieldLabel, onSave, disabled }: {
  icon: React.ReactNode; iconColor: string; label: string; value: string | null; displayValue: string;
  options?: { value: string; label: string }[];
  groups?: { department: string; courses: { id: string; name: string }[] }[];
  field: string; fieldLabel: string;
  onSave?: (field: string, value: string | null, label: string) => void;
  disabled?: boolean;
}) {
  const [editing, setEditing] = useState(false);

  return (
    <div className="px-5 py-3 flex items-start gap-3">
      <div className={`flex h-8 w-8 items-center justify-center rounded-lg shrink-0 mt-0.5 ${iconColor}`}>
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] text-muted-foreground">{label}</p>
        {editing ? (
          <select
            defaultValue={value || ""}
            onChange={e => {
              const v = e.target.value || null;
              if (v !== value) onSave?.(field, v, fieldLabel);
              setEditing(false);
            }}
            onBlur={() => setEditing(false)}
            className="w-full rounded-lg border border-input bg-background px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 mt-0.5"
            autoFocus
          >
            <option value="">Not set</option>
            {groups
              ? groups.map(g => (
                  <optgroup key={g.department} label={g.department}>
                    {g.courses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </optgroup>
                ))
              : options?.map(o => <option key={o.value} value={o.value}>{o.label}</option>)
            }
          </select>
        ) : (
          <div
            className={`group flex items-center gap-1.5 mt-0.5 ${disabled ? "cursor-default" : "cursor-pointer"}`}
            onClick={() => !disabled && setEditing(true)}
          >
            <p className="text-sm font-medium text-foreground">{displayValue}</p>
            {!disabled && <Pencil className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Guardian row (dual fields) ──────────────────────────────

function EditableGuardianRow({ lead, onSave }: { lead: any; onSave?: (field: string, value: string | null, label: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(lead.guardian_name || "");
  const [phone, setPhone] = useState(lead.guardian_phone || "");
  const [phoneError, setPhoneError] = useState<string | null>(null);

  const save = () => {
    const trimmedName = name.trim();
    const trimmedPhone = phone.trim();
    const phoneValidation = validateField("guardian_phone", trimmedPhone);
    if (phoneValidation) { setPhoneError(phoneValidation); return; }
    if (trimmedName !== (lead.guardian_name || "")) onSave?.("guardian_name", trimmedName || null, "Guardian Name");
    if (trimmedPhone !== (lead.guardian_phone || "")) onSave?.("guardian_phone", trimmedPhone || null, "Guardian Phone");
    setPhoneError(null);
    setEditing(false);
  };

  return (
    <div className="px-5 py-3 flex items-start gap-3">
      <div className="flex h-8 w-8 items-center justify-center rounded-lg shrink-0 mt-0.5 bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400">
        <User className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] text-muted-foreground">Guardian</p>
        {editing ? (
          <div className="space-y-1.5 mt-0.5">
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Guardian name"
              className="w-full rounded-lg border border-input bg-background px-2 py-0.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20"
              autoFocus maxLength={100} />
            <input value={phone} onChange={e => { setPhone(e.target.value); setPhoneError(null); }} placeholder="Guardian phone"
              className={`w-full rounded-lg border ${phoneError ? "border-destructive" : "border-input"} bg-background px-2 py-0.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20`}
              maxLength={20} />
            {phoneError && <p className="text-[11px] text-destructive">{phoneError}</p>}
            <div className="flex items-center gap-1.5">
              <button onClick={save} className="text-primary p-0.5"><Check className="h-3.5 w-3.5" /></button>
              <button onClick={() => { setName(lead.guardian_name || ""); setPhone(lead.guardian_phone || ""); setPhoneError(null); setEditing(false); }}
                className="text-muted-foreground p-0.5"><X className="h-3.5 w-3.5" /></button>
            </div>
          </div>
        ) : (
          <div className="group flex items-center gap-1.5 cursor-pointer mt-0.5" onClick={() => { setName(lead.guardian_name || ""); setPhone(lead.guardian_phone || ""); setEditing(true); }}>
            <p className="text-sm font-medium text-foreground">
              {lead.guardian_name ? `${lead.guardian_name}${lead.guardian_phone ? ` · ${lead.guardian_phone}` : ""}` : "Not set"}
            </p>
            <Pencil className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Static info row ─────────────────────────────────────────

function InfoRow({ icon, iconColor, label, value, className }: { icon: React.ReactNode; iconColor: string; label: string; value: string; className?: string }) {
  return (
    <div className="px-5 py-3 flex items-start gap-3">
      <div className={`flex h-8 w-8 items-center justify-center rounded-lg shrink-0 mt-0.5 ${iconColor}`}>
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-[11px] text-muted-foreground">{label}</p>
        <p className={`text-sm font-medium text-foreground mt-0.5 ${className || ""}`}>{value}</p>
      </div>
    </div>
  );
}
