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
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";

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
  liveness_score: number | null;
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

    // 1. Attendance records for the day.
    const attRes = await supabase.from("employee_attendance")
      .select("id, user_id, date, punch_in, punch_out, selfie_url, location_lat, location_lng, face_match_score, face_match_result, liveness_score")
      .eq("date", date)
      .order("punch_in", { ascending: false });

    // 2. Profiles + roles for the users who actually punched — fetched in two
    //    independent queries so a failure in one doesn't blank out the whole row.
    //    The original combined select with embedded user_roles was returning empty
    //    because of a non-existent column; splitting also makes diagnosis trivial
    //    since each query stands on its own.
    const punchedIds = Array.from(new Set((attRes.data || []).map((a: any) => a.user_id)));
    const [punchedProfilesRes, punchedRolesRes] = punchedIds.length > 0
      ? await Promise.all([
          supabase.from("profiles").select("user_id, display_name").in("user_id", punchedIds),
          supabase.from("user_roles").select("user_id, role").in("user_id", punchedIds),
        ])
      : [{ data: [] as any[] }, { data: [] as any[] }];

    if (punchedProfilesRes.error) console.error("[HrAttendance] profiles fetch error:", punchedProfilesRes.error);
    if (punchedRolesRes.error) console.error("[HrAttendance] user_roles fetch error:", punchedRolesRes.error);

    // 3. Staff list for the Absent panel — role filter applies here only.
    const allStaffRes = await supabase.from("profiles")
      .select("user_id, display_name, phone, user_roles!inner(role)")
      .not("user_roles.role", "in", "(student,parent)")
      .order("display_name");

    setAllProfiles(allStaffRes.data || []);
    const profileMap = new Map((punchedProfilesRes.data || []).map((p: any) => [p.user_id, p]));
    const roleMap = new Map<string, string>();
    for (const r of (punchedRolesRes.data || []) as any[]) {
      // Keep the first non-student/parent role if present, else any role.
      const existing = roleMap.get(r.user_id);
      if (!existing || existing === "student" || existing === "parent") {
        roleMap.set(r.user_id, r.role);
      }
    }

    if (attRes.data) {
      setRecords(attRes.data.map((a: any) => {
        const p: any = profileMap.get(a.user_id);
        return {
          ...a,
          display_name: p?.display_name || "Unknown",
          role: roleMap.get(a.user_id) || "",
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
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Liveness</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredRecords.length === 0 ? (
                  <tr><td colSpan={8} className="px-4 py-12 text-center text-muted-foreground">No records for this date</td></tr>
                ) : filteredRecords.map((r) => (
                  <tr key={r.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {r.selfie_url ? (
                          <Dialog>
                            <DialogTrigger asChild>
                              <button
                                className="shrink-0 rounded-full focus:outline-none focus:ring-2 focus:ring-ring/40 transition-transform hover:scale-110"
                                aria-label={`View ${r.display_name}'s punch-in photo`}
                              >
                                <img src={r.selfie_url} alt="" className="h-8 w-8 rounded-full object-cover" />
                              </button>
                            </DialogTrigger>
                            <DialogContent className="max-w-md p-0 overflow-hidden max-h-[90vh] flex flex-col">
                              <img
                                src={r.selfie_url}
                                alt={`${r.display_name} punch-in photo`}
                                className="w-full max-h-[45vh] object-contain bg-black shrink-0"
                              />
                              <div className="overflow-y-auto">
                              <div className="p-4 border-t border-border bg-card">
                                <div className="font-semibold text-foreground">{r.display_name}</div>
                                <div className="text-xs text-muted-foreground mt-1">
                                  {new Date(r.date).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" })}
                                  {" · "}{formatTime(r.punch_in)}
                                  {r.punch_out ? ` → ${formatTime(r.punch_out)}` : ""}
                                </div>
                                {r.face_match_score !== null && (
                                  <div className="text-xs text-muted-foreground mt-1">
                                    Face match {r.face_match_score}%
                                    {r.liveness_score !== null && ` · Liveness ${r.liveness_score}%`}
                                  </div>
                                )}
                              </div>
                              {r.location_lat !== null && r.location_lng !== null && (
                                <div className="border-t border-border bg-card">
                                  <div className="flex items-center gap-2 px-4 py-2 text-xs">
                                    <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                                    <span className="font-mono text-muted-foreground">
                                      {r.location_lat.toFixed(6)}, {r.location_lng.toFixed(6)}
                                    </span>
                                    <a
                                      href={`https://www.google.com/maps?q=${r.location_lat},${r.location_lng}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="ml-auto text-primary hover:underline"
                                    >
                                      Open in Maps ↗
                                    </a>
                                  </div>
                                  <iframe
                                    title={`${r.display_name} punch location`}
                                    className="w-full h-40 border-0"
                                    loading="lazy"
                                    src={`https://www.openstreetmap.org/export/embed.html?bbox=${r.location_lng - 0.003},${r.location_lat - 0.003},${r.location_lng + 0.003},${r.location_lat + 0.003}&layer=mapnik&marker=${r.location_lat},${r.location_lng}`}
                                  />
                                </div>
                              )}
                              </div>
                            </DialogContent>
                          </Dialog>
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
                      {r.liveness_score !== null ? (
                        <Badge className={`text-[10px] border-0 ${
                          r.liveness_score >= 85 ? "bg-emerald-100 text-emerald-700" :
                          r.liveness_score >= 50 ? "bg-amber-100 text-amber-700" :
                          "bg-red-100 text-red-700"
                        }`}>
                          {r.liveness_score}%
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
