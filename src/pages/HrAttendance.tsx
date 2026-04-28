import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useCampus } from "@/contexts/CampusContext";
import {
  Search, Calendar, Loader2, Clock, CheckCircle, MapPin,
  ChevronLeft, ChevronRight, Download, Filter,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface AttendanceRecord {
  id: string;
  user_id: string;
  date: string;
  punch_in: string | null;
  punch_out: string | null;
  selfie_url: string | null;
  location_lat: number | null;
  location_lng: number | null;
  face_match_score: number | null;
  face_match_result: string | null;
  display_name: string;
  role: string;
}

const HrAttendance = () => {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [search, setSearch] = useState("");
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [allProfiles, setAllProfiles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { fetchData(); }, [date]);

  const fetchData = async () => {
    setLoading(true);

    const [attRes, profilesRes] = await Promise.all([
      supabase.from("employee_attendance")
        .select("id, user_id, date, punch_in, punch_out, selfie_url, location_lat, location_lng, face_match_score, face_match_result")
        .eq("date", date)
        .order("punch_in", { ascending: false }),
      supabase.from("profiles")
        .select("user_id, display_name, role, phone")
        .not("role", "in", "(student,parent)")
        .order("display_name"),
    ]);

    setAllProfiles(profilesRes.data || []);
    const profileMap = new Map((profilesRes.data || []).map((p: any) => [p.user_id, p]));

    if (attRes.data) {
      setRecords(attRes.data.map((a: any) => {
        const p = profileMap.get(a.user_id);
        return {
          ...a,
          display_name: p?.display_name || "Unknown",
          role: p?.role || "",
        };
      }));
    }
    setLoading(false);
  };

  const filteredRecords = useMemo(() => {
    if (!search) return records;
    const q = search.toLowerCase();
    return records.filter(r => r.display_name.toLowerCase().includes(q));
  }, [records, search]);

  // Employees who haven't punched
  const punchedUserIds = new Set(records.map(r => r.user_id));
  const absentEmployees = allProfiles.filter((p: any) => !punchedUserIds.has(p.user_id));

  const formatTime = (iso: string | null) =>
    iso ? new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true }) : "—";

  const calcHours = (punchIn: string | null, punchOut: string | null) => {
    if (!punchIn || !punchOut) return "—";
    const diff = new Date(punchOut).getTime() - new Date(punchIn).getTime();
    const hrs = Math.floor(diff / 3600000);
    const mins = Math.floor((diff % 3600000) / 60000);
    return `${hrs}h ${mins}m`;
  };

  const prevDay = () => {
    const d = new Date(date);
    d.setDate(d.getDate() - 1);
    setDate(d.toISOString().slice(0, 10));
  };
  const nextDay = () => {
    const d = new Date(date);
    d.setDate(d.getDate() + 1);
    setDate(d.toISOString().slice(0, 10));
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Employee Attendance</h1>
          <p className="text-sm text-muted-foreground mt-1">Daily punch-in/out records</p>
        </div>
        <Button variant="outline" className="gap-2"><Download className="h-4 w-4" /> Export</Button>
      </div>

      {/* Date nav + search */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 rounded-xl border border-input bg-card p-1">
          <button onClick={prevDay} className="p-2 rounded-lg hover:bg-muted"><ChevronLeft className="h-4 w-4" /></button>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
            className="bg-transparent text-sm font-medium text-foreground px-2 focus:outline-none" />
          <button onClick={nextDay} className="p-2 rounded-lg hover:bg-muted"><ChevronRight className="h-4 w-4" /></button>
        </div>

        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input type="text" placeholder="Search employee..." value={search} onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-xl border border-input bg-card py-2.5 pl-10 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-ring/20" />
        </div>

        <div className="flex gap-2 text-xs">
          <Badge className="bg-pastel-green text-foreground/80 border-0">{records.length} Present</Badge>
          <Badge className="bg-pastel-red text-foreground/80 border-0">{absentEmployees.length} Absent</Badge>
        </div>
      </div>

      {/* Attendance table */}
      {loading ? (
        <div className="flex h-48 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : (
        <Card className="border-border/60 shadow-none overflow-hidden">
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Employee</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Role</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Punch In</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Punch Out</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Hours</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Face Match</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredRecords.length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">No records for this date</td></tr>
                ) : filteredRecords.map((r) => (
                  <tr key={r.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {r.selfie_url ? (
                          <img src={r.selfie_url} alt="" className="h-8 w-8 rounded-full object-cover shrink-0" />
                        ) : (
                          <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-[10px] font-bold text-primary shrink-0">
                            {r.display_name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase()}
                          </div>
                        )}
                        <span className="font-medium text-foreground">{r.display_name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground capitalize">{r.role.replace(/_/g, " ")}</td>
                    <td className="px-4 py-3 font-mono text-xs">{formatTime(r.punch_in)}</td>
                    <td className="px-4 py-3 font-mono text-xs">{formatTime(r.punch_out)}</td>
                    <td className="px-4 py-3 text-xs font-medium">{calcHours(r.punch_in, r.punch_out)}</td>
                    <td className="px-4 py-3">
                      {r.face_match_score !== null ? (
                        <Badge className={`text-[10px] border-0 ${
                          r.face_match_result === 'match' ? "bg-pastel-green text-foreground/80" :
                          "bg-pastel-red text-foreground/80"
                        }`}>
                          {r.face_match_score}%
                        </Badge>
                      ) : (
                        <span className="text-[10px] text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Badge className={`text-[10px] border-0 ${r.punch_out ? "bg-pastel-green text-foreground/80" : "bg-pastel-blue text-foreground/80"}`}>
                        {r.punch_out ? "Complete" : "Active"}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {/* Absent list */}
      {absentEmployees.length > 0 && (
        <Card className="border-border/60 shadow-none overflow-hidden">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold text-destructive">Absent / Not Punched In ({absentEmployees.length})</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-border max-h-64 overflow-y-auto">
              {absentEmployees.map((p: any) => (
                <div key={p.user_id} className="flex items-center gap-3 px-4 py-2.5">
                  <div className="h-7 w-7 rounded-full bg-destructive/10 flex items-center justify-center text-[10px] font-bold text-destructive">
                    {p.display_name?.split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase()}
                  </div>
                  <span className="text-sm text-foreground flex-1">{p.display_name}</span>
                  <span className="text-[10px] text-muted-foreground capitalize">{(p.role || "").replace(/_/g, " ")}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default HrAttendance;
