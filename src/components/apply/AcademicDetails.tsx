import { useState, useEffect, useMemo } from "react";
import { ArrowRight, ArrowLeft, Loader2, AlertTriangle, Info, CheckCircle, XCircle, Plus, Trash2, BookOpen, GraduationCap, BookText, ClipboardCheck } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { SelectField, TextField } from "@/components/ui/state-fields";
import { ApplicationData } from "./types";
import {
  validateAcademicEligibility,
  validateAcademicYears,
  validatePerCourseEligibility,
  fetchEligibilityRules,
  EligibilityRule,
  CourseEligibilityResult,
  ValidationResult,
} from "./eligibilityRules";
import { SubjectTagInput } from "./SubjectTagInput";
import { BOARDS_LIST, UNIVERSITIES_LIST, isPredefinedBoard, isPredefinedUniversity } from "./boardsAndUniversities";

const CLASS_12_SUBJECTS = [
  "Physics", "Chemistry", "Biology", "Mathematics", "English", "Hindi",
  "Economics", "Accountancy", "Business Studies", "History", "Political Science",
  "Geography", "Computer Science", "Sociology", "Psychology", "Physical Education", "Home Science",
  "Sanskrit", "Urdu", "French", "German", "Spanish", "Japanese",
  "Informatics Practices", "Biotechnology", "Engineering Graphics",
  "Entrepreneurship", "Legal Studies", "Media Studies", "Fine Arts",
  "Music", "Painting", "Fashion Studies", "Agriculture",
  "Electronics", "Electrical Technology", "Mechanical Technology",
  "Environmental Science", "Philosophy", "Telugu", "Tamil", "Kannada",
  "Malayalam", "Bengali", "Marathi", "Gujarati", "Punjabi", "Odia", "Assamese",
];

const GRADUATION_DEGREES = [
  "B.A.", "B.Sc.", "B.Com.", "BBA", "B.Tech.", "B.E.", "BCA", "BPT",
  "B.Sc. Nursing", "B.Pharm.", "LLB", "B.Ed.", "MBBS", "BMRIT", "B.Sc. Radiology",
];

interface Props {
  data: ApplicationData;
  onChange: (data: Partial<ApplicationData>) => void;
  onNext: () => void;
  onBack?: () => void;
  saving: boolean;
  readOnly?: boolean;
}

const SESSION_YEAR = 2026; // TODO: derive from active session

const resultStatusOptions = [
  { value: "declared", label: "Declared" },
  { value: "not_declared", label: "Not Declared (Result Pending)" },
];

const entranceStatusOptions = [
  { value: "yet_to_appear", label: "Yet to Appear" },
  { value: "not_declared", label: "Result Not Declared" },
  { value: "declared", label: "Result Declared" },
];

const cahetStatusOptions = [
  { value: "registered", label: "Registered on ABVMU CAHET 2026" },
  { value: "yet_to_appear", label: "Not registered yet" },
];

const updeledStatusOptions = [
  { value: "registered", label: "Registered for UPDELED 2026" },
  { value: "yet_to_appear", label: "Not registered yet" },
];

const previousBoardOptions = [
  { value: "CBSE", label: "CBSE" },
  { value: "ICSE", label: "ICSE / ISC" },
  { value: "State Board", label: "State Board" },
  { value: "IB", label: "IB" },
  { value: "Cambridge", label: "Cambridge (IGCSE)" },
  { value: "Other", label: "Other" },
];

const tcAvailableOptions = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No, will submit later" },
];

interface EntranceExam {
  exam_name: string;
  status: 'yet_to_appear' | 'not_declared' | 'declared' | 'registered';
  score?: string;
  expected_date?: string;
  registration_no?: string;
  registered_name?: string;
  is_custom?: boolean;
}

type AcademicEntryValue = string | string[] | Record<string, string> | undefined;
type AcademicEntry = Record<string, AcademicEntryValue>;
type AcademicFormData = Record<string, AcademicEntry | AcademicEntry[] | EntranceExam[] | undefined> & {
  previous_school?: AcademicEntry;
  class_10?: AcademicEntry;
  class_12?: AcademicEntry;
  graduation?: AcademicEntry;
  additional_qualifications?: AcademicEntry[];
  entrance_exams?: EntranceExam[];
};

/** Generate year options descending from maxYear (or current year) down to max(dobYear, minYear) */
function getYearOptions(dobYear?: number, maxYear?: number, minYear?: number): number[] {
  const dobFloor = Math.max(1926, dobYear || 1926);
  const start = minYear !== undefined ? Math.max(dobFloor, minYear) : dobFloor;
  const end = maxYear !== undefined ? maxYear : new Date().getFullYear();
  const years: number[] = [];
  for (let y = end; y >= start; y--) years.push(y);
  return years;
}

/* ── Per-Course Eligibility Card ─────────────────────────── */
function EligibilityCards({ results, isSchool }: { results: CourseEligibilityResult[]; isSchool?: boolean }) {
  if (!results.length) return null;

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-foreground">Course Eligibility Status</h3>
      {results.map(cr => {
        const hasAgeError = cr.dobResult?.type === 'error';
        return (
          <Card key={cr.courseId} className={`border shadow-none ${cr.hasErrors ? 'border-destructive/30 bg-destructive/5' : 'border-primary/30 bg-primary/5'}`}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  {cr.hasErrors
                    ? <XCircle className="h-4 w-4 text-destructive shrink-0" />
                    : <CheckCircle className="h-4 w-4 text-primary shrink-0" />
                  }
                  <span className="text-sm font-semibold text-foreground">
                    {cr.courseName}
                  </span>
                </div>
                {isSchool && (
                  <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold ${hasAgeError ? 'bg-destructive/10 text-destructive border border-destructive/20' : 'bg-primary/10 text-primary border border-primary/20'}`}>
                    {hasAgeError ? (
                      <>
                        <XCircle className="h-3.5 w-3.5" /> Not eligible for selected class
                      </>
                    ) : (
                      <>
                        <CheckCircle className="h-3.5 w-3.5" /> Eligible for selected class
                      </>
                    )}
                  </div>
                )}
              </div>
              
              <div className="flex flex-wrap gap-1.5 ml-6">
                {!isSchool && (
                  cr.dobResult ? (
                    <StatusBadge type={cr.dobResult.type} label={cr.dobResult.message} />
                  ) : (
                    <StatusBadge type="pass" label="Age OK" />
                  )
                )}
                {cr.results.filter(r => r.type !== 'info').map((r, i) => (
                  <StatusBadge key={i} type={r.type} label={r.message} />
                ))}
                {cr.yearResults.map((r, i) => (
                  <StatusBadge key={`yr-${i}`} type={r.type} label={r.message} />
                ))}
                {!cr.hasErrors && cr.results.filter(r => r.type !== 'info').length === 0 && cr.yearResults.length === 0 && !isSchool && (
                  <StatusBadge type="pass" label="All criteria met" />
                )}
              </div>
              
              {/* Show the detailed age error message if it exists */}
              {isSchool && cr.dobResult && (
                <div className="ml-6 mt-2 p-2 rounded-lg bg-destructive/10 border border-destructive/20 text-xs text-destructive">
                  <p className="font-semibold mb-1">Eligibility Issue:</p>
                  {cr.dobResult.message}
                </div>
              )}

              {cr.results.filter(r => r.type === 'info').map((r, i) => (
                <div key={`info-${i}`} className="ml-6 mt-2 flex items-start gap-1.5 text-muted-foreground">
                  <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  <span className="text-xs">{r.message}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function StatusBadge({ type, label }: { type: 'error' | 'warning' | 'info' | 'pass'; label: string }) {
  const cls = type === 'error'
    ? 'bg-destructive/10 text-destructive border-destructive/20'
    : type === 'warning'
    ? 'bg-warning/10 text-warning border-warning/20'
    : type === 'pass'
    ? 'bg-primary/10 text-primary border-primary/20'
    : 'bg-muted text-muted-foreground border-border';
  const icon = type === 'error' ? '✗' : type === 'warning' ? '⚠' : type === 'pass' ? '✓' : 'ℹ';

  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium border ${cls}`}>
      {icon} {label.length > 60 ? label.slice(0, 57) + '…' : label}
    </span>
  );
}

/* ── Year Select Dropdown ─────────────────────────── */
function YearSelect({ value, onChange, dobYear, maxYear, minYear, yearError, invalid }: {
  value: string;
  onChange: (v: string) => void;
  dobYear?: number;
  maxYear?: number;
  minYear?: number;
  yearError?: string;
  invalid?: boolean;
}) {
  const years = useMemo(() => getYearOptions(dobYear, maxYear, minYear), [dobYear, maxYear, minYear]);
  return (
    <div className="space-y-1.5">
      <SelectField
        label="Year"
        value={value || ''}
        onValueChange={onChange}
        placeholder="Select year"
        options={years.map(y => ({ value: y.toString(), label: y.toString() }))}
        error={invalid && !yearError ? 'Year is required' : undefined}
      />
      {yearError && (
        <div className="mt-1.5 flex items-start gap-1.5 text-destructive">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span className="text-xs">{yearError}</span>
        </div>
      )}
    </div>
  );
}

/* ── Academic Block ─────────────────────────── */
function AcademicBlock({
  title,
  prefix,
  academic,
  onChange,
  showResultPending,
  showSubjects,
  showDegreeSelector,
  validationErrors,
  yearError,
  maxYear,
  minYear,
  removable,
  onRemove,
  dobYear,
  showErrors,
  invalidFields,
}: {
  title: string;
  prefix: string;
  academic: AcademicFormData;
  onChange: (v: AcademicFormData) => void;
  showResultPending?: boolean;
  showSubjects?: boolean;
  showDegreeSelector?: boolean;
  validationErrors?: ValidationResult[];
  yearError?: string;
  maxYear?: number;
  minYear?: number;
  removable?: boolean;
  onRemove?: () => void;
  dobYear?: number;
  showErrors?: boolean;
  invalidFields?: Set<string>;
}) {
  const data = (academic[prefix] || {}) as AcademicEntry;
  const update = (field: string, val: string) => {
    const newData = { ...academic, [prefix]: { ...data, [field]: val } };
    onChange(newData);
  };
  const isPending = data.result_status === 'not_declared';
  const isGradBlock = prefix.startsWith('graduation') || prefix.startsWith('additional_');

  const fieldError = validationErrors?.find(e => e.field === prefix || e.field === 'class_12');
  const invalid = (field: string) => !!showErrors && !!invalidFields?.has(field);
  const requiredError = (field: string, label: string) => invalid(field) ? `${label} is required` : undefined;

  // Board change — handles explicit "Other (not in list)" selection
  const handleBoardChange = (vals: string[]) => {
    const board = vals[vals.length - 1] || '';
    if (board === 'Other (not in list)') {
      onChange({ ...academic, [prefix]: { ...data, board: 'Other', board_other: '' } });
    } else {
      onChange({ ...academic, [prefix]: { ...data, board, board_other: undefined } });
    }
  };
  // University change — handles explicit "Other (not in list)" selection
  const handleUniversityChange = (vals: string[]) => {
    const uni = vals[vals.length - 1] || '';
    if (uni === 'Other (not in list)') {
      onChange({ ...academic, [prefix]: { ...data, university: 'Other', university_other: '' } });
    } else {
      onChange({ ...academic, [prefix]: { ...data, university: uni, university_other: undefined } });
    }
  };

  // Visual variant per section so Class 10 / Class 12 / Graduation are clearly
  // distinct on the page.
  const isClass10 = prefix === 'class_10';
  const isClass12 = prefix === 'class_12';
  const variant = isGradBlock
    ? { Icon: GraduationCap, accent: 'border-primary/35',  iconColor: 'text-primary',  bg: 'bg-primary/5/60'  }
    : isClass12
    ? { Icon: BookText,      accent: 'border-success/35', iconColor: 'text-success', bg: 'bg-success/5/60' }
    : isClass10
    ? { Icon: BookOpen,      accent: 'border-info/35',    iconColor: 'text-info-foreground',    bg: 'bg-info/5/60'    }
    : { Icon: BookOpen,      accent: 'border-border',      iconColor: 'text-muted-foreground', bg: 'bg-muted/30' };
  const { Icon, accent, iconColor, bg } = variant;

  return (
    <section className={`rounded-2xl border border-border bg-card overflow-hidden border-l-4 ${accent}`}>
      <header className={`px-4 py-3 ${bg} flex items-center justify-between`}>
        <div className="flex items-center gap-2.5">
          <Icon className={`h-5 w-5 ${iconColor}`} />
          <h3 className="text-base font-semibold text-foreground">{title}</h3>
        </div>
        {removable && onRemove && (
          <Button variant="ghost" size="sm" onClick={onRemove} className="text-destructive hover:text-destructive h-7 px-2">
            <Trash2 className="h-3.5 w-3.5 mr-1" /> Remove
          </Button>
        )}
      </header>
      <div className="p-4 space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {isGradBlock ? (
          <>
            {showDegreeSelector ? (
              <div>
                <SubjectTagInput
                  label="Degree"
                  options={GRADUATION_DEGREES}
                  selected={data.degree ? [data.degree] : []}
                  onChange={(vals) => update('degree', vals[vals.length - 1] || '')}
                  placeholder="Select or type degree…"
                  allowCustom
                  invalid={invalid('degree')}
                />
              </div>
            ) : (
              <TextField
                label="Degree"
                value={data.degree || ''}
                onValueChange={v => update('degree', v)}
                error={requiredError('degree', 'Degree')}
              />
            )}
            <div>
              <SubjectTagInput
                label="University"
                options={[...UNIVERSITIES_LIST, 'Other (not in list)']}
                selected={data.university === 'Other' ? ['Other (not in list)'] : data.university ? [data.university] : []}
                onChange={handleUniversityChange}
                placeholder="Search university…"
                allowCustom={false}
                invalid={invalid('university')}
              />
              {data.university === 'Other' && (
                <div className="mt-2">
                  <TextField
                    label="Specify university name"
                    required
                    value={data.university_other || ''}
                    onValueChange={v => onChange({ ...academic, [prefix]: { ...data, university_other: v } })}
                    placeholder="Enter full university name"
                    error={requiredError('university_other', 'University name')}
                  />
                </div>
              )}
            </div>
            <TextField
              label="College"
              value={data.college || ''}
              onValueChange={v => update('college', v)}
            />
          </>
        ) : (
          <>
            <div>
              <SubjectTagInput
                label="Board"
                options={[...BOARDS_LIST, 'Other (not in list)']}
                selected={data.board === 'Other' ? ['Other (not in list)'] : data.board ? [data.board] : []}
                onChange={handleBoardChange}
                placeholder="Search board…"
                allowCustom={false}
                invalid={invalid('board')}
              />
              {data.board === 'Other' && (
                <div className="mt-2">
                  <TextField
                    label="Specify board name"
                    required
                    value={data.board_other || ''}
                    onValueChange={v => onChange({ ...academic, [prefix]: { ...data, board_other: v } })}
                    placeholder="Enter full board name"
                    error={requiredError('board_other', 'Board name')}
                  />
                </div>
              )}
            </div>
            <TextField
              label="School"
              value={data.school || ''}
              onValueChange={v => update('school', v)}
            />
          </>
        )}
        <YearSelect
          value={data.year || ''}
          onChange={v => update('year', v)}
          dobYear={dobYear}
          maxYear={maxYear}
          minYear={minYear}
          yearError={yearError}
          invalid={invalid('year')}
        />
        <TextField
          label="Marks / Percentage / CGPA"
          value={data.marks || ''}
          onValueChange={v => update('marks', v)}
          placeholder="e.g. 85% or 8.5"
          error={
            requiredError('marks', 'Marks') ||
            (showErrors && fieldError?.type === 'error' && fieldError.field !== 'class_12' ? fieldError.message : undefined)
          }
        />
        {showSubjects && (prefix === 'class_12' || prefix.startsWith('class_12')) && (
          <div className="sm:col-span-2">
            <SubjectTagInput
              label="Subjects / Stream"
              options={CLASS_12_SUBJECTS}
              selected={
                data.subjects
                  ? typeof data.subjects === 'string'
                    ? data.subjects.split(',').map((s: string) => s.trim()).filter(Boolean)
                    : data.subjects
                  : []
              }
              onChange={(vals) => update('subjects', vals.join(', '))}
              placeholder="Select your 12th subjects…"
              allowCustom
              invalid={invalid('subjects') || !!(showErrors && validationErrors?.some(e => e.field === 'class_12' && e.type === 'error'))}
            />
            {validationErrors?.filter(e => e.field === 'class_12' && e.type === 'error').map((e, i) => (
              <div key={i} className="mt-1.5 flex items-start gap-1.5 text-destructive">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <span className="text-xs">{e.message}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {showResultPending && (
        <div className="space-y-3">
          <SelectField
            label="Result Status"
            value={data.result_status || 'declared'}
            onValueChange={v => update('result_status', v)}
            options={resultStatusOptions}
            allowEmpty={false}
          />

          {isPending && (
            <div className="p-3 rounded-xl bg-warning/10 border border-warning/20 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
              <div className="space-y-2 flex-1">
                <p className="text-xs text-foreground font-medium">Result Awaited — you can still apply</p>
                {prefix === 'class_12' && (
                  <>
                    {showSubjects && (
                      <SubjectTagInput
                        label="Subjects"
                        options={CLASS_12_SUBJECTS}
                        selected={
                          data.subjects
                            ? typeof data.subjects === 'string'
                              ? data.subjects.split(',').map((s: string) => s.trim()).filter(Boolean)
                              : data.subjects
                            : []
                        }
                        onChange={(vals) => update('subjects', vals.join(', '))}
                        placeholder="Select your 12th subjects…"
                        allowCustom
                      />
                    )}
                    <TextField
                      label="Expected Result Month"
                      value={data.expected_month || ''}
                      onValueChange={v => update('expected_month', v)}
                      placeholder="e.g. June 2026"
                    />
                  </>
                )}
                {(prefix === 'graduation' || prefix.startsWith('additional_')) && (
                  <>
                    <TextField
                      label="CGPA till last declared semester"
                      value={data.cgpa_till_sem || ''}
                      onValueChange={v => update('cgpa_till_sem', v)}
                    />
                    <TextField
                      label="Semesters completed"
                      value={data.semesters_completed || ''}
                      onValueChange={v => update('semesters_completed', v)}
                    />
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      )}
      </div>
    </section>
  );
}

/* ── Entrance Exam Section ─────────────────────────── */
function isCahetExamName(name: string): boolean {
  return /cahet/i.test(name);
}

function isUpdeledExamName(name: string): boolean {
  return /up\s*d\.?\s*el\.?\s*ed|updeled|d\.?\s*el\.?\s*ed counselling|elementary education counselling/i.test(name);
}

function EntranceExamSection({
  exams,
  onChange,
  courseExamNames,
  recommendedExamNames = [],
}: {
  exams: EntranceExam[];
  onChange: (exams: EntranceExam[]) => void;
  courseExamNames: string[];
  /** Optional/preferred exams shown as quick-add chips above the list. */
  recommendedExamNames?: string[];
}) {
  // Reconcile auto-populated exams with current course requirements:
  // - drop non-custom entries that aren't required by any currently-selected course
  //   (e.g. user picked B.Sc Nursing earlier, switched to MBA → CNET should go away)
  // - add any new required exams that aren't already in the list
  // - preserve user-added custom exams (is_custom === true) untouched
  useEffect(() => {
    const currentNames = new Set(courseExamNames);
    const customExams = exams.filter(e => e.is_custom);
    const keptAuto = exams
      .filter(e => !e.is_custom && currentNames.has(e.exam_name));
    const existingAutoNames = new Set(keptAuto.map(e => e.exam_name));
    const newAuto = courseExamNames
      .filter(n => !existingAutoNames.has(n))
      .map(name => ({
        exam_name: name,
        status: 'yet_to_appear' as const,
      }));
    const reconciled = [...keptAuto, ...newAuto, ...customExams];
    // Avoid useless re-renders if nothing changed
    if (JSON.stringify(reconciled) !== JSON.stringify(exams)) {
      onChange(reconciled);
    }
  }, [courseExamNames.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps

  const updateExam = (idx: number, field: string, val: string) => {
    const updated = [...exams];
    updated[idx] = { ...updated[idx], [field]: val };
    onChange(updated);
  };

  const addCustomExam = () => {
    onChange([...exams, { exam_name: '', status: 'yet_to_appear', is_custom: true }]);
  };

  const removeExam = (idx: number) => {
    onChange(exams.filter((_, i) => i !== idx));
  };

  // Recommended exams the user hasn't already added (chips offer quick-add)
  const existingExamNames = new Set(exams.map(e => e.exam_name));
  const recommendedAvailable = recommendedExamNames.filter(n => !existingExamNames.has(n));

  const addRecommended = (name: string) => {
    // Mark as is_custom so the reconciliation effect preserves it (it's NOT
    // auto-derived from a required rule) and so the user can remove it.
    onChange([...exams, { exam_name: name, status: 'yet_to_appear', is_custom: true }]);
  };

  return (
    <section className="rounded-2xl border border-border bg-card overflow-hidden border-l-4 border-warning/35">
      <header className="px-4 py-3 bg-warning/5/60 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <ClipboardCheck className="h-5 w-5 text-warning-foreground" />
          <h3 className="text-base font-semibold text-foreground">Entrance Exams</h3>
        </div>
      </header>
      <div className="p-4 space-y-3">
      {recommendedAvailable.length > 0 && (
        <div className="rounded-xl bg-warning/5/40 border border-warning/20/60 p-3">
          <p className="text-xs font-medium text-warning-foreground mb-2">
            Recommended for your selected courses (optional — add if you've taken any):
          </p>
          <div className="flex flex-wrap gap-2">
            {recommendedAvailable.map(name => (
              <button
                key={name}
                type="button"
                onClick={() => addRecommended(name)}
                className="inline-flex items-center gap-1 rounded-full border border-warning/30 bg-white px-3 py-1 text-[11px] font-medium text-warning-foreground hover:bg-warning/10 transition-colors"
              >
                <Plus className="h-3 w-3" /> {name}
              </button>
            ))}
          </div>
        </div>
      )}
      {exams.length === 0 && recommendedAvailable.length === 0 && courseExamNames.length === 0 && (
        <p className="text-xs text-muted-foreground">
          No entrance exam is required for your selected courses. You can still add any exam you have taken below.
        </p>
      )}
      {exams.map((ex, idx) => (
        <Card key={idx} className="border-border/60 shadow-none">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              {ex.is_custom ? (
                <TextField
                  value={ex.exam_name}
                  onValueChange={v => updateExam(idx, 'exam_name', v)}
                  placeholder="Exam name"
                  containerClassName="max-w-xs flex-1"
                  aria-label="Exam name"
                />
              ) : isCahetExamName(ex.exam_name) ? (
                <div>
                  <h4 className="text-sm font-semibold text-foreground">CAHET Registration Details</h4>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Required for BPT/BMRIT admission through ABVMU Lucknow counselling.
                  </p>
                </div>
              ) : isUpdeledExamName(ex.exam_name) ? (
                <div>
                  <h4 className="text-sm font-semibold text-foreground">UPDELED Registration Details</h4>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Required for D.El.Ed admission through UP D.El.Ed counselling.
                  </p>
                </div>
              ) : (
                <h4 className="text-sm font-medium text-foreground">{ex.exam_name}</h4>
              )}
              {ex.is_custom && (
                <Button variant="ghost" size="sm" onClick={() => removeExam(idx)} className="text-destructive h-7 px-2">
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
            {isCahetExamName(ex.exam_name) ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <SelectField
                  label="CAHET Registration Status"
                  value={ex.status === 'registered' ? 'registered' : 'yet_to_appear'}
                  onValueChange={v => updateExam(idx, 'status', v)}
                  options={cahetStatusOptions}
                  allowEmpty={false}
                />
                <TextField
                  label="CAHET Registration No."
                  value={ex.registration_no || ''}
                  onValueChange={v => updateExam(idx, 'registration_no', v)}
                  placeholder="e.g. CAHET-2026-12345"
                />
                <TextField
                  label="Name on CAHET Form"
                  value={ex.registered_name || ''}
                  onValueChange={v => updateExam(idx, 'registered_name', v)}
                  placeholder="As entered on ABVMU CAHET"
                />
              </div>
            ) : isUpdeledExamName(ex.exam_name) ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <SelectField
                  label="UPDELED Registration Status"
                  value={ex.status === 'registered' ? 'registered' : 'yet_to_appear'}
                  onValueChange={v => updateExam(idx, 'status', v)}
                  options={updeledStatusOptions}
                  allowEmpty={false}
                />
                <TextField
                  label="UPDELED Registration No."
                  value={ex.registration_no || ''}
                  onValueChange={v => updateExam(idx, 'registration_no', v)}
                  placeholder="e.g. UPDELED-2026-12345"
                />
                <TextField
                  label="Name on UPDELED Form"
                  value={ex.registered_name || ''}
                  onValueChange={v => updateExam(idx, 'registered_name', v)}
                  placeholder="As entered on UPDELED registration"
                />
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <SelectField
                label="Status"
                value={ex.status}
                onValueChange={v => updateExam(idx, 'status', v)}
                options={entranceStatusOptions}
                allowEmpty={false}
              />
              {ex.status === 'declared' && (
                <TextField
                  label="Score / Rank"
                  value={ex.score || ''}
                  onValueChange={v => updateExam(idx, 'score', v)}
                  placeholder="e.g. 120 marks or Rank 5000"
                />
              )}
              {ex.status === 'not_declared' && (
                <TextField
                  label="Expected Result Date"
                  value={ex.expected_date || ''}
                  onValueChange={v => updateExam(idx, 'expected_date', v)}
                  placeholder="e.g. July 2026"
                />
              )}
              </div>
            )}
          </CardContent>
        </Card>
      ))}
      <Button variant="outline" size="sm" onClick={addCustomExam} className="gap-2 text-xs">
        <Plus className="h-3.5 w-3.5" /> Add Other Exam
      </Button>
      </div>
    </section>
  );
}

/* ── School Academic Block ─────────────────────────── */
function SchoolAcademicBlock({
  academic,
  updateAcademic,
  courseSelections,
}: {
  academic: AcademicFormData;
  updateAcademic: (v: AcademicFormData) => void;
  courseSelections: { course_name: string }[];
}) {
  const courseNames = courseSelections.map(s => s.course_name.toLowerCase()).join(' ');
  const isPreNurseryOrNursery = /pre.?nur|nursery|playgroup/i.test(courseNames)
    && !/lkg|ukg|grade|class\s*[1-9]/i.test(courseNames);
  const isKG = /kg|lkg|ukg|kendergarten/i.test(courseNames) && !/grade|class\s*[1-9]/i.test(courseNames);
  
  const isOptional = isPreNurseryOrNursery || isKG;
  const hideBlock = isPreNurseryOrNursery;

  const prevSchool = academic.previous_school || {};

  const updatePrevSchool = (key: string, value: string) => {
    updateAcademic({ ...academic, previous_school: { ...prevSchool, [key]: value } });
  };

  if (hideBlock) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">Previous school details</p>
        <div className="p-3 rounded-xl bg-primary/5 border border-primary/10 flex items-start gap-2">
          <Info className="h-4 w-4 text-primary shrink-0 mt-0.5" />
          <p className="text-xs text-foreground">
            Since you are applying for Pre-Nursery / Nursery, previous academic details are <strong>not required</strong>.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Previous school details {isOptional ? '(Optional for KG applicants)' : ''}
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <TextField
          label="Previous Class / Grade"
          required={!isOptional}
          value={prevSchool.last_class || ''}
          onValueChange={v => updatePrevSchool('last_class', v)}
          placeholder="e.g. UKG, Class 1"
        />
        <TextField
          label="Previous School Name"
          required={!isOptional}
          value={prevSchool.prev_school_name || ''}
          onValueChange={v => updatePrevSchool('prev_school_name', v)}
          placeholder="School name"
        />
        <SelectField
          label="Board / Curriculum"
          value={prevSchool.board || ''}
          onValueChange={v => updatePrevSchool('board', v)}
          placeholder="Select board..."
          options={previousBoardOptions}
        />
        <TextField
          label="Marks / Grade"
          value={prevSchool.percentage || ''}
          onValueChange={v => updatePrevSchool('percentage', v)}
          placeholder="e.g. 85% or A+"
        />
        <TextField
          label="Academic Year"
          value={prevSchool.academic_year || ''}
          onValueChange={v => updatePrevSchool('academic_year', v)}
          placeholder="e.g. 2025"
        />
        <SelectField
          label="Transfer Certificate Available?"
          value={prevSchool.tc_available || ''}
          onValueChange={v => updatePrevSchool('tc_available', v)}
          placeholder="Select..."
          options={tcAvailableOptions}
        />
      </div>
    </div>
  );
}

/* ── Main Component ─────────────────────────── */
export function AcademicDetails({ data, onChange, onNext, onBack, saving, readOnly }: Props) {
  const cat = data.program_category;
  const isSchool = cat === 'school';
  const needsGraduation = ['postgraduate', 'mba_pgdm', 'professional', 'bed', 'deled'].includes(cat);
  const academic = (data.academic_details || {}) as AcademicFormData;
  const additionalQualifications: AcademicEntry[] = academic.additional_qualifications || [];
  const entranceExams: EntranceExam[] = academic.entrance_exams || [];

  // DOB year for filtering year dropdowns
  const dobYear = data.dob ? new Date(data.dob).getFullYear() : undefined;

  // Fetch DB-driven eligibility rules
  const [courseRules, setCourseRules] = useState<Record<string, EligibilityRule>>({});
  const [rulesLoaded, setRulesLoaded] = useState(false);
  const [showOptionalGrad, setShowOptionalGrad] = useState(false);
  const [showErrors, setShowErrors] = useState(false);

  useEffect(() => {
    const courseIds = (data.course_selections || []).map(s => s.course_id);
    if (courseIds.length) {
      fetchEligibilityRules(courseIds).then(rules => {
        setCourseRules(rules);
        setRulesLoaded(true);
      });
    } else {
      setRulesLoaded(true);
    }
  }, [data.course_selections]);

  // Split a slash- or comma-separated entrance_exam_name string into individual
  // exam names. Used because some rules read "CAT / MAT / UPSEE / GMAT".
  const splitExamNames = (s: string) => s.split(/[,/]/).map(n => n.trim()).filter(Boolean);

  // Deduplicated REQUIRED entrance exam names (auto-populated, not removable).
  const courseExamNames = useMemo(() => {
    const names = new Set<string>();
    Object.values(courseRules).forEach(r => {
      if (r.entranceExamRequired && r.entranceExamName) {
        splitExamNames(r.entranceExamName).forEach(n => names.add(n));
      }
    });
    return Array.from(names);
  }, [courseRules]);

  // Recommended (optional) entrance exams — shown as quick-add chips so the
  // applicant can declare scores if they have one. Excludes any name already
  // in the required set.
  const recommendedExamNames = useMemo(() => {
    const required = new Set(courseExamNames);
    const names = new Set<string>();
    Object.values(courseRules).forEach(r => {
      if (!r.entranceExamRequired && r.entranceExamName) {
        splitExamNames(r.entranceExamName).forEach(n => { if (!required.has(n)) names.add(n); });
      }
    });
    return Array.from(names);
  }, [courseRules, courseExamNames]);

  // Deduplicated subject-wise marks requirements across all course preferences
  const requiredSubjectMarks = useMemo(() => {
    const subjects = new Map<string, number>();
    Object.values(courseRules).forEach(r => {
      if (r.subjectMinMarks) {
        for (const [subject, min] of Object.entries(r.subjectMinMarks)) {
          const existing = subjects.get(subject);
          // Keep the lowest minimum (most lenient) across courses
          if (existing === undefined || min < existing) {
            subjects.set(subject, min);
          }
        }
      }
    });
    return subjects;
  }, [courseRules]);

  // Always show subjects for non-school
  const showSubjects = !isSchool;

  // Per-course eligibility
  const perCourseResults: CourseEligibilityResult[] = rulesLoaded
    ? validatePerCourseEligibility(
        cat,
        academic,
        data.dob,
        data.course_selections || [],
        courseRules,
        SESSION_YEAR,
        additionalQualifications,
        data.category,
      )
    : [];

  // Year validations
  const anyRequiresGrad = needsGraduation || Object.values(courseRules).some(r => r.requiresGraduation);
  const yearErrors = validateAcademicYears(academic, SESSION_YEAR, anyRequiresGrad);
  const yearErrorMap: Record<string, string> = {};
  for (const ye of yearErrors) {
    yearErrorMap[ye.field] = ye.message;
  }

  const allCoursesHaveErrors = perCourseResults.length > 0 && perCourseResults.every(cr => cr.hasErrors);
  const hasYearErrors = yearErrors.length > 0;

  // Prerequisite validation: class 12 → class 10; graduation → class 12
  const class10 = academic.class_10 || {};
  const class12 = academic.class_12 || {};
  const graduation = academic.graduation || {};
  const isClass10Filled = !!(class10.board || class10.year || class10.marks);
  const isClass12Filled = !!(class12.board || class12.year || class12.marks);
  const isGradFilled = !!(graduation.degree || graduation.university || graduation.year || graduation.marks);
  const missingClass10 = !isSchool && isClass12Filled && !isClass10Filled;
  const missingClass12 = !isSchool && isGradFilled && !isClass12Filled;

  // For PG/MBA courses, graduation details are mandatory
  const missingGraduation = anyRequiresGrad && !isGradFilled;
  const hasBlockingErrors = allCoursesHaveErrors || hasYearErrors || missingClass10 || missingClass12 || missingGraduation;

  const showGraduation = needsGraduation || Object.values(courseRules).some(r => r.requiresGraduation);

  const firstCourseResults = perCourseResults[0]?.results || [];
  const class10InvalidFields = new Set<string>();
  const class12InvalidFields = new Set<string>();
  const graduationInvalidFields = new Set<string>();

  const addRequiredAcademicFields = (set: Set<string>, block: AcademicEntry, fields: string[]) => {
    fields.forEach((field) => {
      if (!String(block[field] || '').trim()) set.add(field);
    });
  };

  if (missingClass10) addRequiredAcademicFields(class10InvalidFields, class10, ['board', 'year', 'marks']);
  if (missingClass12) addRequiredAcademicFields(class12InvalidFields, class12, ['board', 'year', 'marks']);
  if (missingGraduation) addRequiredAcademicFields(graduationInvalidFields, graduation, ['degree', 'university', 'year', 'marks']);
  if (class10.board === 'Other' && !class10.board_other?.trim()) class10InvalidFields.add('board_other');
  if (class12.board === 'Other' && !class12.board_other?.trim()) class12InvalidFields.add('board_other');
  if (graduation.university === 'Other' && !graduation.university_other?.trim()) graduationInvalidFields.add('university_other');
  if (yearErrorMap['class_10_year']) class10InvalidFields.add('year');
  if (yearErrorMap['class_12_year']) class12InvalidFields.add('year');
  if (yearErrorMap['graduation_year']) graduationInvalidFields.add('year');
  firstCourseResults.forEach((result) => {
    if (result.type !== 'error') return;
    if (result.field === 'class_12') class12InvalidFields.add('subjects');
    if (result.field === 'subject_marks') class12InvalidFields.add('subject_marks');
    if (result.field === 'graduation') graduationInvalidFields.add('marks');
  });

  const handleContinue = () => {
    if (hasBlockingErrors) {
      setShowErrors(true);
      return;
    }
    onNext();
  };

  const updateAcademic = (v: AcademicFormData) => {
    // Check for custom boards/universities and flag
    const flags = [...(data.flags || [])];
    const checkCustom = (obj: AcademicEntry | undefined, key: string, checker: (v: string) => boolean, flagName: string) => {
      const value = obj?.[key];
      if (typeof value === 'string' && value && !checker(value)) {
        if (!flags.includes(flagName)) flags.push(flagName);
      }
    };
    checkCustom(v.class_10, 'board', isPredefinedBoard, 'custom_board');
    checkCustom(v.class_12, 'board', isPredefinedBoard, 'custom_board');
    checkCustom(v.graduation, 'university', isPredefinedUniversity, 'custom_university');
    (v.additional_qualifications || []).forEach((q) => {
      checkCustom(q, 'university', isPredefinedUniversity, 'custom_university');
    });

    onChange({ academic_details: v, flags });
  };

  // Additional qualifications management
  const addQualification = () => {
    const updated = { ...academic, additional_qualifications: [...additionalQualifications, {}] };
    updateAcademic(updated);
  };

  const removeQualification = (idx: number) => {
    const updated = { ...academic, additional_qualifications: additionalQualifications.filter((_, i) => i !== idx) };
    updateAcademic(updated);
  };

  const updateQualification = (idx: number, val: AcademicEntry) => {
    const newQ = [...additionalQualifications];
    newQ[idx] = val;
    const updated = { ...academic, additional_qualifications: newQ };
    updateAcademic(updated);
  };

  const updateEntranceExams = (exams: EntranceExam[]) => {
    updateAcademic({ ...academic, entrance_exams: exams });
  };

  const allowMultipleQualifications = needsGraduation || cat === 'professional';
  const isUG = !isSchool && !needsGraduation && cat !== 'professional';

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold text-foreground">Academic Details</h2>

      {/* Per-course eligibility cards */}
      {rulesLoaded && perCourseResults.length > 0 && (
        <EligibilityCards results={perCourseResults} />
      )}

      <fieldset disabled={readOnly} className={readOnly ? "pointer-events-none opacity-75" : ""}>

      {isSchool ? (
        <SchoolAcademicBlock
          academic={academic}
          updateAcademic={updateAcademic}
          courseSelections={data.course_selections || []}
        />) : (
        <div className="space-y-8">
          {missingClass10 && (
            <div className="p-3 rounded-xl bg-destructive/10 border border-destructive/20 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
              <p className="text-xs text-destructive font-medium">Class 10 details are required since you have added Class 12 details.</p>
            </div>
          )}
          <AcademicBlock
            title="Class 10"
            prefix="class_10"
            academic={academic}
            onChange={updateAcademic}
            yearError={yearErrorMap['class_10_year']}
            dobYear={dobYear}
            maxYear={
              academic?.class_12?.year
                ? parseInt(academic.class_12.year, 10) - 2
                : undefined
            }
            showErrors={showErrors}
            invalidFields={class10InvalidFields}
          />
          {missingClass12 && (
            <div className="p-3 rounded-xl bg-destructive/10 border border-destructive/20 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
              <p className="text-xs text-destructive font-medium">Class 12 details are required since you have added Graduation details.</p>
            </div>
          )}
          <AcademicBlock
            title="Class 12"
            prefix="class_12"
            academic={academic}
            onChange={updateAcademic}
            showResultPending
            showSubjects={showSubjects}
            validationErrors={firstCourseResults}
            yearError={yearErrorMap['class_12_year']}
            dobYear={dobYear}
            maxYear={SESSION_YEAR}
            minYear={
              academic?.class_10?.year
                ? parseInt(academic.class_10.year, 10) + 2
                : undefined
            }
            showErrors={showErrors}
            invalidFields={class12InvalidFields}
          />

          {/* Subject-wise marks inputs (e.g., English for GNM) */}
          {requiredSubjectMarks.size > 0 && academic?.class_12?.result_status !== 'not_declared' && (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-foreground">Subject-wise Marks (Class 12)</h3>
              <p className="text-xs text-muted-foreground">Some of your selected courses require minimum marks in specific subjects.</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {Array.from(requiredSubjectMarks.entries()).map(([subject, minPct]) => {
                  const subjectMarks = (academic.class_12?.subject_marks || {}) as Record<string, string>;
                  const val = subjectMarks[subject] || '';
                  const subjectError = perCourseResults.flatMap(cr => cr.results).find(r => r.field === 'subject_marks' && r.message.includes(subject));
                  return (
                    <TextField
                      key={subject}
                      label={
                        <>
                          {subject} Marks / % <span className="text-muted-foreground/70">(min {minPct}%)</span>
                        </>
                      }
                      value={val}
                      onValueChange={v => {
                        const newMarks = { ...((academic.class_12?.subject_marks || {}) as Record<string, string>), [subject]: v };
                        updateAcademic({ ...academic, class_12: { ...academic.class_12, subject_marks: newMarks } });
                      }}
                      placeholder="e.g. 45 or 4.5 CGPA"
                      error={showErrors && subjectError?.type === 'error' ? subjectError.message : undefined}
                    />
                  );
                })}
              </div>
            </div>
          )}

          {/* Graduation — required for PG/professional */}
          {showGraduation && (
            <>
            {missingGraduation && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-xs">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                Graduation details are required for this course. Please fill in your degree, university, year and marks.
              </div>
            )}
            <AcademicBlock
              title="Graduation"
              prefix="graduation"
              academic={academic}
              onChange={updateAcademic}
              showResultPending
              showDegreeSelector
              validationErrors={firstCourseResults}
              yearError={yearErrorMap['graduation_year']}
              maxYear={SESSION_YEAR + 1}
              dobYear={dobYear}
              showErrors={showErrors}
              invalidFields={graduationInvalidFields}
            />
            {parseInt(graduation.year) === SESSION_YEAR + 1 && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-info/5 dark:bg-info/90/20 border border-info/20 text-info-foreground text-xs">
                <Info className="h-3.5 w-3.5 shrink-0" />
                Graduation in {SESSION_YEAR + 1}: your application will be considered for the {SESSION_YEAR + 1}-{(SESSION_YEAR + 2).toString().slice(-2)} session.
              </div>
            )}
            </>
          )}

          {/* Optional Graduation for UG courses */}
          {isUG && !showGraduation && (
            <div className="space-y-3">
              <div className="rounded-2xl border border-border bg-muted/20 px-4 py-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <GraduationCap className="h-5 w-5 text-primary" />
                  <div>
                    <p className="text-sm font-semibold text-foreground">Add Graduation Details</p>
                    <p className="text-[11px] text-muted-foreground">Optional — useful to explain gap years or showcase prior degrees.</p>
                  </div>
                </div>
                <Switch checked={showOptionalGrad} onCheckedChange={setShowOptionalGrad} aria-label="Toggle optional graduation details" />
              </div>
              {showOptionalGrad && (
                <AcademicBlock
                  title="Graduation (Optional)"
                  prefix="graduation"
                  academic={academic}
                  onChange={updateAcademic}
                  showResultPending
                  showDegreeSelector
                  dobYear={dobYear}
                />
              )}
            </div>
          )}

          {/* Additional qualifications for PG/LLB */}
          {allowMultipleQualifications && (
            <div className="space-y-4">
              {additionalQualifications.map((q, idx) => (
                <AcademicBlock
                  key={idx}
                  title={`Additional Qualification ${idx + 1}`}
                  prefix={`additional_${idx}`}
                  academic={{ [`additional_${idx}`]: q }}
                  onChange={(v) => updateQualification(idx, v[`additional_${idx}`] || {})}
                  showResultPending
                  showDegreeSelector
                  removable
                  onRemove={() => removeQualification(idx)}
                  dobYear={dobYear}
                />
              ))}
              <Button variant="outline" size="sm" onClick={addQualification} className="gap-2 text-xs">
                <Plus className="h-3.5 w-3.5" /> Add Another Qualification
              </Button>
            </div>
          )}

          {/* Entrance Exams */}
          {!isSchool && (
            <EntranceExamSection
              exams={entranceExams}
              onChange={updateEntranceExams}
              courseExamNames={courseExamNames}
              recommendedExamNames={recommendedExamNames}
            />
          )}
        </div>
      )}

      {(allCoursesHaveErrors || hasYearErrors) && (
        <div className="p-3 rounded-xl bg-destructive/10 border border-destructive/20 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
          <p className="text-xs text-destructive font-medium">
            {allCoursesHaveErrors && !hasYearErrors
              ? 'You do not meet the eligibility requirements for any of your selected courses. Please review or change your course preferences.'
              : hasYearErrors
              ? 'Academic year validation errors found. Please correct the year fields above.'
              : 'You do not meet the minimum eligibility requirements. Please review the fields above.'}
          </p>
        </div>
      )}
      </fieldset>

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
