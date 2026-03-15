import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { 
  Shield, Search, Loader2, GraduationCap, Building2, Pencil, Filter
} from "lucide-react";
import EligibilityRuleDialog, { EligibilityRuleRow } from "./EligibilityRuleDialog";

interface CourseWithInfo {
  id: string;
  name: string;
  code: string;
  department_name: string;
  institution_name: string;
  campus_name: string;
}

export default function EligibilityConfigPanel() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [courses, setCourses] = useState<CourseWithInfo[]>([]);
  const [rules, setRules] = useState<Record<string, EligibilityRuleRow>>({});
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState<"all" | "with_rules" | "no_rules">("all");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedCourse, setSelectedCourse] = useState<{ id: string; name: string } | null>(null);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const { data: coursesData, error: coursesError } = await supabase
        .from("courses")
        .select(`
          id, name, code,
          departments (
            name,
            institutions (
              name,
              campuses (name)
            )
          )
        `);

      if (coursesData) {
        const flattened: CourseWithInfo[] = (coursesData as any[]).map(c => ({
          id: c.id,
          name: c.name,
          code: c.code,
          department_name: c.departments?.name || "N/A",
          institution_name: c.departments?.institutions?.name || "N/A",
          campus_name: c.departments?.institutions?.campuses?.name || "N/A"
        }));
        setCourses(flattened);
      }

      const { data: rulesData, error: rulesError } = await supabase
        .from("eligibility_rules")
        .select("*");

      if (rulesData) {
        const map: Record<string, EligibilityRuleRow> = {};
        rulesData.forEach((r: any) => {
          map[r.course_id] = r;
        });
        setRules(map);
      }
    } catch (err: any) {
      toast({ title: "Error fetching data", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const filteredCourses = courses.filter(c => {
    const matchesSearch = 
      c.name.toLowerCase().includes(search.toLowerCase()) || 
      c.code.toLowerCase().includes(search.toLowerCase()) ||
      c.campus_name.toLowerCase().includes(search.toLowerCase());
    
    const hasRule = !!rules[c.id];
    const matchesFilter = 
      filterType === "all" || 
      (filterType === "with_rules" && hasRule) || 
      (filterType === "no_rules" && !hasRule);
    
    return matchesSearch && matchesFilter;
  });

  const openEditor = (course: CourseWithInfo) => {
    setSelectedCourse({ id: course.id, name: course.name });
    setDialogOpen(true);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="relative w-full sm:max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search by course, code or campus..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-xl border border-input bg-card pl-10 pr-4 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 shadow-sm"
          />
        </div>
        
        <div className="flex items-center gap-2 bg-muted/30 p-1 rounded-xl border border-border/50">
          <button
            onClick={() => setFilterType("all")}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${filterType === "all" ? "bg-white text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
          >
            All
          </button>
          <button
            onClick={() => setFilterType("with_rules")}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${filterType === "with_rules" ? "bg-white text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
          >
            With Rules
          </button>
          <button
            onClick={() => setFilterType("no_rules")}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${filterType === "no_rules" ? "bg-white text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
          >
            No Rules
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {filteredCourses.map(course => {
          const rule = rules[course.id];
          return (
            <Card key={course.id} className="border-border/60 hover:border-primary/30 transition-all overflow-hidden group">
              <CardContent className="p-0">
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center p-4 gap-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/5 text-primary shrink-0 group-hover:bg-primary/10 transition-colors">
                    <GraduationCap className="h-6 w-6" />
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-sm font-bold text-foreground truncate">{course.name}</h3>
                      <Badge variant="outline" className="text-[10px] py-0 h-4 bg-muted/30">{course.code}</Badge>
                    </div>
                    <div className="flex flex-wrap items-center gap-y-1 gap-x-3 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1.5">
                        <Building2 className="h-3.5 w-3.5" />
                        {course.campus_name}
                      </span>
                      <span className="text-muted-foreground/30">•</span>
                      <span>{course.department_name}</span>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 sm:max-w-[40%]">
                    {rule ? (
                      <>
                        {rule.min_age && <Badge variant="secondary" className="text-[10px] bg-pastel-blue/30 text-foreground/80 hover:bg-pastel-blue/40 border-none">Age ≥{rule.min_age}</Badge>}
                        {rule.max_age && <Badge variant="secondary" className="text-[10px] bg-pastel-blue/30 text-foreground/80 hover:bg-pastel-blue/40 border-none">Age ≤{rule.max_age}</Badge>}
                        {rule.class_12_min_marks && <Badge variant="secondary" className="text-[10px] bg-pastel-green/30 text-foreground/80 hover:bg-pastel-green/40 border-none">12th ≥{rule.class_12_min_marks}%</Badge>}
                        {rule.requires_graduation && <Badge variant="secondary" className="text-[10px] bg-pastel-yellow/30 text-foreground/80 hover:bg-pastel-yellow/40 border-none">UG Req</Badge>}
                        {rule.entrance_exam_required && <Badge variant="secondary" className="text-[10px] bg-pastel-purple/30 text-foreground/80 hover:bg-pastel-purple/40 border-none">Exam Req</Badge>}
                      </>
                    ) : (
                      <span className="text-xs text-muted-foreground italic">No eligibility rules defined</span>
                    )}
                  </div>

                  <div className="flex items-center gap-2 ml-auto">
                    <Button 
                      variant="outline" 
                      size="sm" 
                      onClick={() => openEditor(course)}
                      className="h-8 rounded-lg gap-1.5 text-xs font-medium"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      Configure
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}

        {filteredCourses.length === 0 && (
          <div className="text-center py-20 bg-muted/5 rounded-2xl border border-dashed border-border">
            <Shield className="h-10 w-10 text-muted-foreground/20 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground font-medium">No courses found matching your search</p>
          </div>
        )}
      </div>

      {selectedCourse && (
        <EligibilityRuleDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          courseId={selectedCourse.id}
          courseName={selectedCourse.name}
          existingRule={rules[selectedCourse.id] || null}
          onSaved={fetchData}
        />
      )}
    </div>
  );
}
