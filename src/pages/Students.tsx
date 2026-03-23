import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useCampus } from "@/contexts/CampusContext";
import { Users, Search, GraduationCap, MapPin, ChevronRight, Loader2 } from "lucide-react";

interface StudentRow {
  id: string;
  name: string;
  admission_no: string | null;
  pre_admission_no: string | null;
  status: string;
  phone: string | null;
  course_name?: string;
  campus_name?: string;
}

const Students = () => {
  const [search, setSearch] = useState("");
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const { selectedCampusId } = useCampus();

  useEffect(() => { fetchStudents(); }, [selectedCampusId]);

  const fetchStudents = async () => {
    setLoading(true);
    let query = supabase
      .from("students")
      .select("id, name, admission_no, pre_admission_no, status, phone, courses:course_id(name), campuses:campus_id(name)")
      .order("created_at", { ascending: false })
      .limit(500);
    if (selectedCampusId !== "all") query = query.eq("campus_id", selectedCampusId);
    const { data } = await query;

    if (data) {
      setStudents(data.map((s: any) => ({
        ...s,
        course_name: s.courses?.name || "—",
        campus_name: s.campuses?.name || "—",
      })));
    }
    setLoading(false);
  };

  const filtered = students.filter(
    (s) =>
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      (s.admission_no || "").toLowerCase().includes(search.toLowerCase()) ||
      (s.course_name || "").toLowerCase().includes(search.toLowerCase())
  );

  const displayNo = (s: StudentRow) => s.admission_no || s.pre_admission_no || "—";

  const statusStyles: Record<string, string> = {
    active: "bg-pastel-green text-foreground/80",
    pre_admitted: "bg-pastel-yellow text-foreground/80",
    inactive: "bg-pastel-red text-foreground/80",
    alumni: "bg-pastel-blue text-foreground/80",
    dropped: "bg-pastel-red text-foreground/80",
  };

  if (loading) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Students</h1>
          <p className="text-sm text-muted-foreground mt-1">View and manage student records.</p>
        </div>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input type="text" placeholder="Search by name, admission no, course..."
          value={search} onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-xl border border-input bg-card pl-9 pr-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20" />
      </div>

      <div className="rounded-xl bg-card card-shadow overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-12 text-center">
            <Users className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">No students found</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {filtered.map((student) => (
              <Link key={student.id} to={`/students/${displayNo(student)}`}
                className="flex items-center gap-4 p-4 hover:bg-muted/30 transition-colors group">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-sm font-bold text-primary shrink-0">
                  {student.name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground">{student.name}</p>
                  <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-0.5 text-[12px] text-muted-foreground">
                    <span className="font-mono">{displayNo(student)}</span>
                    <span className="flex items-center gap-1"><GraduationCap className="h-3 w-3" />{student.course_name}</span>
                    <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{student.campus_name}</span>
                  </div>
                </div>
                <span className={`rounded-md px-2 py-0.5 text-[10px] font-semibold capitalize ${statusStyles[student.status] || "bg-muted text-foreground/80"}`}>
                  {student.status.replace("_", " ")}
                </span>
                <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default Students;
