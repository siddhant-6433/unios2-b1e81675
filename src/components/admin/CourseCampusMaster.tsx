import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Building2, GraduationCap, Pencil, Check, X, Plus, Loader2,
  ChevronDown, ChevronRight, Shield, MapPin, Trash2, Power,
} from "lucide-react";
import EligibilityRuleDialog, { EligibilityRuleRow } from "./EligibilityRuleDialog";
import GeofenceDialog from "./GeofenceDialog";

interface Campus {
  id: string; name: string; code: string; city: string | null; state: string | null; address: string | null;
  latitude: number | null; longitude: number | null; geofence_radius_meters: number | null;
}
interface Institution {
  id: string; name: string; code: string; campus_id: string; type: string;
}
interface Department {
  id: string; name: string; code: string; institution_id: string;
}
interface Course {
  id: string; name: string; code: string; department_id: string; duration_years: number; type: string; is_active?: boolean;
}

export default function CourseCampusMaster() {
  const { toast } = useToast();
  const [campuses, setCampuses] = useState<Campus[]>([]);
  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [eligibilityRules, setEligibilityRules] = useState<Record<string, EligibilityRuleRow>>({});
  const [loading, setLoading] = useState(true);

  // Expand states — one at a time per level
  const [expandedInstitution, setExpandedInstitution] = useState<Set<string>>(new Set());
  const [expandedDept, setExpandedDept] = useState<Set<string>>(new Set());

  // Edit states
  const [editingInstitution, setEditingInstitution] = useState<string | null>(null);
  const [editingCourse, setEditingCourse] = useState<string | null>(null);
  const [institutionDraft, setInstitutionDraft] = useState<Partial<Institution>>({});
  const [courseDraft, setCourseDraft] = useState<Partial<Course>>({});

  // Add states
  const [addingCampus, setAddingCampus] = useState(false);
  const [addingDept, setAddingDept] = useState<string | null>(null);   // institution id
  const [addingCourse, setAddingCourse] = useState<string | null>(null); // dept id
  const [newCampus, setNewCampus] = useState({ name: "", code: "", city: "", state: "" });
  const [newDept, setNewDept] = useState({ name: "", code: "" });
  const [newCourse, setNewCourse] = useState({ name: "", code: "", duration_years: 3, type: "semester" });

  // Eligibility dialog
  const [ruleDialogOpen, setRuleDialogOpen] = useState(false);
  const [ruleDialogCourse, setRuleDialogCourse] = useState<{ id: string; name: string } | null>(null);

  // Geofence dialog
  const [geofenceCampus, setGeofenceCampus] = useState<Campus | null>(null);

  // Custom geofence locations
  interface CustomGeofence {
    id: string; name: string; description: string | null;
    latitude: number; longitude: number; radius_meters: number;
    is_active: boolean;
  }
  const [customGeofences, setCustomGeofences] = useState<CustomGeofence[]>([]);
  const [addingCustom, setAddingCustom] = useState(false);
  const [editingCustomGeofence, setEditingCustomGeofence] = useState<CustomGeofence | null>(null);

  useEffect(() => { fetchAll(); }, []);

  const fetchAll = async () => {
    setLoading(true);
    const [c, i, d, co, er, cg] = await Promise.all([
      supabase.from("campuses").select("*").order("name"),
      supabase.from("institutions").select("*").order("name"),
      supabase.from("departments").select("*").order("name"),
      supabase.from("courses").select("*").order("name"),
      supabase.from("eligibility_rules").select("*"),
      supabase.from("geofence_locations").select("*").order("name"),
    ]);
    if (c.data) setCampuses(c.data);
    if (i.data) setInstitutions(i.data);
    if (d.data) setDepartments(d.data);
    if (co.data) setCourses(co.data);
    if (er.data) {
      const map: Record<string, EligibilityRuleRow> = {};
      for (const row of er.data as unknown as EligibilityRuleRow[]) map[row.course_id] = row;
      setEligibilityRules(map);
    }
    if (cg.data) setCustomGeofences(cg.data as CustomGeofence[]);
    setLoading(false);
  };

  const toggleInstitution = (id: string) => {
    setExpandedInstitution(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleDept = (id: string) => {
    setExpandedDept(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const inputCls = "rounded-lg border border-input bg-background px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20";

  // ── Campus CRUD ──
  const addCampus = async () => {
    if (!newCampus.name || !newCampus.code) return;
    const { data: campusData, error } = await supabase.from("campuses").insert({
      name: newCampus.name, code: newCampus.code, city: newCampus.city || null, state: newCampus.state || null,
    }).select().single();
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    await supabase.from("institutions").insert({
      name: newCampus.name, code: newCampus.code, campus_id: campusData.id, type: "college",
    });
    toast({ title: "Campus added" }); setAddingCampus(false); setNewCampus({ name: "", code: "", city: "", state: "" }); fetchAll();
  };

  // ── Institution CRUD ──
  const saveInstitution = async (id: string) => {
    const { error } = await supabase.from("institutions").update(institutionDraft).eq("id", id);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Institution updated" }); setEditingInstitution(null); fetchAll();
  };

  // ── Department CRUD ──
  const addDepartment = async (institutionId: string) => {
    if (!newDept.name || !newDept.code) return;
    const { error } = await supabase.from("departments").insert({
      name: newDept.name, code: newDept.code, institution_id: institutionId,
    });
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Department added" }); setAddingDept(null); setNewDept({ name: "", code: "" }); fetchAll();
  };

  // ── Course CRUD ──
  const saveCourse = async (id: string) => {
    const { error } = await supabase.from("courses").update(courseDraft).eq("id", id);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Course updated" }); setEditingCourse(null); fetchAll();
  };

  const addCourse = async (deptId: string) => {
    if (!newCourse.name || !newCourse.code) return;
    const { error } = await supabase.from("courses").insert({
      name: newCourse.name, code: newCourse.code, department_id: deptId,
      duration_years: newCourse.duration_years, type: newCourse.type,
    });
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Course added" }); setAddingCourse(null); setNewCourse({ name: "", code: "", duration_years: 3, type: "semester" }); fetchAll();
  };

  const openRuleDialog = (course: Course) => {
    setRuleDialogCourse({ id: course.id, name: course.name });
    setRuleDialogOpen(true);
  };

  const renderRuleBadges = (courseId: string) => {
    const rule = eligibilityRules[courseId];
    if (!rule) return null;
    const badges: string[] = [];
    if (rule.min_age) badges.push(`Age ≥${rule.min_age}`);
    if (rule.max_age) badges.push(`Age ≤${rule.max_age}`);
    if (rule.class_12_min_marks) badges.push(`12th ≥${rule.class_12_min_marks}%`);
    if (rule.graduation_min_marks) badges.push(`Grad ≥${rule.graduation_min_marks}%`);
    if (rule.requires_graduation) badges.push("UG Req");
    if (rule.entrance_exam_required && rule.entrance_exam_name) badges.push(rule.entrance_exam_name);
    if (rule.subject_prerequisites?.length) badges.push(rule.subject_prerequisites.join("/"));
    if (!badges.length) return null;
    return (
      <div className="flex items-center gap-1 flex-wrap mt-1 pl-6">
        {badges.map((b, i) => (
          <Badge key={i} variant="outline" className="text-[9px] px-1.5 py-0 h-4 bg-primary/5 text-primary border-primary/20">{b}</Badge>
        ))}
      </div>
    );
  };

  if (loading) return (
    <div className="flex items-center justify-center py-16">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );

  // Group institutions by campus
  const campusMap = new Map(campuses.map(c => [c.id, c]));
  const institutionsByCampus = new Map<string, Institution[]>();
  for (const inst of institutions) {
    const arr = institutionsByCampus.get(inst.campus_id) || [];
    arr.push(inst);
    institutionsByCampus.set(inst.campus_id, arr);
  }
  // Also track "orphan" institutions (campus_id not in campuses list)
  const knownCampusIds = new Set(campuses.map(c => c.id));
  const orphanInstitutions = institutions.filter(i => !knownCampusIds.has(i.campus_id));

  const renderDepartments = (inst: Institution) => {
    const instDepts = departments.filter(d => d.institution_id === inst.id);
    return (
      <>
        {instDepts.map(dept => {
          const deptCourses = courses.filter(co => co.department_id === dept.id);
          const isDeptExpanded = expandedDept.has(dept.id);
          return (
            <div key={dept.id} className="border-b border-border/40 last:border-0">
              {/* Department row */}
              <div
                className="flex items-center gap-2.5 py-2.5 px-4 cursor-pointer hover:bg-muted/20 transition-colors"
                onClick={() => toggleDept(dept.id)}
              >
                {isDeptExpanded
                  ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                <span className="text-sm font-medium text-foreground">{dept.name}</span>
                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{dept.code}</span>
                <span className="text-xs text-muted-foreground ml-auto">{deptCourses.length} courses</span>
              </div>

              {/* Courses */}
              {isDeptExpanded && (
                <div className="pb-2 pl-8">
                  {deptCourses.map(course => {
                    const isCourseEditing = editingCourse === course.id;
                    const hasRule = !!eligibilityRules[course.id];
                    return (
                      <div key={course.id} className="mb-1">
                        <div className="flex items-center gap-2.5 py-1.5 px-3 rounded-lg hover:bg-muted/30 group">
                          <GraduationCap className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          {isCourseEditing ? (
                            <div className="flex items-center gap-2 flex-1" onClick={e => e.stopPropagation()}>
                              <input value={courseDraft.name || ""} onChange={e => setCourseDraft({ ...courseDraft, name: e.target.value })} className={`${inputCls} flex-1`} />
                              <input value={courseDraft.code || ""} onChange={e => setCourseDraft({ ...courseDraft, code: e.target.value })} className={`${inputCls} w-20`} placeholder="Code" />
                              <input type="number" value={courseDraft.duration_years || 1} onChange={e => setCourseDraft({ ...courseDraft, duration_years: Number(e.target.value) })} className={`${inputCls} w-14`} min={1} />
                              <button onClick={() => saveCourse(course.id)} className="text-primary p-0.5"><Check className="h-3.5 w-3.5" /></button>
                              <button onClick={() => setEditingCourse(null)} className="text-muted-foreground p-0.5"><X className="h-3.5 w-3.5" /></button>
                            </div>
                          ) : (
                            <>
                              <span className="text-sm text-foreground flex-1 leading-snug">{course.name}</span>
                              <span className="text-[10px] text-muted-foreground shrink-0 hidden sm:block">
                                {course.code} · {course.duration_years}yr · {course.type}
                              </span>
                              <span className={`h-2 w-2 rounded-full shrink-0 ${course.is_active !== false ? 'bg-emerald-500' : 'bg-muted-foreground/40'}`} title={course.is_active !== false ? 'Active' : 'Inactive'} />
                              <button
                                onClick={e => { e.stopPropagation(); openRuleDialog(course); }}
                                className={`p-0.5 transition-opacity ${hasRule ? 'text-primary' : 'text-muted-foreground opacity-0 group-hover:opacity-100'}`}
                                title="Eligibility Rules"
                              >
                                <Shield className="h-3.5 w-3.5" />
                              </button>
                              <button
                                onClick={e => { e.stopPropagation(); setEditingCourse(course.id); setCourseDraft({ name: course.name, code: course.code, duration_years: course.duration_years }); }}
                                className="text-muted-foreground hover:text-primary p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                              >
                                <Pencil className="h-3 w-3" />
                              </button>
                            </>
                          )}
                        </div>
                        {renderRuleBadges(course.id)}
                      </div>
                    );
                  })}

                  {/* Add Course */}
                  {addingCourse === dept.id ? (
                    <div className="flex items-center gap-2 px-3 pt-1 flex-wrap">
                      <input placeholder="Course name *" value={newCourse.name} onChange={e => setNewCourse({ ...newCourse, name: e.target.value })} className={`${inputCls} flex-1 min-w-32`} />
                      <input placeholder="Code *" value={newCourse.code} onChange={e => setNewCourse({ ...newCourse, code: e.target.value })} className={`${inputCls} w-20`} />
                      <input type="number" value={newCourse.duration_years} onChange={e => setNewCourse({ ...newCourse, duration_years: Number(e.target.value) })} className={`${inputCls} w-14`} min={1} />
                      <select value={newCourse.type} onChange={e => setNewCourse({ ...newCourse, type: e.target.value })} className={`${inputCls} w-24`}>
                        <option value="semester">Semester</option>
                        <option value="annual">Annual</option>
                        <option value="quarterly">Quarterly</option>
                      </select>
                      <button onClick={() => addCourse(dept.id)} className="text-primary p-0.5"><Check className="h-3.5 w-3.5" /></button>
                      <button onClick={() => setAddingCourse(null)} className="text-muted-foreground p-0.5"><X className="h-3.5 w-3.5" /></button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setAddingCourse(dept.id)}
                      className="flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 px-3 pt-1 pb-0.5 transition-colors"
                    >
                      <Plus className="h-3 w-3" /> Add Course
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* Add Department */}
        {addingDept === inst.id ? (
          <div className="flex items-center gap-2 px-4 py-3">
            <input placeholder="Department name *" value={newDept.name} onChange={e => setNewDept({ ...newDept, name: e.target.value })} className={`${inputCls} flex-1`} />
            <input placeholder="Code *" value={newDept.code} onChange={e => setNewDept({ ...newDept, code: e.target.value })} className={`${inputCls} w-24`} />
            <button onClick={() => addDepartment(inst.id)} className="text-primary p-0.5"><Check className="h-3.5 w-3.5" /></button>
            <button onClick={() => setAddingDept(null)} className="text-muted-foreground p-0.5"><X className="h-3.5 w-3.5" /></button>
          </div>
        ) : (
          <button
            onClick={() => setAddingDept(inst.id)}
            className="flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 px-4 py-3 transition-colors"
          >
            <Plus className="h-3 w-3" /> Add Department
          </button>
        )}
      </>
    );
  };

  const renderInstitutionCard = (inst: Institution, campus?: Campus) => {
    const instDepts = departments.filter(d => d.institution_id === inst.id);
    const courseCount = courses.filter(co => instDepts.some(d => d.id === co.department_id)).length;
    const isExpanded = expandedInstitution.has(inst.id);
    const isEditing = editingInstitution === inst.id;

    return (
      <Card key={inst.id} className="border-border/60 overflow-hidden">
        {/* Institution header */}
        <div
          className="flex items-center gap-3 px-5 py-4 cursor-pointer hover:bg-muted/30 transition-colors"
          onClick={() => !isEditing && toggleInstitution(inst.id)}
        >
          {isExpanded
            ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
            : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
          <Building2 className="h-5 w-5 text-primary shrink-0" />

          <div className="flex-1 min-w-0">
            {isEditing ? (
              <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                <input value={institutionDraft.name || ""} onChange={e => setInstitutionDraft({ ...institutionDraft, name: e.target.value })} className={`${inputCls} flex-1`} placeholder="Name" />
                <input value={institutionDraft.code || ""} onChange={e => setInstitutionDraft({ ...institutionDraft, code: e.target.value })} className={`${inputCls} w-28`} placeholder="Code" />
                <button onClick={() => saveInstitution(inst.id)} className="text-primary p-1"><Check className="h-4 w-4" /></button>
                <button onClick={() => setEditingInstitution(null)} className="text-muted-foreground p-1"><X className="h-4 w-4" /></button>
              </div>
            ) : (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-foreground text-sm leading-snug">{inst.name}</span>
                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">{inst.code}</span>
                {campus && (campus.city || campus.state) && (
                  <span className="flex items-center gap-0.5 text-xs text-muted-foreground">
                    <MapPin className="h-3 w-3" />
                    {[campus.city, campus.state].filter(Boolean).join(", ")}
                  </span>
                )}
              </div>
            )}
          </div>

          <span className="text-xs text-muted-foreground shrink-0 hidden sm:block">
            {instDepts.length} depts · {courseCount} courses
          </span>
          {!isEditing && (
            <button
              onClick={e => { e.stopPropagation(); setEditingInstitution(inst.id); setInstitutionDraft({ name: inst.name, code: inst.code }); }}
              className="text-muted-foreground hover:text-primary p-1 shrink-0 transition-colors"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Departments & Courses */}
        {isExpanded && (
          <div className="border-t border-border/60">
            {renderDepartments(inst)}
          </div>
        )}
      </Card>
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Manage your institution hierarchy: Institution → Department → Course</p>
        <Button onClick={() => setAddingCampus(true)} size="sm" className="gap-1.5 rounded-xl">
          <Plus className="h-3.5 w-3.5" /> Add Campus
        </Button>
      </div>

      {/* Add Campus form */}
      {addingCampus && (
        <Card className="border-primary/30">
          <CardContent className="p-4 space-y-2">
            <p className="text-sm font-semibold text-foreground">New Campus</p>
            <div className="grid grid-cols-2 gap-2">
              <input placeholder="Name *" value={newCampus.name} onChange={e => setNewCampus({ ...newCampus, name: e.target.value })} className={inputCls} />
              <input placeholder="Code *" value={newCampus.code} onChange={e => setNewCampus({ ...newCampus, code: e.target.value })} className={inputCls} />
              <input placeholder="City" value={newCampus.city} onChange={e => setNewCampus({ ...newCampus, city: e.target.value })} className={inputCls} />
              <input placeholder="State" value={newCampus.state} onChange={e => setNewCampus({ ...newCampus, state: e.target.value })} className={inputCls} />
            </div>
            <div className="flex gap-2">
              <Button onClick={addCampus} size="sm" disabled={!newCampus.name || !newCampus.code} className="gap-1 h-8 rounded-lg">
                <Check className="h-3.5 w-3.5" /> Add
              </Button>
              <Button onClick={() => setAddingCampus(false)} size="sm" variant="ghost" className="h-8 rounded-lg">
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Campuses and their institutions */}
      {campuses.map(campus => {
        const campusInstitutions = institutionsByCampus.get(campus.id) || [];
        if (campusInstitutions.length === 0) {
          return (
            <div key={campus.id}>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{campus.name}</span>
                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{campus.code}</span>
                {(campus.city || campus.state) && (
                  <span className="text-xs text-muted-foreground">{[campus.city, campus.state].filter(Boolean).join(", ")}</span>
                )}
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setGeofenceCampus(campus); }}
                  className={`relative z-10 flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1 rounded-lg cursor-pointer border transition-colors ${
                    campus.latitude
                      ? "bg-pastel-green border-green-200 text-green-800 hover:bg-green-100"
                      : "bg-pastel-yellow border-yellow-200 text-yellow-800 hover:bg-yellow-100"
                  }`}
                >
                  <MapPin className="h-3 w-3" />
                  {campus.latitude ? `Geofence: ${campus.geofence_radius_meters || 500}m` : "Set Geofence"}
                </button>
                <span className="text-xs text-muted-foreground">— no institutions</span>
              </div>
            </div>
          );
        }
        return (
          <div key={campus.id} className="space-y-2">
            {/* Campus label */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{campus.name}</span>
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{campus.code}</span>
              {(campus.city || campus.state) && (
                <span className="flex items-center gap-0.5 text-xs text-muted-foreground">
                  <MapPin className="h-3 w-3" />
                  {[campus.city, campus.state].filter(Boolean).join(", ")}
                </span>
              )}
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setGeofenceCampus(campus); }}
                className={`relative z-10 flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1 rounded-lg cursor-pointer border transition-colors ${
                  campus.latitude
                    ? "bg-pastel-green border-green-200 text-green-800 hover:bg-green-100"
                    : "bg-pastel-yellow border-yellow-200 text-yellow-800 hover:bg-yellow-100"
                }`}
              >
                <MapPin className="h-3 w-3" />
                {campus.latitude ? `Geofence: ${campus.geofence_radius_meters || 500}m` : "Set Geofence"}
              </button>
            </div>
            {/* Institution cards */}
            {campusInstitutions.map(inst => renderInstitutionCard(inst, campus))}
          </div>
        );
      })}

      {/* Orphan institutions (campus deleted or not linked) */}
      {orphanInstitutions.length > 0 && (
        <div className="space-y-2">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Other Institutions</span>
          {orphanInstitutions.map(inst => renderInstitutionCard(inst))}
        </div>
      )}

      {/* Additional Geofence Locations */}
      <div className="space-y-3 pt-4 border-t border-border/60">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Additional Geofence Locations</h3>
            <p className="text-xs text-muted-foreground mt-0.5">Satellite offices, event venues, or partner locations where employees can punch in</p>
          </div>
          <Button onClick={() => setAddingCustom(true)} size="sm" variant="outline" className="gap-1.5 rounded-xl">
            <Plus className="h-3.5 w-3.5" /> Add Location
          </Button>
        </div>

        {/* Add form */}
        {addingCustom && (
          <CustomGeofenceForm
            onSave={async (data) => {
              const { error } = await supabase.from("geofence_locations").insert(data);
              if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
              toast({ title: "Location added" });
              setAddingCustom(false);
              fetchAll();
            }}
            onCancel={() => setAddingCustom(false)}
          />
        )}

        {/* Edit form */}
        {editingCustomGeofence && (
          <CustomGeofenceForm
            initial={editingCustomGeofence}
            onSave={async (data) => {
              const { error } = await supabase.from("geofence_locations").update(data).eq("id", editingCustomGeofence.id);
              if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
              toast({ title: "Location updated" });
              setEditingCustomGeofence(null);
              fetchAll();
            }}
            onCancel={() => setEditingCustomGeofence(null)}
          />
        )}

        {/* List */}
        {customGeofences.length === 0 && !addingCustom ? (
          <div className="rounded-xl border border-dashed border-border py-8 text-center">
            <MapPin className="h-6 w-6 text-muted-foreground/30 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">No additional locations configured</p>
          </div>
        ) : (
          <div className="space-y-2">
            {customGeofences.map((loc) => (
              <Card key={loc.id} className="border-border/60">
                <CardContent className="p-4 flex items-center gap-3">
                  <div className={`flex h-9 w-9 items-center justify-center rounded-lg shrink-0 ${loc.is_active ? "bg-pastel-green" : "bg-muted"}`}>
                    <MapPin className={`h-4 w-4 ${loc.is_active ? "text-green-700" : "text-muted-foreground"}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-foreground">{loc.name}</span>
                      {!loc.is_active && (
                        <Badge className="text-[9px] border-0 bg-muted text-muted-foreground">Disabled</Badge>
                      )}
                    </div>
                    {loc.description && <p className="text-xs text-muted-foreground truncate">{loc.description}</p>}
                    <p className="text-[10px] text-muted-foreground font-mono mt-0.5">
                      {loc.latitude.toFixed(4)}, {loc.longitude.toFixed(4)} · {loc.radius_meters}m
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => setEditingCustomGeofence(loc)}
                      className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-muted transition-colors"
                      title="Edit"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={async () => {
                        await supabase.from("geofence_locations").update({ is_active: !loc.is_active }).eq("id", loc.id);
                        fetchAll();
                      }}
                      className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                      title={loc.is_active ? "Disable" : "Enable"}
                    >
                      <Power className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={async () => {
                        if (!confirm(`Delete "${loc.name}"?`)) return;
                        await supabase.from("geofence_locations").delete().eq("id", loc.id);
                        fetchAll();
                      }}
                      className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                      title="Delete"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Empty state */}
      {campuses.length === 0 && institutions.length === 0 && (
        <div className="text-center py-16 text-muted-foreground text-sm">
          No campuses or institutions found. Click <strong>Add Campus</strong> to get started.
        </div>
      )}

      {/* Geofence Dialog */}
      {geofenceCampus && (
        <GeofenceDialog
          open={!!geofenceCampus}
          onClose={() => setGeofenceCampus(null)}
          campus={geofenceCampus}
          onSaved={fetchAll}
        />
      )}

      {/* Eligibility Rule Dialog */}
      {ruleDialogCourse && (
        <EligibilityRuleDialog
          open={ruleDialogOpen}
          onOpenChange={setRuleDialogOpen}
          courseId={ruleDialogCourse.id}
          courseName={ruleDialogCourse.name}
          existingRule={eligibilityRules[ruleDialogCourse.id] || null}
          onSaved={fetchAll}
        />
      )}
    </div>
  );
}

// ── Inline form for custom geofence locations ──
function CustomGeofenceForm({ initial, onSave, onCancel }: {
  initial?: { name: string; description: string | null; latitude: number; longitude: number; radius_meters: number };
  onSave: (data: { name: string; description: string | null; latitude: number; longitude: number; radius_meters: number }) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name || "");
  const [description, setDescription] = useState(initial?.description || "");
  const [coords, setCoords] = useState(
    initial ? `${initial.latitude}, ${initial.longitude}` : ""
  );
  const [radius, setRadius] = useState(initial?.radius_meters || 200);
  const [saving, setSaving] = useState(false);

  const parsedCoords = coords.match(/(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)/);
  const isValid = name.trim() && parsedCoords;

  const handleSubmit = async () => {
    if (!parsedCoords) return;
    setSaving(true);
    await onSave({
      name: name.trim(),
      description: description.trim() || null,
      latitude: parseFloat(parsedCoords[1]),
      longitude: parseFloat(parsedCoords[2]),
      radius_meters: radius,
    });
    setSaving(false);
  };

  const inputCls = "rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20";

  return (
    <Card className="border-primary/30">
      <CardContent className="p-4 space-y-3">
        <p className="text-sm font-semibold text-foreground">{initial ? "Edit Location" : "New Location"}</p>
        <div className="grid grid-cols-2 gap-3">
          <input placeholder="Location name *" value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
          <input placeholder="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} className={inputCls} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <input
              placeholder="Paste coordinates: 28.467, 77.508"
              value={coords}
              onChange={(e) => setCoords(e.target.value)}
              className={`${inputCls} w-full font-mono`}
            />
            <p className="text-[10px] text-muted-foreground mt-1">Right-click Google Maps → copy coordinates</p>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="range" min="50" max="2000" step="50"
              value={radius}
              onChange={(e) => setRadius(parseInt(e.target.value))}
              className="flex-1 accent-primary"
            />
            <span className="text-sm font-mono text-foreground w-14 text-right">{radius}m</span>
          </div>
        </div>
        <div className="flex gap-2">
          <Button onClick={handleSubmit} size="sm" disabled={!isValid || saving} className="gap-1 h-8 rounded-lg">
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            {initial ? "Update" : "Add"}
          </Button>
          <Button onClick={onCancel} size="sm" variant="ghost" className="h-8 rounded-lg">
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
