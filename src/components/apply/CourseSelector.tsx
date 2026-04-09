import { useState, useEffect, useMemo } from "react";
import { ArrowRight, Loader2, CalendarIcon, MapPin, GripVertical, Plus, X, AlertTriangle, CheckCircle2, Info, Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Calendar as CalendarPicker } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { format, isValid, parse } from "date-fns";
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

// ── DOB Calendar Picker ──────────────────────────────────────────
function DobPicker({ value, onChange, inputCls }: { value: string; onChange: (iso: string) => void; inputCls: string }) {
  const [open, setOpen] = useState(false);
  const [monthYear, setMonthYear] = useState<Date>(
    value && isValid(new Date(value)) ? new Date(value) : new Date(2015, 0, 1)
  );
  // Manual input state
  const [typed, setTyped] = useState("");

  const selected = value && isValid(new Date(value)) ? new Date(value) : undefined;

  const handleSelect = (date: Date | undefined) => {
    if (date) {
      onChange(format(date, "yyyy-MM-dd"));
      setOpen(false);
    }
  };

  const handleTyped = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    setTyped(raw);
    // Try parse dd/mm/yyyy or dd-mm-yyyy
    const cleaned = raw.replace(/[-]/g, "/");
    const parsed = parse(cleaned, "dd/MM/yyyy", new Date());
    if (isValid(parsed)) {
      onChange(format(parsed, "yyyy-MM-dd"));
      setMonthYear(parsed);
    }
  };

  const displayValue = selected ? format(selected, "dd / MM / yyyy") : "";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`${inputCls} flex items-center justify-between text-left ${!selected ? "text-muted-foreground" : ""}`}
        >
          <span>{displayValue || "Select date of birth"}</span>
          <CalendarIcon className="h-4 w-4 text-muted-foreground shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        {/* Month/Year quick-nav */}
        <div className="flex items-center gap-2 px-3 pt-3 pb-1">
          <select
            value={monthYear.getMonth()}
            onChange={e => setMonthYear(new Date(monthYear.getFullYear(), parseInt(e.target.value), 1))}
            className="flex-1 rounded-lg border border-input bg-card px-2 py-1 text-xs focus:outline-none"
          >
            {["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"].map((m, i) => (
              <option key={m} value={i}>{m}</option>
            ))}
          </select>
          <select
            value={monthYear.getFullYear()}
            onChange={e => setMonthYear(new Date(parseInt(e.target.value), monthYear.getMonth(), 1))}
            className="w-24 rounded-lg border border-input bg-card px-2 py-1 text-xs focus:outline-none"
          >
            {Array.from({ length: 30 }, (_, i) => new Date().getFullYear() - 3 - i).map(y => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>
        <CalendarPicker
          mode="single"
          selected={selected}
          onSelect={handleSelect}
          month={monthYear}
          onMonthChange={setMonthYear}
          disabled={(d) => d > new Date()}
          initialFocus
        />
        {/* Manual type fallback */}
        <div className="px-3 pb-3">
          <input
            placeholder="or type  dd/mm/yyyy"
            value={typed}
            onChange={handleTyped}
            className="w-full rounded-lg border border-input bg-muted/40 px-3 py-1.5 text-xs focus:outline-none"
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function CourseSelector({ phone, leadName, childDob, onDobChange, onComplete, existingSelections, existingSession, onCancel }: Props) {
  const { toast } = useToast();
  const portal = usePortal();
  const isSchoolPortal = portal.programCategories.includes("school");
  const isEditing = !!(existingSelections && existingSelections.length > 0);
  const [sessions, setSessions] = useState<{ id: string; name: string }[]>([]);
  const [courses, setCourses] = useState<any[]>([]);
  const [selectedSession, setSelectedSession] = useState(existingSession || '');
  const [selections, setSelections] = useState<CourseSelection[]>(existingSelections || []);
  const [addingCourse, setAddingCourse] = useState('');
  const [saving, setSaving] = useState(false);
  const [selectedSchool, setSelectedSchool] = useState('');

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
    return courses.filter((c: any) => {
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
    filteredCourses.forEach((c: any) => {
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
    const map = new Map<string, { label: string; courses: any[] }>();
    const sourceCourses = isSchoolPortal && selectedSchool
      ? filteredCourses.filter((c: any) => c.departments?.institutions?.id === selectedSchool)
      : filteredCourses;

    sourceCourses.forEach((c: any) => {
      // For school portals use institution name as group label; otherwise campus — dept
      const label = isSchoolPortal
        ? (c.departments?.institutions?.name || "Unknown School")
        : `${c.departments?.institutions?.campuses?.name || "Unknown"} — ${c.departments?.name || "Unknown"}`;
      if (!map.has(label)) map.set(label, { label, courses: [] });
      map.get(label)!.courses.push(c);
    });

    return Array.from(map.values()).map(group => ({
      ...group,
      courses: [...group.courses].sort((a: any, b: any) => {
        const rankA = getSchoolGradeSortRank(a.name || "", a.code || "", portal.id);
        const rankB = getSchoolGradeSortRank(b.name || "", b.code || "", portal.id);
        if (rankA !== rankB) return rankA - rankB;
        return (a.name || "").localeCompare(b.name || "");
      }),
    }));
  }, [filteredCourses, portal.id, isSchoolPortal, selectedSchool]);

  const addCourse = () => {
    if (!addingCourse) return;
    const course = filteredCourses.find((c: any) => c.id === addingCourse);
    if (!course || selections.some(s => s.course_id === addingCourse)) return;

    const campusName = course.departments?.institutions?.campuses?.name || '';
    const campusId = course.departments?.institutions?.campus_id || '';
    const programCat = determineProgramCategory(course.code, course.name);

    setSelections(prev => [
      ...prev,
      {
        course_id: course.id,
        campus_id: campusId,
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

  // Check if any selection has strict age block
  const hasStrictBlock = selections.some(s => {
    const v = getSelectionValidation(s);
    return v && !v.eligible && v.enforcement === "strict";
  });

  const handleContinue = async () => {
    if (!selectedSession || selections.length === 0) {
      toast({ title: 'Select session and at least one course', variant: 'destructive' });
      return;
    }
    if (hasStrictBlock) {
      toast({ title: 'Age requirement not met', description: 'Remove ineligible grades to continue.', variant: 'destructive' });
      return;
    }
    setSaving(true);

    const { data: existingLead } = await supabase
      .from("leads")
      .select("id")
      .eq("phone", phone)
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
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
            Child's Date of Birth *
          </label>
          <DobPicker
            value={childDob}
            onChange={onDobChange}
            inputCls={inputCls}
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
        <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
          <Calendar className="h-3.5 w-3.5 inline mr-1" /> Admission Session *
        </label>
        <select value={selectedSession} onChange={e => setSelectedSession(e.target.value)} className={inputCls}>
          <option value="">Select intake cycle</option>
          {sessions.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>

      {/* School selector — shown only for school portals with multiple schools */}
      {isSchoolPortal && schoolOptions.length > 1 && (
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
            <MapPin className="h-3.5 w-3.5 inline mr-1" /> Select Campus *
          </label>
          <select value={selectedSchool} onChange={e => { setSelectedSchool(e.target.value); setAddingCourse(''); }} className={inputCls}>
            <option value="">Select campus</option>
            {schoolOptions.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
      )}

      <div>
        <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
          {isSchoolPortal ? "Select Grade" : "Add Course"}
        </label>
        <div className="flex gap-2">
          <select
            value={addingCourse}
            onChange={e => setAddingCourse(e.target.value)}
            className={`${inputCls} flex-1`}
            disabled={isSchoolPortal && schoolOptions.length > 1 && !selectedSchool}
          >
            <option value="">{isSchoolPortal ? "Select grade to add" : "Select course to add"}</option>
            {coursesByGroup.map(g => (
              <optgroup key={g.label} label={g.label}>
                {g.courses.map((c: any) => {
                  const ageInfo = c.ageValidation;
                  const ineligible = ageInfo && !ageInfo.eligible && ageInfo.enforcement === "strict";
                  return (
                    <option
                      key={c.id}
                      value={c.id}
                      disabled={selections.some(s => s.course_id === c.id) || !!ineligible}
                    >
                      {c.name}{ageInfo && !ageInfo.eligible ? ` (Age: ${ageInfo.ageAsOfJuly31}y — ${ageInfo.enforcement === "strict" ? "ineligible" : "guidance"})` : ""}
                    </option>
                  );
                })}
              </optgroup>
            ))}
          </select>
          <Button onClick={addCourse} disabled={!addingCourse} size="icon" variant="outline">
            <Plus className="h-4 w-4" />
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

          <div className="flex items-center justify-between p-3 rounded-xl bg-primary/5 border border-primary/10">
            <span className="text-sm text-muted-foreground">Estimated Application Fee</span>
            <span className="text-lg font-bold text-foreground">
              {estimatedFee === 0 ? 'Free' : `₹${estimatedFee.toLocaleString('en-IN')}`}
            </span>
          </div>
        </div>
      )}

      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
        )}
        <Button onClick={handleContinue} disabled={saving || !selectedSession || selections.length === 0 || hasStrictBlock} className="gap-2">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
          {isEditing ? "Update Selections" : "Continue to Application"}
        </Button>
      </div>
    </div>
  );
}
