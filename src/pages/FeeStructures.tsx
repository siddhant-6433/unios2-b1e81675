import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FeeStructureViewer } from "@/components/finance/FeeStructureViewer";
import { CourseInfoPanel } from "@/components/leads/CourseInfoPanel";
import { Loader2, Search, Building2 } from "lucide-react";

interface CourseOption {
  id: string;
  name: string;
  code: string;
  campus_name: string;
  institution_name: string;
  department_name: string;
}

const FeeStructures = () => {
  const { role } = useAuth();
  const isAdmissionsUser = ["counsellor", "consultant", "admission_head"].includes(role || "");
  const [courses, setCourses] = useState<CourseOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("courses")
        .select(`id, name, code, departments!inner(name, institutions!inner(name, campuses!inner(name)))`)
        .order("name");
      if (data) {
        setCourses((data as any[]).map(c => ({
          id: c.id,
          name: c.name,
          code: c.code,
          department_name: c.departments?.name,
          institution_name: c.departments?.institutions?.name,
          campus_name: c.departments?.institutions?.campuses?.name,
        })));
      }
      setLoading(false);
    })();
  }, []);

  const filtered = courses.filter(c =>
    !search ||
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.campus_name.toLowerCase().includes(search.toLowerCase()) ||
    c.institution_name.toLowerCase().includes(search.toLowerCase())
  );

  // Group by campus → institution
  const grouped = filtered.reduce<Record<string, CourseOption[]>>((acc, c) => {
    const key = `${c.campus_name} — ${c.institution_name}`;
    if (!acc[key]) acc[key] = [];
    acc[key].push(c);
    return acc;
  }, {});

  if (loading) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Courses & Fees</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Course details, eligibility, affiliations and fee structures
          {isAdmissionsUser && " (new admission rates)"}
        </p>
      </div>

      <Tabs defaultValue="courses" className="w-full">
        <TabsList className="bg-transparent border-b border-border rounded-none p-0 h-auto gap-0 w-full justify-start">
          {["Courses", "Fee Structures"].map(t => (
            <TabsTrigger key={t} value={t.toLowerCase().replace(" ", "-")}
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none text-sm px-4 py-2 text-muted-foreground data-[state=active]:text-foreground data-[state=active]:font-semibold">
              {t}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* COURSES TAB */}
        <TabsContent value="courses" className="mt-4">
          <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-6">
            {/* Course list sidebar */}
            <div className="space-y-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Search courses..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full rounded-xl border border-input bg-card py-2.5 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20"
                />
              </div>

              <div className="max-h-[calc(100vh-280px)] overflow-y-auto space-y-4">
                {Object.entries(grouped).map(([group, groupCourses]) => (
                  <div key={group}>
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide px-1 mb-1.5 flex items-center gap-1">
                      <Building2 className="h-3 w-3" /> {group}
                    </p>
                    <div className="space-y-0.5">
                      {groupCourses.map(c => (
                        <button
                          key={c.id}
                          onClick={() => setSelectedCourseId(c.id)}
                          className={`w-full text-left rounded-lg px-3 py-2 text-xs transition-colors ${
                            selectedCourseId === c.id
                              ? "bg-primary/10 text-primary font-semibold"
                              : "text-foreground hover:bg-muted/50"
                          }`}
                        >
                          <span className="block truncate">{c.name}</span>
                          <span className="text-[10px] text-muted-foreground font-mono">{c.code}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
                {Object.keys(grouped).length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-8">No courses found</p>
                )}
              </div>
            </div>

            {/* Course info panel */}
            <div>
              {selectedCourseId ? (
                <CourseInfoPanel courseId={selectedCourseId} />
              ) : (
                <div className="flex h-64 items-center justify-center text-muted-foreground">
                  <p className="text-sm">Select a course to view details</p>
                </div>
              )}
            </div>
          </div>
        </TabsContent>

        {/* FEE STRUCTURES TAB */}
        <TabsContent value="fee-structures" className="mt-4">
          <FeeStructureViewer showFilter newAdmissionOnly={isAdmissionsUser} />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default FeeStructures;
