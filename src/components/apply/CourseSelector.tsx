import { useState, useEffect, useMemo } from "react";
import { ArrowRight, Loader2, MapPin, GripVertical, Plus, X, AlertTriangle, CheckCircle2, Info, Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DatePickerField, SelectField } from "@/components/ui/state-fields";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { CourseSelection, determineProgramCategory, calculateFee } from "./types";
import { usePortal } from "./PortalContext";
import { filterCoursesByAge, validateAge, AgeValidationResult, getSchoolGradeSortRank } from "./ageValidation";

interface Props {
  phone: string;
  leadName: string;
  childDob: string;
  onDobChange: (dob: string) => void;
  onComplete: (sessionId: string, selections: CourseSelection[], leadId: string | null) => void;
  existingSelections?: CourseSelection[];
  existingSession?: string;
  onCancel?: () => void;
}

const inputCls = "w-full rounded-xl border border-input bg-card py-2.5 px-4 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20";
const invalidCls = "border-destructive ring-1 ring-destructive/30 focus:ring-destructive/30";

type CourseRecord = {
  id: string;
  name: string;
  code?: string;
  ageValidation?: AgeValidationResult;
  departments?: {
    id?: string;
    name?: string;
    institutions?: {
      id?: string;
      name?: string;
      campus_id?: string;
      type?: string;
      campuses?: {
        id?: string;
        name?: string;
      };
    };
  };
};

export function CourseSelector({ phone, leadName, childDob, onDobChange, onComplete, existingSelections, existingSession, onCancel }: Props) {
  const { toast } = useToast();
  const portal = usePortal();
  const isSchoolPortal = portal.programCategories.includes("school");
  const isEditing = !!(existingSelections && existingSelections.length > 0);
  const [sessions, setSessions] = useState<{ id: string; name: string }[]>([]);
  const [courses, setCourses] = useState<CourseRecord[]>([]);
  const [selectedSession, setSelectedSession] = useState(existingSession || '');
  const [selections, setSelections] = useState<CourseSelection[]>(existingSelections || []);
  const [addingCourse, setAddingCourse] = useState('');
  const [saving, setSaving] = useState(false);
  const [selectedSchool, setSelectedSchool] = useState('');
  const [showErrors, setShowErrors] = useState(false);

  useEffect(() => {
    Promise.all([
      supabase.from("admission_sessions").select("id, name").eq("is_active", true).order("name"),
      supabase.from("courses").select(`
        id, name, code, department_id,
        departments!inner (
          id, name, institution_id,
          institutions!inner (
            id, name, campus_id, type,
            campuses!inner ( id, name )
          )
        )
      `).order("name"),
    ]).then(([sessRes, courseRes]) => {
      if (sessRes.data) setSessions(sessRes.data);
      if (courseRes.data) setCourses(courseRes.data);
    });
  }, []);

  // Filter courses based on portal config
  const portalFilteredCourses = useMemo(() => {
    if (portal.gradeKeywords.length === 0 && portal.institutionTypes.length === 0 && (!portal.campusKeywords || portal.campusKeywords.length === 0)) return courses;
    return courses.filter((c) => {
      if (portal.institutionTypes.length > 0) {
        const instType = c.departments?.institutions?.type?.toLowerCase() || "";
        if (!portal.institutionTypes.some(t => instType.includes(t))) return false;
      }
      if (portal.gradeKeywords.length > 0) {
        const nameAndCode = (c.name + " " + c.code).toLowerCase();
        if (!portal.gradeKeywords.some(kw => nameAndCode.includes(kw))) return false;
      }
      if (portal.campusKeywords && portal.campusKeywords.length > 0) {
        const campusName = (c.departments?.institutions?.campuses?.name || "").toLowerCase();
        const instName = (c.departments?.institutions?.name || "").toLowerCase();
        if (!portal.campusKeywords.some(kw => campusName.includes(kw) || instName.includes(kw))) return false;
      }
      return true;
    });
  }, [courses, portal]);

  // Apply age filtering for school portals
  const filteredCourses = useMemo(() => {
    if (!isSchoolPortal || !childDob) return portalFilteredCourses;
    return filterCoursesByAge(portalFilteredCourses, childDob, portal.id);
  }, [portalFilteredCourses, childDob, isSchoolPortal, portal.id]);

  // For school portals: unique school (institution) options from filtered courses
  const schoolOptions = useMemo(() => {
    if (!isSchoolPortal) return [];
    const seen = new Map<string, string>(); // id → name
    filteredCourses.forEach((c) => {
      const inst = c.departments?.institutions;
      if (inst?.id && inst?.name) seen.set(inst.id, inst.name);
    });
    return Array.from(seen.entries()).map(([id, name]) => ({ id, name }));
  }, [filteredCourses, isSchoolPortal]);

  // Auto-select school when only one option
  useEffect(() => {
    if (isSchoolPortal && schoolOptions.length === 1 && !selectedSchool) {
      setSelectedSchool(schoolOptions[0].id);
    }
  }, [schoolOptions, isSchoolPortal, selectedSchool]);

  const coursesByGroup = useMemo(() => {
    const map = new Map<string, { label: string; courses: CourseRecord[] }>();
    const sourceCourses = isSchoolPortal && selectedSchool
      ? filteredCourses.filter((c) => c.departments?.institutions?.id === selectedSchool)
      : filteredCourses;

    sourceCourses.forEach((c) => {
      // For school portals use institution name as group label; otherwise campus — dept
      const label = isSchoolPortal
        ? (c.departments?.institutions?.name || "Unknown School")
        : `${c.departments?.institutions?.campuses?.name || "Unknown"} — ${c.departments?.name || "Unknown"}`;
      if (!map.has(label)) map.set(label, { label, courses: [] });
      map.get(label)!.courses.push(c);
    });

    return Array.from(map.values()).map(group => ({
      ...group,
      courses: [...group.courses].sort((a, b) => {
        const rankA = getSchoolGradeSortRank(a.name || "", a.code || "", portal.id);
        const rankB = getSchoolGradeSortRank(b.name || "", b.code || "", portal.id);
        if (rankA !== rankB) return rankA - rankB;
        return (a.name || "").localeCompare(b.name || "");
      }),
    }));
  }, [filteredCourses, portal.id, isSchoolPortal, selectedSchool]);

  const addCourse = () => {
    if (!addingCourse) return;
    const course = filteredCourses.find((c) => c.id === addingCourse);
    if (!course || selections.some(s => s.course_id === addingCourse)) return;

    const campusName = course.departments?.institutions?.campuses?.name || '';
    const campusId = course.departments?.institutions?.campus_id || '';
    const institutionId = course.departments?.institutions?.id || null;
    const programCat = determineProgramCategory(course.code, course.name);

    setSelections(prev => [
      ...prev,
      {
        course_id: course.id,
        campus_id: campusId,
        institution_id: institutionId,
        course_name: course.name,
        campus_name: campusName,
        preference_order: prev.length + 1,
        program_category: programCat,
      },
    ]);
    setAddingCourse('');
  };

  const removeCourse = (courseId: string) => {
    setSelections(prev =>
      prev.filter(s => s.course_id !== courseId).map((s, i) => ({ ...s, preference_order: i + 1 }))
    );
  };

  const moveUp = (index: number) => {
    if (index === 0) return;
    setSelections(prev => {
      const arr = [...prev];
      [arr[index - 1], arr[index]] = [arr[index], arr[index - 1]];
      return arr.map((s, i) => ({ ...s, preference_order: i + 1 }));
    });
  };

  // Get age validation for selected courses
  const getSelectionValidation = (s: CourseSelection): AgeValidationResult | null => {
    if (!isSchoolPortal || !childDob) return null;
    return validateAge(childDob, s.course_name, "", portal.id);
  };

  const estimatedFee = calculateFee(selections);
  const today = new Date();
  const childDobFromYear = today.getFullYear() - 32;
  const childDobToYear = today.getFullYear() - 3;

  // Check if any selection has strict age block
  const hasStrictBlock = selections.some(s => {
    const v = getSelectionValidation(s);
    return v && !v.eligible && v.enforcement === "strict";
  });

  const handleContinue = async () => {
    if (!selectedSession || selections.length === 0 || (isSchoolPortal && !childDob) || (isSchoolPortal && schoolOptions.length > 1 && !selectedSchool)) {
      setShowErrors(true);
      toast({ title: 'Select session and at least one course', variant: 'destructive' });
      return;
    }
    if (hasStrictBlock) {
      setShowErrors(true);
      toast({ title: 'Age requirement not met', description: 'Remove ineligible grades to continue.', variant: 'destructive' });
      return;
    }
    setSaving(true);

    const { data: existingLead } = await supabase
      .from("leads")
      .select("id")
      .eq("phone", phone)
      .eq("is_mirror", false)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    onComplete(selectedSession, selections, existingLead?.id || null);
    setSaving(false);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-foreground">Welcome, {leadName}</h1>
        <p className="text-sm text-muted-foreground">
          {isSchoolPortal
            ? "Enter your child's date of birth and select the grade to begin."
            : "Select your intake cycle and preferred courses to begin."}
        </p>
      </div>

      {/* Child DOB for school portals */}
      {isSchoolPortal && (
        <div className="space-y-1">
          <DatePickerField
            label="Child's Date of Birth"
            required
            value={childDob}
            onValueChange={onDobChange}
            error={showErrors && !childDob ? "Child's date of birth is required." : undefined}
            placeholder="Select date of birth"
            fromYear={childDobFromYear}
            toYear={childDobToYear}
            maxDate={today}
            defaultMonth={new Date(2015, 0, 1)}
            triggerClassName={inputCls}
            allowManualInput
          />
          {childDob && (
            <p className="text-xs text-muted-foreground mt-1">
              <Info className="h-3 w-3 inline mr-1" />
              Age eligibility is calculated as of July 31st of the admission year.
            </p>
          )}
        </div>
      )}

      <div>
        <SelectField
          label={<><Calendar className="h-3.5 w-3.5 inline mr-1" /> Admission Session</>}
          required
          value={selectedSession}
          onValueChange={setSelectedSession}
          options={sessions.map((session) => ({ value: session.id, label: session.name }))}
          placeholder="Select intake cycle"
          error={showErrors && !selectedSession ? "Admission session is required." : undefined}
          triggerClassName={`${inputCls} ${showErrors && !selectedSession ? invalidCls : ''}`}
        />
      </div>

      {/* School selector — shown only for school portals with multiple schools */}
      {isSchoolPortal && schoolOptions.length > 1 && (
        <div>
          <SelectField
            label={<><MapPin className="h-3.5 w-3.5 inline mr-1" /> Select Campus</>}
            required
            value={selectedSchool}
            onValueChange={(value) => { setSelectedSchool(value); setAddingCourse(''); }}
            options={schoolOptions.map((school) => ({ value: school.id, label: school.name }))}
            placeholder="Select campus"
            error={showErrors && !selectedSchool ? "Campus is required." : undefined}
            triggerClassName={`${inputCls} ${showErrors && !selectedSchool ? invalidCls : ''}`}
          />
        </div>
      )}

      <div>
        <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
          {isSchoolPortal ? "Select Grade" : selections.length === 0 ? "Select Your Course" : "Add Another Course (Recommended)"}
        </label>
        <div className="flex gap-2">
          <SelectField
            value={addingCourse}
            onValueChange={setAddingCourse}
            options={[]}
            groups={coursesByGroup.map((group) => ({
              label: group.label,
              options: group.courses.map((course) => {
                const ageInfo = course.ageValidation;
                const ineligible = ageInfo && !ageInfo.eligible && ageInfo.enforcement === "strict";
                return {
                  value: course.id,
                  disabled: selections.some(s => s.course_id === course.id) || !!ineligible,
                  label: `${course.name}${ageInfo && !ageInfo.eligible ? ` (Age: ${ageInfo.ageAsOfJuly31}y - ${ageInfo.enforcement === "strict" ? "ineligible" : "guidance"})` : ""}`,
                };
              }),
            }))}
            placeholder={isSchoolPortal ? "Select grade to add" : selections.length === 0 ? "Select course to add" : "Add another course preference..."}
            triggerClassName={`${inputCls} flex-1 ${showErrors && selections.length === 0 ? invalidCls : ''}`}
            className="flex-1"
            disabled={isSchoolPortal && schoolOptions.length > 1 && !selectedSchool}
          />
          <Button onClick={addCourse} disabled={!addingCourse} variant="outline" className="shrink-0 gap-1.5">
            <Plus className="h-4 w-4" />
            Add Course
          </Button>
        </div>
      </div>

      {selections.length > 0 && (
        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground block">
            {isSchoolPortal ? "Selected Grade(s)" : "Selected Courses (drag to reorder preference)"}
          </label>
          {selections.map((s, i) => {
            const ageVal = getSelectionValidation(s);
            return (
              <div key={s.course_id} className="space-y-0">
                <div className="flex items-center gap-3 p-3 rounded-xl bg-muted/50 border border-border/40">
                  <button onClick={() => moveUp(i)} className="text-muted-foreground hover:text-foreground" disabled={i === 0}>
                    <GripVertical className="h-4 w-4" />
                  </button>
                  <Badge className="bg-primary/10 text-primary border-0 text-xs shrink-0">
                    P{s.preference_order}
                  </Badge>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{s.course_name}</p>
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <MapPin className="h-3 w-3" /> {s.campus_name}
                    </p>
                  </div>
                  <button onClick={() => removeCourse(s.course_id)} className="text-muted-foreground hover:text-destructive">
                    <X className="h-4 w-4" />
                  </button>
                </div>
                {/* Age validation banner */}
                {ageVal && !ageVal.eligible && (
                  <div className={`mx-3 px-3 py-2 rounded-b-lg text-xs flex items-start gap-1.5 ${
                    ageVal.enforcement === "strict"
                      ? "bg-destructive/10 text-destructive border border-t-0 border-destructive/20"
                      : "bg-warning/10 text-warning-foreground border border-t-0 border-warning/20"
                  }`}>
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    <span>{ageVal.message}</span>
                  </div>
                )}
                {ageVal && ageVal.eligible && ageVal.matchedGrade && (
                  <div className="mx-3 px-3 py-1.5 rounded-b-lg text-xs flex items-center gap-1.5 bg-primary/5 text-primary border border-t-0 border-primary/10">
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                    <span>{ageVal.message}</span>
                  </div>
                )}
              </div>
            );
          })}

          {/* Nudge to add more courses */}
          {selections.length === 1 && !isSchoolPortal && (
            <div className="flex items-start gap-2.5 p-3 rounded-xl bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/40">
              <Info className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-amber-800 dark:text-amber-300">Add more courses to improve your chances!</p>
                <p className="text-xs text-amber-700/70 dark:text-amber-400/70 mt-0.5">
                  Add multiple course preferences in a single application. If your first preference is full, you'll automatically be considered for your next choice.
                </p>
              </div>
            </div>
          )}
          {selections.length >= 2 && !isSchoolPortal && (
            <div className="flex items-center gap-2 p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800/40">
              <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
              <p className="text-xs text-emerald-700 dark:text-emerald-400">
                {selections.length} preferences selected — your chances of admission are higher with multiple choices.
              </p>
            </div>
          )}

          <div className="flex items-center justify-between p-3 rounded-xl bg-primary/5 border border-primary/10">
            <span className="text-sm text-muted-foreground">Estimated Application Fee</span>
            <span className="text-lg font-bold text-foreground">
              {estimatedFee === 0 ? 'Free' : `₹${estimatedFee.toLocaleString('en-IN')}`}
            </span>
          </div>
        </div>
      )}

      {showErrors && (!selectedSession || selections.length === 0 || (isSchoolPortal && !childDob) || (isSchoolPortal && schoolOptions.length > 1 && !selectedSchool) || hasStrictBlock) && (
        <div className="p-3 rounded-xl bg-destructive/10 border border-destructive/20 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
          <p className="text-xs text-destructive font-medium">
            Please complete the highlighted admission selection fields before continuing.
          </p>
        </div>
      )}

      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
        )}
        <Button onClick={handleContinue} disabled={saving} className="gap-2">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
          {isEditing ? "Update Selections" : "Continue to Application"}
        </Button>
      </div>
    </div>
  );
}
