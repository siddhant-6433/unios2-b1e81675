import { useState, useEffect } from "react";
import { ArrowRight, ArrowLeft, Loader2, AlertTriangle, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ApplicationData } from "./types";
import { validateAcademicEligibility, ValidationResult, fetchEligibilityRules, EligibilityRule } from "./eligibilityRules";

interface Props {
  data: ApplicationData;
  onChange: (data: Partial<ApplicationData>) => void;
  onNext: () => void;
  onBack: () => void;
  saving: boolean;
}

const inputCls = "w-full rounded-xl border border-input bg-card py-2.5 px-4 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20";

function AcademicBlock({
  title,
  prefix,
  academic,
  onChange,
  showResultPending,
  showSubjects,
  validationError,
}: {
  title: string;
  prefix: string;
  academic: Record<string, any>;
  onChange: (v: Record<string, any>) => void;
  showResultPending?: boolean;
  showSubjects?: boolean;
  validationError?: ValidationResult;
}) {
  const data = academic[prefix] || {};
  const update = (field: string, val: string) => {
    onChange({ ...academic, [prefix]: { ...data, [field]: val } });
  };
  const isPending = data.result_status === 'not_declared';

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {prefix === 'graduation' ? (
          <>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Degree</label>
              <input value={data.degree || ''} onChange={e => update('degree', e.target.value)} className={inputCls} />
            </div>
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
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Marks / Percentage / CGPA</label>
          <input value={data.marks || ''} onChange={e => update('marks', e.target.value)} placeholder="e.g. 85% or 8.5" className={inputCls} />
          {validationError && validationError.type === 'error' && (
            <div className="mt-1.5 flex items-start gap-1.5 text-destructive">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span className="text-xs">{validationError.message}</span>
            </div>
          )}
          {validationError && validationError.type === 'warning' && (
            <div className="mt-1.5 flex items-start gap-1.5 text-warning">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span className="text-xs">{validationError.message}</span>
            </div>
          )}
        </div>
        {showSubjects && prefix === 'class_12' && (
          <div className="sm:col-span-2">
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Subjects / Stream</label>
            <input value={data.subjects || ''} onChange={e => update('subjects', e.target.value)} placeholder="e.g. PCM, Commerce, Arts" className={inputCls} />
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
                    <div>
                      <label className="text-xs font-medium text-muted-foreground mb-1 block">Subjects</label>
                      <input value={data.subjects || ''} onChange={e => update('subjects', e.target.value)} placeholder="e.g. PCM, Commerce" className={inputCls} />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-muted-foreground mb-1 block">Expected Result Month</label>
                      <input value={data.expected_month || ''} onChange={e => update('expected_month', e.target.value)} placeholder="e.g. June 2026" className={inputCls} />
                    </div>
                  </>
                )}
                {prefix === 'graduation' && (
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

export function AcademicDetails({ data, onChange, onNext, onBack, saving }: Props) {
  const cat = data.program_category;
  const isSchool = cat === 'school';
  const needsGraduation = ['postgraduate', 'mba_pgdm', 'professional', 'bed', 'deled'].includes(cat);
  const academic = data.academic_details || {};

  // Fetch DB-driven eligibility rules
  const [courseRules, setCourseRules] = useState<Record<string, EligibilityRule>>({});
  const [rulesLoaded, setRulesLoaded] = useState(false);

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

  // Merge rules: use strictest across all selected courses, or fallback to category
  const mergedRule: EligibilityRule | undefined = rulesLoaded && Object.keys(courseRules).length > 0
    ? Object.values(courseRules).reduce<EligibilityRule>((acc, r) => ({
        minAge: Math.max(acc.minAge || 0, r.minAge || 0) || undefined,
        maxAge: acc.maxAge && r.maxAge ? Math.min(acc.maxAge, r.maxAge) : (acc.maxAge || r.maxAge),
        class12MinMarks: Math.max(acc.class12MinMarks || 0, r.class12MinMarks || 0) || undefined,
        graduationMinMarks: Math.max(acc.graduationMinMarks || 0, r.graduationMinMarks || 0) || undefined,
        requiresGraduation: acc.requiresGraduation || r.requiresGraduation,
        entranceExamName: r.entranceExamName || acc.entranceExamName,
        entranceExamRequired: acc.entranceExamRequired || r.entranceExamRequired,
        subjectPrerequisites: r.subjectPrerequisites?.length ? r.subjectPrerequisites : acc.subjectPrerequisites,
        notes: [acc.notes, r.notes].filter(Boolean).join('; ') || undefined,
      }), {})
    : undefined;

  const hasSubjectPrereqs = mergedRule?.subjectPrerequisites && mergedRule.subjectPrerequisites.length > 0;

  const validationErrors = validateAcademicEligibility(cat, academic, mergedRule);
  const errorMap = validationErrors.reduce<Record<string, ValidationResult>>((acc, e) => {
    if (!acc[e.field]) acc[e.field] = e;
    return acc;
  }, {});

  const hasBlockingErrors = validationErrors.some(e => e.type === 'error');
  const infoMessages = validationErrors.filter(e => e.type === 'info');

  const updateAcademic = (v: Record<string, any>) => {
    onChange({ academic_details: v });
  };

  // Also check if graduation is needed based on DB rules
  const showGraduation = needsGraduation || mergedRule?.requiresGraduation;

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold text-foreground">Academic Details</h2>

      {/* Info banners for entrance exams and notes */}
      {infoMessages.map((msg, i) => (
        <div key={i} className="p-3 rounded-xl bg-primary/5 border border-primary/20 flex items-start gap-2">
          <Info className="h-4 w-4 text-primary shrink-0 mt-0.5" />
          <p className="text-xs text-foreground">{msg.message}</p>
        </div>
      ))}

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
          <AcademicBlock title="Class 10" prefix="class_10" academic={academic} onChange={updateAcademic} />
          <AcademicBlock
            title="Class 12"
            prefix="class_12"
            academic={academic}
            onChange={updateAcademic}
            showResultPending
            showSubjects={!!hasSubjectPrereqs}
            validationError={errorMap['class_12']}
          />
          {showGraduation && (
            <AcademicBlock title="Graduation" prefix="graduation" academic={academic} onChange={updateAcademic} showResultPending validationError={errorMap['graduation']} />
          )}
        </>
      )}

      {hasBlockingErrors && (
        <div className="p-3 rounded-xl bg-destructive/10 border border-destructive/20 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
          <p className="text-xs text-destructive font-medium">You do not meet the minimum eligibility requirements. Please review the fields above.</p>
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
