import { useState, useEffect, useMemo } from "react";
import { ArrowRight, Loader2, Calendar, MapPin, GripVertical, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { CourseSelection, determineProgramCategory, calculateFee } from "./types";
import { usePortal } from "./PortalContext";

interface Props {
  phone: string;
  leadName: string;
  onComplete: (sessionId: string, selections: CourseSelection[], leadId: string | null) => void;
}

const inputCls = "w-full rounded-xl border border-input bg-card py-2.5 px-4 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20";

export function CourseSelector({ phone, leadName, onComplete }: Props) {
  const { toast } = useToast();
  const portal = usePortal();
  const [sessions, setSessions] = useState<{ id: string; name: string }[]>([]);
  const [courses, setCourses] = useState<any[]>([]);
  const [selectedSession, setSelectedSession] = useState('');
  const [selections, setSelections] = useState<CourseSelection[]>([]);
  const [addingCourse, setAddingCourse] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([
      supabase.from("admission_sessions").select("id, name").eq("is_active", true).order("name"),
      supabase.from("courses").select(`
        id, name, code, department_id,
        departments!inner (
          id, name, institution_id,
          institutions!inner (
            id, name, campus_id,
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
  const filteredCourses = useMemo(() => {
    if (portal.gradeKeywords.length === 0 && portal.institutionTypes.length === 0) return courses;
    return courses.filter((c: any) => {
      // Filter by institution type
      if (portal.institutionTypes.length > 0) {
        const instType = c.departments?.institutions?.type?.toLowerCase() || "";
        if (!portal.institutionTypes.some(t => instType.includes(t))) return false;
      }
      // Filter by grade keywords
      if (portal.gradeKeywords.length > 0) {
        const nameAndCode = (c.name + " " + c.code).toLowerCase();
        if (!portal.gradeKeywords.some(kw => nameAndCode.includes(kw))) return false;
      }
      return true;
    });
  }, [courses, portal]);

  const coursesByGroup = useMemo(() => {
    const map = new Map<string, { label: string; courses: any[] }>();
    filteredCourses.forEach((c: any) => {
      const campusName = c.departments?.institutions?.campuses?.name || "Unknown";
      const deptName = c.departments?.name || "Unknown";
      const key = `${campusName} — ${deptName}`;
      if (!map.has(key)) map.set(key, { label: key, courses: [] });
      map.get(key)!.courses.push(c);
    });
    return Array.from(map.values());
  }, [filteredCourses]);

  const addCourse = () => {
    if (!addingCourse) return;
    const course = courses.find((c: any) => c.id === addingCourse);
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

  const estimatedFee = calculateFee(selections);

  const handleContinue = async () => {
    if (!selectedSession || selections.length === 0) {
      toast({ title: 'Select session and at least one course', variant: 'destructive' });
      return;
    }
    setSaving(true);

    // Find or create lead
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
        <p className="text-sm text-muted-foreground">Select your intake cycle and preferred courses to begin.</p>
      </div>

      <div>
        <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
          <Calendar className="h-3.5 w-3.5 inline mr-1" /> Admission Session *
        </label>
        <select value={selectedSession} onChange={e => setSelectedSession(e.target.value)} className={inputCls}>
          <option value="">Select intake cycle</option>
          {sessions.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>

      <div>
        <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Add Course</label>
        <div className="flex gap-2">
          <select value={addingCourse} onChange={e => setAddingCourse(e.target.value)} className={`${inputCls} flex-1`}>
            <option value="">Select course to add</option>
            {coursesByGroup.map(g => (
              <optgroup key={g.label} label={g.label}>
                {g.courses.map((c: any) => (
                  <option key={c.id} value={c.id} disabled={selections.some(s => s.course_id === c.id)}>
                    {c.name}
                  </option>
                ))}
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
          <label className="text-xs font-medium text-muted-foreground block">Selected Courses (drag to reorder preference)</label>
          {selections.map((s, i) => (
            <div key={s.course_id} className="flex items-center gap-3 p-3 rounded-xl bg-muted/50 border border-border/40">
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
          ))}

          <div className="flex items-center justify-between p-3 rounded-xl bg-primary/5 border border-primary/10">
            <span className="text-sm text-muted-foreground">Estimated Application Fee</span>
            <span className="text-lg font-bold text-foreground">
              {estimatedFee === 0 ? 'Free' : `₹${estimatedFee.toLocaleString('en-IN')}`}
            </span>
          </div>
        </div>
      )}

      <div className="flex justify-end">
        <Button onClick={handleContinue} disabled={saving || !selectedSession || selections.length === 0} className="gap-2">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
          Continue to Application
        </Button>
      </div>
    </div>
  );
}
