import { useState, useEffect } from "react";
import { ArrowRight, ArrowLeft, Loader2, AlertTriangle, Info, CheckCircle, XCircle, ChevronDown, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
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

const CLASS_12_SUBJECTS = [
  "Physics", "Chemistry", "Biology", "Mathematics", "English", "Hindi",
  "Economics", "Accountancy", "Business Studies", "History", "Political Science",
  "Geography", "Computer Science", "Sociology", "Psychology", "Physical Education", "Home Science",
];

const GRADUATION_DEGREES = [
  "B.A.", "B.Sc.", "B.Com.", "BBA", "B.Tech.", "B.E.", "BCA", "BPT",
  "B.Sc. Nursing", "B.Pharm.", "LLB", "B.Ed.", "MBBS", "BMRIT", "B.Sc. Radiology",
];

interface Props {
  data: ApplicationData;
  onChange: (data: Partial<ApplicationData>) => void;
  onNext: () => void;
  onBack: () => void;
  saving: boolean;
}

const inputCls = "w-full rounded-xl border border-input bg-card py-2.5 px-4 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20";

const SESSION_YEAR = 2026; // TODO: derive from active session

/* ── Per-Course Eligibility Card ─────────────────────────── */
function EligibilityCards({ results }: { results: CourseEligibilityResult[] }) {
  if (!results.length) return null;

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-foreground">Course Eligibility Status</h3>
      {results.map(cr => (
        <Card key={cr.courseId} className={`border shadow-none ${cr.hasErrors ? 'border-destructive/30 bg-destructive/5' : 'border-primary/30 bg-primary/5'}`}>
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-1.5">
              {cr.hasErrors
                ? <XCircle className="h-4 w-4 text-destructive shrink-0" />
                : <CheckCircle className="h-4 w-4 text-primary shrink-0" />
              }
              <span className="text-sm font-medium text-foreground">
                Pref {cr.preferenceOrder}: {cr.courseName} — {cr.campusName}
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5 ml-6">
              {/* DOB */}
              {cr.dobResult ? (
                <StatusBadge type={cr.dobResult.type} label={cr.dobResult.message} />
              ) : (
                <StatusBadge type="pass" label="Age OK" />
              )}
              {/* Academic */}
              {cr.results.filter(r => r.type !== 'info').map((r, i) => (
                <StatusBadge key={i} type={r.type} label={r.message} />
              ))}
              {/* Year */}
              {cr.yearResults.map((r, i) => (
                <StatusBadge key={`yr-${i}`} type={r.type} label={r.message} />
              ))}
              {/* If no errors at all */}
              {!cr.hasErrors && cr.results.filter(r => r.type !== 'info').length === 0 && cr.yearResults.length === 0 && (
                <StatusBadge type="pass" label="All criteria met" />
              )}
            </div>
            {/* Info messages */}
            {cr.results.filter(r => r.type === 'info').map((r, i) => (
              <div key={`info-${i}`} className="ml-6 mt-1 flex items-start gap-1.5 text-muted-foreground">
                <Info className="h-3 w-3 shrink-0 mt-0.5" />
                <span className="text-xs">{r.message}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
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
  removable,
  onRemove,
}: {
  title: string;
  prefix: string;
  academic: Record<string, any>;
  onChange: (v: Record<string, any>) => void;
  showResultPending?: boolean;
  showSubjects?: boolean;
  showDegreeSelector?: boolean;
  validationErrors?: ValidationResult[];
  yearError?: string;
  removable?: boolean;
  onRemove?: () => void;
}) {
  const data = academic[prefix] || {};
  const update = (field: string, val: string) => {
    onChange({ ...academic, [prefix]: { ...data, [field]: val } });
  };
  const isPending = data.result_status === 'not_declared';

  const fieldError = validationErrors?.find(e => e.field === prefix || e.field === 'class_12');

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {removable && onRemove && (
          <Button variant="ghost" size="sm" onClick={onRemove} className="text-destructive hover:text-destructive h-7 px-2">
            <Trash2 className="h-3.5 w-3.5 mr-1" /> Remove
          </Button>
        )}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {prefix.startsWith('graduation') || prefix.startsWith('additional_') ? (
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
                />
              </div>
            ) : (
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Degree</label>
                <input value={data.degree || ''} onChange={e => update('degree', e.target.value)} className={inputCls} />
              </div>
            )}
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">University</label>
              <input value={data.university || ''} onChange={e => update('university', e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">College</label>
              <input value={data.college || ''} onChange={e => update('college', e.target.value)} className={inputCls} />
            </div>
          </>
        ) : (
          <>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Board</label>
              <input value={data.board || ''} onChange={e => update('board', e.target.value)} placeholder="e.g. CBSE, ICSE" className={inputCls} />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">School</label>
              <input value={data.school || ''} onChange={e => update('school', e.target.value)} className={inputCls} />
            </div>
          </>
        )}
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Year</label>
          <input value={data.year || ''} onChange={e => update('year', e.target.value)} placeholder="e.g. 2025" className={inputCls} />
          {yearError && (
            <div className="mt-1.5 flex items-start gap-1.5 text-destructive">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span className="text-xs">{yearError}</span>
            </div>
          )}
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Marks / Percentage / CGPA</label>
          <input value={data.marks || ''} onChange={e => update('marks', e.target.value)} placeholder="e.g. 85% or 8.5" className={inputCls} />
          {fieldError && fieldError.type === 'error' && fieldError.field !== 'class_12' && (
            <div className="mt-1.5 flex items-start gap-1.5 text-destructive">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span className="text-xs">{fieldError.message}</span>
            </div>
          )}
        </div>
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
            />
            {/* Show subject-specific errors inline */}
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
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Result Status</label>
            <select value={data.result_status || 'declared'} onChange={e => update('result_status', e.target.value)} className={inputCls}>
              <option value="declared">Declared</option>
              <option value="not_declared">Not Declared (Result Pending)</option>
            </select>
          </div>

          {isPending && (
            <div className="p-3 rounded-xl bg-warning/10 border border-warning/20 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
              <div className="space-y-2 flex-1">
                <p className="text-xs text-foreground font-medium">Result Awaited — you can still apply</p>
                {prefix === 'class_12' && (
                  <>
                    {/* Always show subjects even in pending state */}
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
                    <div>
                      <label className="text-xs font-medium text-muted-foreground mb-1 block">Expected Result Month</label>
                      <input value={data.expected_month || ''} onChange={e => update('expected_month', e.target.value)} placeholder="e.g. June 2026" className={inputCls} />
                    </div>
                  </>
                )}
                {(prefix === 'graduation' || prefix.startsWith('additional_')) && (
                  <>
                    <div>
                      <label className="text-xs font-medium text-muted-foreground mb-1 block">CGPA till last declared semester</label>
                      <input value={data.cgpa_till_sem || ''} onChange={e => update('cgpa_till_sem', e.target.value)} className={inputCls} />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-muted-foreground mb-1 block">Semesters completed</label>
                      <input value={data.semesters_completed || ''} onChange={e => update('semesters_completed', e.target.value)} className={inputCls} />
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Main Component ─────────────────────────── */
export function AcademicDetails({ data, onChange, onNext, onBack, saving }: Props) {
  const cat = data.program_category;
  const isSchool = cat === 'school';
  const needsGraduation = ['postgraduate', 'mba_pgdm', 'professional', 'bed', 'deled'].includes(cat);
  const academic = data.academic_details || {};
  const additionalQualifications: Record<string, any>[] = (academic as any).additional_qualifications || [];

  // Fetch DB-driven eligibility rules
  const [courseRules, setCourseRules] = useState<Record<string, EligibilityRule>>({});
  const [rulesLoaded, setRulesLoaded] = useState(false);
  const [showOptionalGrad, setShowOptionalGrad] = useState(false);

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

  // Any course has subject prerequisites?
  const anyHasSubjectPrereqs = rulesLoaded && Object.values(courseRules).some(
    r => r.subjectPrerequisites && r.subjectPrerequisites.length > 0
  );

  // Always show subjects for non-school (needed for validation)
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
      )
    : [];

  // Year validations
  const anyRequiresGrad = needsGraduation || Object.values(courseRules).some(r => r.requiresGraduation);
  const yearErrors = validateAcademicYears(academic, SESSION_YEAR, anyRequiresGrad);
  const yearErrorMap: Record<string, string> = {};
  for (const ye of yearErrors) {
    yearErrorMap[ye.field] = ye.message;
  }

  // Block submission only if ALL courses have errors (or year errors exist which are global)
  const allCoursesHaveErrors = perCourseResults.length > 0 && perCourseResults.every(cr => cr.hasErrors);
  const hasYearErrors = yearErrors.length > 0;
  const hasBlockingErrors = allCoursesHaveErrors || hasYearErrors;

  // Also check if graduation is needed based on DB rules
  const showGraduation = needsGraduation || Object.values(courseRules).some(r => r.requiresGraduation);

  // Collect validation errors for inline display (from first course or combined)
  const firstCourseResults = perCourseResults[0]?.results || [];

  const updateAcademic = (v: Record<string, any>) => {
    onChange({ academic_details: v });
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

  const updateQualification = (idx: number, val: Record<string, any>) => {
    const newQ = [...additionalQualifications];
    newQ[idx] = val;
    const updated = { ...academic, additional_qualifications: newQ };
    updateAcademic(updated);
  };

  // Determine if this is a PG/LLB course that allows multiple qualifications
  const allowMultipleQualifications = needsGraduation || cat === 'professional';
  // UG courses can optionally add graduation
  const isUG = !isSchool && !needsGraduation && cat !== 'professional';

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold text-foreground">Academic Details</h2>

      {/* Per-course eligibility cards */}
      {rulesLoaded && perCourseResults.length > 0 && (
        <EligibilityCards results={perCourseResults} />
      )}

      {isSchool ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">Previous class report card details (if applicable).</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Previous Class/Grade</label>
              <input value={(academic as any).previous_class || ''} onChange={e => updateAcademic({ ...academic, previous_class: e.target.value })} className={inputCls} />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">School Name</label>
              <input value={(academic as any).previous_school || ''} onChange={e => updateAcademic({ ...academic, previous_school: e.target.value })} className={inputCls} />
            </div>
          </div>
        </div>
      ) : (
        <>
          <AcademicBlock
            title="Class 10"
            prefix="class_10"
            academic={academic}
            onChange={updateAcademic}
            yearError={yearErrorMap['class_10_year']}
          />
          <AcademicBlock
            title="Class 12"
            prefix="class_12"
            academic={academic}
            onChange={updateAcademic}
            showResultPending
            showSubjects={showSubjects}
            validationErrors={firstCourseResults}
            yearError={yearErrorMap['class_12_year']}
          />

          {/* Graduation — required for PG/professional */}
          {showGraduation && (
            <AcademicBlock
              title="Graduation"
              prefix="graduation"
              academic={academic}
              onChange={updateAcademic}
              showResultPending
              showDegreeSelector
              validationErrors={firstCourseResults}
              yearError={yearErrorMap['graduation_year']}
            />
          )}

          {/* Optional Graduation for UG courses */}
          {isUG && !showGraduation && (
            <Collapsible open={showOptionalGrad} onOpenChange={setShowOptionalGrad}>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className="gap-2 text-muted-foreground hover:text-foreground">
                  <ChevronDown className={`h-4 w-4 transition-transform ${showOptionalGrad ? 'rotate-180' : ''}`} />
                  Add Graduation Details (Optional — e.g., to explain gap years)
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-3">
                <AcademicBlock
                  title="Graduation (Optional)"
                  prefix="graduation"
                  academic={academic}
                  onChange={updateAcademic}
                  showResultPending
                  showDegreeSelector
                />
              </CollapsibleContent>
            </Collapsible>
          )}

          {/* Additional qualifications for PG/LLB */}
          {allowMultipleQualifications && (
            <div className="space-y-4">
              {additionalQualifications.map((q, idx) => (
                <AcademicBlock
                  key={idx}
                  title={`Additional Qualification ${idx + 1}`}
                  prefix={`additional_${idx}`}
                  academic={
                    // Create a virtual academic object so the block reads from the right place
                    { [`additional_${idx}`]: q }
                  }
                  onChange={(v) => updateQualification(idx, v[`additional_${idx}`] || {})}
                  showResultPending
                  showDegreeSelector
                  removable
                  onRemove={() => removeQualification(idx)}
                />
              ))}
              <Button variant="outline" size="sm" onClick={addQualification} className="gap-2 text-xs">
                <Plus className="h-3.5 w-3.5" /> Add Another Qualification
              </Button>
            </div>
          )}
        </>
      )}

      {hasBlockingErrors && (
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

      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack} className="gap-2">
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
        <Button onClick={onNext} disabled={saving || hasBlockingErrors} className="gap-2">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
          Save & Continue
        </Button>
      </div>
    </div>
  );
}
