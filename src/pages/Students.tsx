import { useState } from "react";
import { Link } from "react-router-dom";
import { mockStudentProfiles } from "@/data/mockData";
import { Users, Search, GraduationCap, MapPin, ChevronRight } from "lucide-react";

const Students = () => {
  const [search, setSearch] = useState("");

  const filtered = mockStudentProfiles.filter(
    (s) =>
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.admissionNo.toLowerCase().includes(search.toLowerCase()) ||
      s.course.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Students</h1>
          <p className="text-sm text-muted-foreground mt-1">View and manage student records.</p>
        </div>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          type="text"
          placeholder="Search by name, admission no, course..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-xl border border-input bg-card pl-9 pr-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20"
        />
      </div>

      {/* Student list */}
      <div className="rounded-xl bg-card card-shadow overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-12 text-center">
            <Users className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">No students found</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {filtered.map((student) => (
              <Link
                key={student.id}
                to={`/students/${student.admissionNo}`}
                className="flex items-center gap-4 p-4 hover:bg-muted/30 transition-colors group"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-sm font-bold text-primary shrink-0">
                  {student.name.split(" ").map((n) => n[0]).join("")}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground">{student.name}</p>
                  <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-0.5 text-[12px] text-muted-foreground">
                    <span className="font-mono">{student.admissionNo}</span>
                    <span className="flex items-center gap-1"><GraduationCap className="h-3 w-3" />{student.course}</span>
                    <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{student.campus}</span>
                  </div>
                </div>
                <span className={`rounded-md px-2 py-0.5 text-[10px] font-semibold ${student.status === "Active" ? "bg-pastel-green text-foreground/80" : "bg-pastel-red text-foreground/80"}`}>
                  {student.status}
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
