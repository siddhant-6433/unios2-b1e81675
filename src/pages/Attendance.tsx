import { useState } from "react";
import { mockAttendance } from "@/data/mockData";
import { Check, X, Clock, Users, CalendarDays } from "lucide-react";

const Attendance = () => {
  const [date, setDate] = useState("2026-03-08");
  const [batch, setBatch] = useState("B.Tech CSE - Sem 2 - A");
  const [records, setRecords] = useState(mockAttendance);

  const toggleStatus = (id: string) => {
    setRecords((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r;
        const next = r.status === "Present" ? "Absent" : r.status === "Absent" ? "Late" : "Present";
        return { ...r, status: next };
      })
    );
  };

  const present = records.filter((r) => r.status === "Present").length;
  const absent = records.filter((r) => r.status === "Absent").length;
  const late = records.filter((r) => r.status === "Late").length;

  const statusIcon: Record<string, React.ReactNode> = {
    Present: <Check className="h-4 w-4" />,
    Absent: <X className="h-4 w-4" />,
    Late: <Clock className="h-4 w-4" />,
  };

  const statusBg: Record<string, string> = {
    Present: "bg-pastel-green text-foreground/80",
    Absent: "bg-pastel-red text-foreground/80",
    Late: "bg-pastel-yellow text-foreground/80",
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Attendance</h1>
        <p className="text-sm text-muted-foreground mt-1">Mark and manage daily attendance.</p>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-muted-foreground" />
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="rounded-xl border border-input bg-card px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20"
          />
        </div>
        <select
          value={batch}
          onChange={(e) => setBatch(e.target.value)}
          className="rounded-xl border border-input bg-card px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20"
        >
          <option>B.Tech CSE - Sem 2 - A</option>
          <option>B.Tech CSE - Sem 2 - B</option>
          <option>MBA - Sem 2 - A</option>
          <option>BBA - Sem 2 - A</option>
        </select>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <div className="rounded-xl bg-card p-4 card-shadow flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-pastel-blue">
            <Users className="h-4 w-4 text-foreground/70" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Total</p>
            <p className="text-lg font-bold text-foreground">{records.length}</p>
          </div>
        </div>
        <div className="rounded-xl bg-card p-4 card-shadow flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-pastel-green">
            <Check className="h-4 w-4 text-foreground/70" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Present</p>
            <p className="text-lg font-bold text-foreground">{present}</p>
          </div>
        </div>
        <div className="rounded-xl bg-card p-4 card-shadow flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-pastel-red">
            <X className="h-4 w-4 text-foreground/70" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Absent</p>
            <p className="text-lg font-bold text-foreground">{absent}</p>
          </div>
        </div>
        <div className="rounded-xl bg-card p-4 card-shadow flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-pastel-yellow">
            <Clock className="h-4 w-4 text-foreground/70" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Late</p>
            <p className="text-lg font-bold text-foreground">{late}</p>
          </div>
        </div>
      </div>

      {/* Attendance Grid */}
      <div className="rounded-xl bg-card card-shadow overflow-hidden">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-0">
          {records.map((student) => (
            <div
              key={student.id}
              onClick={() => toggleStatus(student.id)}
              className="flex items-center gap-3 border-b border-r border-border p-4 cursor-pointer hover:bg-muted/30 transition-colors"
            >
              <div className={`flex h-9 w-9 items-center justify-center rounded-full ${statusBg[student.status]} transition-colors`}>
                {statusIcon[student.status]}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground truncate">{student.studentName}</p>
                <p className="text-[11px] text-muted-foreground font-mono">{student.admissionNo}</p>
              </div>
              <span className={`rounded-md px-2 py-0.5 text-[10px] font-semibold ${statusBg[student.status]}`}>
                {student.status}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="flex justify-end">
        <button className="rounded-xl bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors">
          Save Attendance
        </button>
      </div>
    </div>
  );
};

export default Attendance;
