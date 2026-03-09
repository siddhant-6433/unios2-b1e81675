import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Building2, GraduationCap, Pencil, Check, X, Plus, Trash2, Loader2, ChevronDown, ChevronRight,
} from "lucide-react";

interface Campus {
  id: string; name: string; code: string; city: string | null; state: string | null; address: string | null;
}
interface Institution {
  id: string; name: string; code: string; campus_id: string; type: string;
}
interface Department {
  id: string; name: string; code: string; institution_id: string;
}
interface Course {
  id: string; name: string; code: string; department_id: string; duration_years: number; type: string;
}

export default function CourseCampusMaster() {
  const { toast } = useToast();
  const [campuses, setCampuses] = useState<Campus[]>([]);
  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedCampus, setExpandedCampus] = useState<string | null>(null);
  const [expandedDept, setExpandedDept] = useState<string | null>(null);

  // Edit states
  const [editingCampus, setEditingCampus] = useState<string | null>(null);
  const [editingCourse, setEditingCourse] = useState<string | null>(null);
  const [campusDraft, setCampusDraft] = useState<Partial<Campus>>({});
  const [courseDraft, setCourseDraft] = useState<Partial<Course>>({});

  // Add states
  const [addingCampus, setAddingCampus] = useState(false);
  const [addingDept, setAddingDept] = useState<string | null>(null); // institution_id
  const [addingCourse, setAddingCourse] = useState<string | null>(null); // department_id
  const [newCampus, setNewCampus] = useState({ name: "", code: "", city: "", state: "" });
  const [newDept, setNewDept] = useState({ name: "", code: "" });
  const [newCourse, setNewCourse] = useState({ name: "", code: "", duration_years: 3, type: "semester" });

  useEffect(() => { fetchAll(); }, []);

  const fetchAll = async () => {
    setLoading(true);
    const [c, i, d, co] = await Promise.all([
      supabase.from("campuses").select("*").order("name"),
      supabase.from("institutions").select("*").order("name"),
      supabase.from("departments").select("*").order("name"),
      supabase.from("courses").select("*").order("name"),
    ]);
    if (c.data) setCampuses(c.data);
    if (i.data) setInstitutions(i.data);
    if (d.data) setDepartments(d.data);
    if (co.data) setCourses(co.data);
    setLoading(false);
  };

  const inputCls = "rounded-lg border border-input bg-background px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20";

  // ── Campus CRUD ──
  const saveCampus = async (id: string) => {
    const { error } = await supabase.from("campuses").update(campusDraft).eq("id", id);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Campus updated" }); setEditingCampus(null); fetchAll();
  };

  const addCampus = async () => {
    if (!newCampus.name || !newCampus.code) return;
    // Also create a default institution for the campus
    const { data: campusData, error } = await supabase.from("campuses").insert({
      name: newCampus.name, code: newCampus.code, city: newCampus.city || null, state: newCampus.state || null,
    }).select().single();
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    // Create default institution
    await supabase.from("institutions").insert({
      name: newCampus.name, code: newCampus.code, campus_id: campusData.id, type: "college",
    });
    toast({ title: "Campus added" }); setAddingCampus(false); setNewCampus({ name: "", code: "", city: "", state: "" }); fetchAll();
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

  if (loading) return <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Manage your campus hierarchy: Campus → Department → Course</p>
        <Button onClick={() => setAddingCampus(true)} size="sm" className="gap-1.5 rounded-xl">
          <Plus className="h-3.5 w-3.5" /> Add Campus
        </Button>
      </div>

      {/* Add campus form */}
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
              <Button onClick={addCampus} size="sm" disabled={!newCampus.name || !newCampus.code} className="gap-1 h-8 rounded-lg"><Check className="h-3.5 w-3.5" /> Add</Button>
              <Button onClick={() => setAddingCampus(false)} size="sm" variant="ghost" className="h-8 rounded-lg"><X className="h-3.5 w-3.5" /></Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Campus tree */}
      {campuses.map(campus => {
        const isExpanded = expandedCampus === campus.id;
        const campusInstitutions = institutions.filter(i => i.campus_id === campus.id);
        const campusDepts = departments.filter(d => campusInstitutions.some(i => i.id === d.institution_id));
        const courseCount = courses.filter(co => campusDepts.some(d => d.id === co.department_id)).length;
        const isEditing = editingCampus === campus.id;

        return (
          <Card key={campus.id} className="border-border/60 overflow-hidden">
            <div
              className="flex items-center gap-3 px-5 py-4 cursor-pointer hover:bg-muted/30 transition-colors"
              onClick={() => setExpandedCampus(isExpanded ? null : campus.id)}
            >
              {isExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
              <Building2 className="h-5 w-5 text-primary shrink-0" />
              <div className="flex-1 min-w-0">
                {isEditing ? (
                  <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                    <input value={campusDraft.name || ""} onChange={e => setCampusDraft({ ...campusDraft, name: e.target.value })} className={`${inputCls} flex-1`} />
                    <input value={campusDraft.city || ""} onChange={e => setCampusDraft({ ...campusDraft, city: e.target.value })} placeholder="City" className={`${inputCls} w-28`} />
                    <input value={campusDraft.state || ""} onChange={e => setCampusDraft({ ...campusDraft, state: e.target.value })} placeholder="State" className={`${inputCls} w-28`} />
                    <button onClick={() => saveCampus(campus.id)} className="text-primary p-1"><Check className="h-4 w-4" /></button>
                    <button onClick={() => setEditingCampus(null)} className="text-muted-foreground p-1"><X className="h-4 w-4" /></button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-foreground">{campus.name}</span>
                    <span className="text-xs text-muted-foreground">({campus.code})</span>
                    {campus.city && <span className="text-xs text-muted-foreground">· {campus.city}{campus.state ? `, ${campus.state}` : ""}</span>}
                  </div>
                )}
              </div>
              <span className="text-xs text-muted-foreground shrink-0">{campusDepts.length} depts · {courseCount} courses</span>
              {!isEditing && (
                <button onClick={e => { e.stopPropagation(); setEditingCampus(campus.id); setCampusDraft({ name: campus.name, city: campus.city, state: campus.state }); }}
                  className="text-muted-foreground hover:text-primary p-1 shrink-0"><Pencil className="h-3.5 w-3.5" /></button>
              )}
            </div>

            {isExpanded && (
              <div className="border-t border-border">
                {campusInstitutions.map(inst => {
                  const instDepts = departments.filter(d => d.institution_id === inst.id);
                  return (
                    <div key={inst.id} className="pl-12 pr-5">
                      {instDepts.map(dept => {
                        const deptCourses = courses.filter(co => co.department_id === dept.id);
                        const isDeptExpanded = expandedDept === dept.id;
                        return (
                          <div key={dept.id} className="border-b border-border/50 last:border-0">
                            <div
                              className="flex items-center gap-3 py-3 cursor-pointer hover:bg-muted/20 transition-colors"
                              onClick={() => setExpandedDept(isDeptExpanded ? null : dept.id)}
                            >
                              {isDeptExpanded ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
                              <span className="text-sm font-medium text-foreground">{dept.name}</span>
                              <span className="text-[11px] text-muted-foreground">({dept.code}) · {deptCourses.length} courses</span>
                            </div>

                            {isDeptExpanded && (
                              <div className="pl-7 pb-3 space-y-1">
                                {deptCourses.map(course => {
                                  const isCourseEditing = editingCourse === course.id;
                                  return (
                                    <div key={course.id} className="flex items-center gap-3 py-1.5 px-3 rounded-lg hover:bg-muted/30 group">
                                      <GraduationCap className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                      {isCourseEditing ? (
                                        <div className="flex items-center gap-2 flex-1" onClick={e => e.stopPropagation()}>
                                          <input value={courseDraft.name || ""} onChange={e => setCourseDraft({ ...courseDraft, name: e.target.value })} className={`${inputCls} flex-1`} />
                                          <input value={courseDraft.code || ""} onChange={e => setCourseDraft({ ...courseDraft, code: e.target.value })} className={`${inputCls} w-20`} placeholder="Code" />
                                          <input type="number" value={courseDraft.duration_years || 1} onChange={e => setCourseDraft({ ...courseDraft, duration_years: Number(e.target.value) })} className={`${inputCls} w-16`} min={1} />
                                          <button onClick={() => saveCourse(course.id)} className="text-primary p-0.5"><Check className="h-3.5 w-3.5" /></button>
                                          <button onClick={() => setEditingCourse(null)} className="text-muted-foreground p-0.5"><X className="h-3.5 w-3.5" /></button>
                                        </div>
                                      ) : (
                                        <>
                                          <span className="text-sm text-foreground flex-1">{course.name}</span>
                                          <span className="text-[11px] text-muted-foreground">{course.code} · {course.duration_years}yr · {course.type}</span>
                                          <button onClick={e => { e.stopPropagation(); setEditingCourse(course.id); setCourseDraft({ name: course.name, code: course.code, duration_years: course.duration_years }); }}
                                            className="text-muted-foreground hover:text-primary p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"><Pencil className="h-3 w-3" /></button>
                                        </>
                                      )}
                                    </div>
                                  );
                                })}

                                {/* Add course form */}
                                {addingCourse === dept.id ? (
                                  <div className="flex items-center gap-2 px-3 pt-1">
                                    <input placeholder="Course name *" value={newCourse.name} onChange={e => setNewCourse({ ...newCourse, name: e.target.value })} className={`${inputCls} flex-1`} />
                                    <input placeholder="Code *" value={newCourse.code} onChange={e => setNewCourse({ ...newCourse, code: e.target.value })} className={`${inputCls} w-20`} />
                                    <input type="number" value={newCourse.duration_years} onChange={e => setNewCourse({ ...newCourse, duration_years: Number(e.target.value) })} className={`${inputCls} w-16`} min={1} />
                                    <select value={newCourse.type} onChange={e => setNewCourse({ ...newCourse, type: e.target.value })} className={`${inputCls} w-24`}>
                                      <option value="semester">Semester</option>
                                      <option value="annual">Annual</option>
                                      <option value="quarterly">Quarterly</option>
                                    </select>
                                    <button onClick={() => addCourse(dept.id)} className="text-primary p-0.5"><Check className="h-3.5 w-3.5" /></button>
                                    <button onClick={() => setAddingCourse(null)} className="text-muted-foreground p-0.5"><X className="h-3.5 w-3.5" /></button>
                                  </div>
                                ) : (
                                  <button onClick={() => setAddingCourse(dept.id)}
                                    className="flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 px-3 pt-1 transition-colors">
                                    <Plus className="h-3 w-3" /> Add Course
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}

                      {/* Add department */}
                      {addingDept === inst.id ? (
                        <div className="flex items-center gap-2 py-3">
                          <input placeholder="Department name *" value={newDept.name} onChange={e => setNewDept({ ...newDept, name: e.target.value })} className={`${inputCls} flex-1`} />
                          <input placeholder="Code *" value={newDept.code} onChange={e => setNewDept({ ...newDept, code: e.target.value })} className={`${inputCls} w-20`} />
                          <button onClick={() => addDepartment(inst.id)} className="text-primary p-0.5"><Check className="h-3.5 w-3.5" /></button>
                          <button onClick={() => setAddingDept(null)} className="text-muted-foreground p-0.5"><X className="h-3.5 w-3.5" /></button>
                        </div>
                      ) : (
                        <button onClick={() => setAddingDept(inst.id)}
                          className="flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 py-3 transition-colors">
                          <Plus className="h-3 w-3" /> Add Department
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}
