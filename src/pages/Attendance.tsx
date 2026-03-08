import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Check, X, Clock, Users, CalendarDays, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface AttendanceRow {
  id?: string;
  student_id: string;
  student_name: string;
  admission_no: string;
  status: "present" | "absent" | "late";
}

const Attendance = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [batchId, setBatchId] = useState("");
  const [batches, setBatches] = useState<{ id: string; name: string }[]>([]);
  const [records, setRecords] = useState<AttendanceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => { fetchBatches(); }, []);
  useEffect(() => { if (batchId) fetchAttendance(); }, [batchId, date]);

  const fetchBatches = async () => {
    const { data } = await supabase.from("batches").select("id, name").order("name");
    if (data && data.length > 0) {
      setBatches(data);
      setBatchId(data[0].id);
    }
    setLoading(false);
  };

  const fetchAttendance = async () => {
    setLoading(true);
    // Get students in this batch
    const { data: students } = await supabase.from("students")
      .select("id, name, admission_no, pre_admission_no")
      .eq("batch_id", batchId)
      .in("status", ["active", "pre_admitted"])
      .order("name");

    if (!students || students.length === 0) {
      setRecords([]);
      setLoading(false);
      return;
    }

    // Get existing attendance for date
    const { data: existing } = await supabase.from("daily_attendance")
      .select("id, student_id, status")
      .eq("date", date)
      .eq("batch_id", batchId);

    const existingMap = new Map((existing || []).map(a => [a.student_id, a]));

    setRecords(students.map(s => {
      const ex = existingMap.get(s.id);
      return {
        id: ex?.id,
        student_id: s.id,
        student_name: s.name,
        admission_no: s.admission_no || s.pre_admission_no || "—",
        status: (ex?.status as any) || "present",
      };
    }));
    setLoading(false);
  };

  const toggleStatus = (studentId: string) => {
    setRecords(prev => prev.map(r => {
      if (r.student_id !== studentId) return r;
      const next = r.status === "present" ? "absent" : r.status === "absent" ? "late" : "present";
      return { ...r, status: next };
    }));
  };

  const saveAttendance = async () => {
    setSaving(true);
    // Upsert all records
    const upsertData = records.map(r => ({
      student_id: r.student_id,
      batch_id: batchId,
      date,
      status: r.status,
      marked_by: user?.id || null,
    }));

    // Delete existing for this date/batch, then insert
    await supabase.from("daily_attendance").delete().eq("date", date).eq("batch_id", batchId);
    const { error } = await supabase.from("daily_attendance").insert(upsertData);

    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else toast({ title: "Attendance saved" });

    setSaving(false);
    await fetchAttendance();
  };

  const present = records.filter(r => r.status === "present").length;
  const absent = records.filter(r => r.status === "absent").length;
  const late = records.filter(r => r.status === "late").length;

  const statusIcon: Record<string, React.ReactNode> = {
    present: <Check className="h-4 w-4" />,
    absent: <X className="h-4 w-4" />,
    late: <Clock className="h-4 w-4" />,
  };
  const statusBg: Record<string, string> = {
    present: "bg-pastel-green text-foreground/80",
    absent: "bg-pastel-red text-foreground/80",
    late: "bg-pastel-yellow text-foreground/80",
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Attendance</h1>
        <p className="text-sm text-muted-foreground mt-1">Mark and manage daily attendance.</p>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-muted-foreground" />
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
            className="rounded-xl border border-input bg-card px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20" />
        </div>
        <select value={batchId} onChange={(e) => setBatchId(e.target.value)}
          className="rounded-xl border border-input bg-card px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20">
          {batches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="flex h-32 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : records.length === 0 ? (
        <div className="rounded-xl bg-card card-shadow p-12 text-center">
          <Users className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">No students in this batch</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <div className="rounded-xl bg-card p-4 card-shadow flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-pastel-blue"><Users className="h-4 w-4 text-foreground/70" /></div>
              <div><p className="text-xs text-muted-foreground">Total</p><p className="text-lg font-bold text-foreground">{records.length}</p></div>
            </div>
            <div className="rounded-xl bg-card p-4 card-shadow flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-pastel-green"><Check className="h-4 w-4 text-foreground/70" /></div>
              <div><p className="text-xs text-muted-foreground">Present</p><p className="text-lg font-bold text-foreground">{present}</p></div>
            </div>
            <div className="rounded-xl bg-card p-4 card-shadow flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-pastel-red"><X className="h-4 w-4 text-foreground/70" /></div>
              <div><p className="text-xs text-muted-foreground">Absent</p><p className="text-lg font-bold text-foreground">{absent}</p></div>
            </div>
            <div className="rounded-xl bg-card p-4 card-shadow flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-pastel-yellow"><Clock className="h-4 w-4 text-foreground/70" /></div>
              <div><p className="text-xs text-muted-foreground">Late</p><p className="text-lg font-bold text-foreground">{late}</p></div>
            </div>
          </div>

          <div className="rounded-xl bg-card card-shadow overflow-hidden">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-0">
              {records.map((student) => (
                <div key={student.student_id} onClick={() => toggleStatus(student.student_id)}
                  className="flex items-center gap-3 border-b border-r border-border p-4 cursor-pointer hover:bg-muted/30 transition-colors">
                  <div className={`flex h-9 w-9 items-center justify-center rounded-full ${statusBg[student.status]} transition-colors`}>
                    {statusIcon[student.status]}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground truncate">{student.student_name}</p>
                    <p className="text-[11px] text-muted-foreground font-mono">{student.admission_no}</p>
                  </div>
                  <span className={`rounded-md px-2 py-0.5 text-[10px] font-semibold capitalize ${statusBg[student.status]}`}>
                    {student.status}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-end">
            <Button onClick={saveAttendance} disabled={saving} className="gap-2">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Save Attendance
            </Button>
          </div>
        </>
      )}
    </div>
  );
};

export default Attendance;
