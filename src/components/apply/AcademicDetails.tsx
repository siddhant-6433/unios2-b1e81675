import { useState, useEffect, useMemo } from "react";
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
  onBack: () => void;
  saving: boolean;
}

const inputCls = "w-full rounded-xl border border-input bg-card py-2.5 px-4 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20";

const SESSION_YEAR = 2026; // TODO: derive from active session

/** Generate year options descending from maxYear (or current year) down to dobYear */
function getYearOptions(dobYear?: number, maxYear?: number): number[] {
  const start = Math.max(1926, dobYear || 1926);
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
function YearSelect({ value, onChange, dobYear, maxYear, yearError }: {
  value: string;
  onChange: (v: string) => void;
  dobYear?: number;
  maxYear?: number;
  yearError?: string;
}) {
  const years = useMemo(() => getYearOptions(dobYear, maxYear), [dobYear, maxYear]);
  return (
    <div>
      <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Year</label>
      <select value={value || ''} onChange={e => onChange(e.target.value)} className={inputCls}>
        <option value="">Select year</option>
        {years.map(y => (
          <option key={y} value={y.toString()}>{y}</option>
        ))}
      </select>
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
  removable,
  onRemove,
  dobYear,
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
  maxYear?: number;
  removable?: boolean;
  onRemove?: () => void;
  dobYear?: number;
}) {
  const data = academic[prefix] || {};
  const update = (field: string, val: string) => {
    const newData = { ...academic, [prefix]: { ...data, [field]: val } };
    onChange(newData);
  };
  const isPending = data.result_status === 'not_declared';
  const isGradBlock = prefix.startsWith('graduation') || prefix.startsWith('additional_');

  const fieldError = validationErrors?.find(e => e.field === prefix || e.field === 'class_12');

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
                />
              </div>
            ) : (
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Degree</label>
                <input value={data.degree || ''} onChange={e => update('degree', e.target.value)} className={inputCls} />
              </div>
            )}
            <div>
              <SubjectTagInput
                label="University"
                options={[...UNIVERSITIES_LIST, 'Other (not in list)']}
                selected={data.university === 'Other' ? ['Other (not in list)'] : data.university ? [data.university] : []}
                onChange={handleUniversityChange}
                placeholder="Search university…"
                allowCustom={false}
              />
              {data.university === 'Other' && (
                <div className="mt-2">
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                    Specify university name <span className="text-destructive">*</span>
                  </label>
                  <input
                    value={data.university_other || ''}
                    onChange={e => onChange({ ...academic, [prefix]: { ...data, university_other: e.target.value } })}
                    placeholder="Enter full university name"
                    className={inputCls}
                  />
                </div>
              )}
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">College</label>
              <input value={data.college || ''} onChange={e => update('college', e.target.value)} className={inputCls} />
            </div>
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
              />
              {data.board === 'Other' && (
                <div className="mt-2">
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                    Specify board name <span className="text-destructive">*</span>
                  </label>
                  <input
                    value={data.board_other || ''}
                    onChange={e => onChange({ ...academic, [prefix]: { ...data, board_other: e.target.value } })}
                    placeholder="Enter full board name"
                    className={inputCls}
                  />
                </div>
              )}
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">School</label>
              <input value={data.school || ''} onChange={e => update('school', e.target.value)} className={inputCls} />
            </div>
          </>
        )}
        <YearSelect
          value={data.year || ''}
          onChange={v => update('year', v)}
          dobYear={dobYear}
          maxYear={maxYear}
          yearError={yearError}
        />
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

/* ── Entrance Exam Section ─────────────────────────── */
interface EntranceExam {
  exam_name: string;
  status: 'yet_to_appear' | 'not_declared' | 'declared';
  score?: string;
  expected_date?: string;
  is_custom?: boolean;
}

function EntranceExamSection({
  exams,
  onChange,
  courseExamNames,
}: {
  exams: EntranceExam[];
  onChange: (exams: EntranceExam[]) => void;
  courseExamNames: string[];
}) {
  // Auto-populate from course rules on first render
  useEffect(() => {
    if (exams.length === 0 && courseExamNames.length > 0) {
      onChange(courseExamNames.map(name => ({ exam_name: name, status: 'yet_to_appear' })));
    }
  }, [courseExamNames.length]); // eslint-disable-line react-hooks/exhaustive-deps

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

  if (courseExamNames.length === 0 && exams.length === 0) return null;

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-foreground">Entrance Exams</h3>
      {exams.map((ex, idx) => (
        <Card key={idx} className="border-border/60 shadow-none">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              {ex.is_custom ? (
                <input
                  value={ex.exam_name}
                  onChange={e => updateExam(idx, 'exam_name', e.target.value)}
                  placeholder="Exam name"
                  className={`${inputCls} max-w-xs`}
                />
              ) : (
                <h4 className="text-sm font-medium text-foreground">{ex.exam_name}</h4>
              )}
              {ex.is_custom && (
                <Button variant="ghost" size="sm" onClick={() => removeExam(idx)} className="text-destructive h-7 px-2">
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Status</label>
                <select
                  value={ex.status}
                  onChange={e => updateExam(idx, 'status', e.target.value)}
                  className={inputCls}
                >
                  <option value="yet_to_appear">Yet to Appear</option>
                  <option value="not_declared">Result Not Declared</option>
                  <option value="declared">Result Declared</option>
                </select>
              </div>
              {ex.status === 'declared' && (
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Score / Rank</label>
                  <input
                    value={ex.score || ''}
                    onChange={e => updateExam(idx, 'score', e.target.value)}
                    placeholder="e.g. 120 marks or Rank 5000"
                    className={inputCls}
                  />
                </div>
              )}
              {ex.status === 'not_declared' && (
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Expected Result Date</label>
                  <input
                    value={ex.expected_date || ''}
                    onChange={e => updateExam(idx, 'expected_date', e.target.value)}
                    placeholder="e.g. July 2026"
                    className={inputCls}
                  />
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      ))}
      <Button variant="outline" size="sm" onClick={addCustomExam} className="gap-2 text-xs">
        <Plus className="h-3.5 w-3.5" /> Add Other Exam
      </Button>
    </div>
  );
}

/* ── School Academic Block ─────────────────────────── */
function SchoolAcademicBlock({
  academic,
  updateAcademic,
  courseSelections,
}: {
  academic: Record<string, any>;
  updateAcademic: (v: Record<string, any>) => void;
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
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
            Previous Class / Grade {!isOptional && <span className="text-destructive">*</span>}
          </label>
          <input required={!isOptional} value={prevSchool.last_class || ''} onChange={e => updatePrevSchool('last_class', e.target.value)} placeholder="e.g. UKG, Class 1" className={inputCls} />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
            Previous School Name {!isOptional && <span className="text-destructive">*</span>}
          </label>
          <input required={!isOptional} value={prevSchool.prev_school_name || ''} onChange={e => updatePrevSchool('prev_school_name', e.target.value)} placeholder="School name" className={inputCls} />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Board / Curriculum</label>
          <div className="relative">
            <select
              value={prevSchool.board || ''}
              onChange={e => updatePrevSchool('board', e.target.value)}
              className={`${inputCls} appearance-none`}
            >
              <option value="">Select board...</option>
              <option value="CBSE">CBSE</option>
              <option value="ICSE">ICSE / ISC</option>
              <option value="State Board">State Board</option>
              <option value="IB">IB</option>
              <option value="Cambridge">Cambridge (IGCSE)</option>
              <option value="Other">Other</option>
            </select>
            <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          </div>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Marks / Grade</label>
          <input value={prevSchool.percentage || ''} onChange={e => updatePrevSchool('percentage', e.target.value)} placeholder="e.g. 85% or A+" className={inputCls} />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Academic Year</label>
          <input value={prevSchool.academic_year || ''} onChange={e => updatePrevSchool('academic_year', e.target.value)} placeholder="e.g. 2025" className={inputCls} />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Transfer Certificate Available?</label>
          <div className="relative">
            <select
              value={prevSchool.tc_available || ''}
              onChange={e => updatePrevSchool('tc_available', e.target.value)}
              className={`${inputCls} appearance-none`}
            >
              <option value="">Select...</option>
              <option value="yes">Yes</option>
              <option value="no">No, will submit later</option>
            </select>
            <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          </div>
        </div>
      </div>
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
  const entranceExams: EntranceExam[] = (academic as any).entrance_exams || [];

  // DOB year for filtering year dropdowns
  const dobYear = data.dob ? new Date(data.dob).getFullYear() : undefined;

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

  // Deduplicated entrance exam names from course rules
  const courseExamNames = useMemo(() => {
    const names = new Set<string>();
    Object.values(courseRules).forEach(r => {
      if (r.entranceExamRequired && r.entranceExamName) {
        r.entranceExamName.split(',').map(n => n.trim()).filter(Boolean).forEach(n => names.add(n));
      }
    });
    return Array.from(names);
  }, [courseRules]);

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
  const hasBlockingErrors = allCoursesHaveErrors || hasYearErrors;

  const showGraduation = needsGraduation || Object.values(courseRules).some(r => r.requiresGraduation);

  const firstCourseResults = perCourseResults[0]?.results || [];

  const updateAcademic = (v: Record<string, any>) => {
    // Check for custom boards/universities and flag
    const flags = [...(data.flags || [])];
    const checkCustom = (obj: any, key: string, checker: (v: string) => boolean, flagName: string) => {
      if (obj && obj[key] && !checker(obj[key])) {
        if (!flags.includes(flagName)) flags.push(flagName);
      }
    };
    checkCustom(v.class_10, 'board', isPredefinedBoard, 'custom_board');
    checkCustom(v.class_12, 'board', isPredefinedBoard, 'custom_board');
    checkCustom(v.graduation, 'university', isPredefinedUniversity, 'custom_university');
    (v.additional_qualifications || []).forEach((q: any) => {
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

  const updateQualification = (idx: number, val: Record<string, any>) => {
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

      {isSchool ? (
        <SchoolAcademicBlock
          academic={academic}
          updateAcademic={updateAcademic}
          courseSelections={data.course_selections || []}
        />) : (
        <>
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
          />
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
          />

          {/* Subject-wise marks inputs (e.g., English for GNM) */}
          {requiredSubjectMarks.size > 0 && academic?.class_12?.result_status !== 'not_declared' && (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-foreground">Subject-wise Marks (Class 12)</h3>
              <p className="text-xs text-muted-foreground">Some of your selected courses require minimum marks in specific subjects.</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {Array.from(requiredSubjectMarks.entries()).map(([subject, minPct]) => {
                  const subjectMarks = (academic as any)?.class_12?.subject_marks || {};
                  const val = subjectMarks[subject] || '';
                  const subjectError = perCourseResults.flatMap(cr => cr.results).find(r => r.field === 'subject_marks' && r.message.includes(subject));
                  return (
                    <div key={subject}>
                      <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                        {subject} Marks / % <span className="text-muted-foreground/70">(min {minPct}%)</span>
                      </label>
                      <input
                        value={val}
                        onChange={e => {
                          const newMarks = { ...((academic as any)?.class_12?.subject_marks || {}), [subject]: e.target.value };
                          updateAcademic({ ...academic, class_12: { ...(academic as any)?.class_12, subject_marks: newMarks } });
                        }}
                        placeholder={`e.g. 45 or 4.5 CGPA`}
                        className={inputCls}
                      />
                      {subjectError && subjectError.type === 'error' && (
                        <div className="mt-1.5 flex items-start gap-1.5 text-destructive">
                          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                          <span className="text-xs">{subjectError.message}</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

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
              dobYear={dobYear}
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
                  dobYear={dobYear}
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
            />
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
