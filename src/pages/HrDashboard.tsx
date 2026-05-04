import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useCampus } from "@/contexts/CampusContext";
import {
  Users, Clock, CalendarOff, UserCheck, AlertTriangle,
  CheckCircle, Loader2, ChevronRight, Fingerprint, TrendingUp, UserPlus,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import FaceApprovalPanel from "@/components/admin/FaceApprovalPanel";

const HrDashboard = () => {
  const { selectedCampusId } = useCampus();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    totalEmployees: 0,
    punchedInToday: 0,
    onLeaveToday: 0,
    pendingLeaves: 0,
    pendingFaceRegs: 0,
    absentToday: 0,
    newJobApplicants: 0,
  });
  const [weeklyAttendance, setWeeklyAttendance] = useState<any[]>([]);
  const [recentPunches, setRecentPunches] = useState<any[]>([]);

  useEffect(() => { fetchAll(); }, [selectedCampusId]);

  const fetchAll = async () => {
    setLoading(true);
    const today = new Date().toISOString().slice(0, 10);

    const [employeesRes, punchRes, leaveRes, pendingLeaveRes, faceRes, jobAppRes] = await Promise.all([
      supabase.from("profiles").select("user_id, display_name, role", { count: "exact" })
        .not("role", "in", "(student,parent)"),
      supabase.from("employee_attendance").select("user_id, punch_in, punch_out, selfie_url")
        .eq("date", today).order("punch_in", { ascending: false }).limit(50),
      supabase.from("employee_leave_requests").select("user_id", { count: "exact" })
        .eq("status", "approved").lte("start_date", today).gte("end_date", today),
      supabase.from("employee_leave_requests").select("id", { count: "exact" })
        .eq("status", "pending"),
      supabase.from("employee_face_registrations").select("id", { count: "exact" })
        .eq("status", "pending"),
      supabase.from("job_applicants" as any).select("id", { count: "exact", head: true })
        .eq("status", "new"),
    ]);

    const totalEmployees = employeesRes.count || 0;
    const punchedIn = punchRes.data?.length || 0;
    const onLeave = leaveRes.count || 0;

    setStats({
      totalEmployees,
      punchedInToday: punchedIn,
      onLeaveToday: onLeave,
      pendingLeaves: pendingLeaveRes.count || 0,
      pendingFaceRegs: faceRes.count || 0,
      absentToday: Math.max(0, totalEmployees - punchedIn - onLeave),
      newJobApplicants: jobAppRes.count || 0,
    });

    // Enrich punches with profile names
    const punchUserIds = [...new Set((punchRes.data || []).map((p: any) => p.user_id))];
    const { data: punchProfiles } = punchUserIds.length > 0
      ? await supabase.from("profiles").select("user_id, display_name").in("user_id", punchUserIds)
      : { data: [] };
    const punchProfileMap = new Map((punchProfiles || []).map((p: any) => [p.user_id, p.display_name]));

    setRecentPunches((punchRes.data || []).slice(0, 10).map((p: any) => ({
      ...p,
      display_name: punchProfileMap.get(p.user_id) || "Unknown",
    })));

    // Weekly attendance (last 7 days)
    const days: any[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().slice(0, 10);
      const dayLabel = d.toLocaleDateString("en-IN", { weekday: "short" });
      days.push({ date: dateStr, day: dayLabel, present: 0, absent: 0 });
    }

    const { data: weekData } = await supabase
      .from("employee_attendance")
      .select("date, user_id")
      .gte("date", days[0].date)
      .lte("date", days[6].date);

    if (weekData) {
      const countByDate: Record<string, number> = {};
      for (const row of weekData) {
        countByDate[row.date] = (countByDate[row.date] || 0) + 1;
      }
      for (const day of days) {
        day.present = countByDate[day.date] || 0;
        day.absent = Math.max(0, totalEmployees - day.present);
      }
    }
    setWeeklyAttendance(days);
    setLoading(false);
  };

  if (loading) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">HR Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">Employee attendance, leave, and workforce overview</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-4">
        {[
          { label: "Total Staff", value: stats.totalEmployees, icon: Users, bg: "bg-pastel-blue", href: "/hr-directory" },
          { label: "Punched In", value: stats.punchedInToday, icon: CheckCircle, bg: "bg-pastel-green", href: "/hr-attendance" },
          { label: "On Leave", value: stats.onLeaveToday, icon: CalendarOff, bg: "bg-pastel-yellow", href: "/hr-leave" },
          { label: "Absent", value: stats.absentToday, icon: AlertTriangle, bg: "bg-pastel-red", href: "/hr-attendance" },
          { label: "Pending Leaves", value: stats.pendingLeaves, icon: Clock, bg: "bg-pastel-orange", href: "/hr-leave" },
          { label: "Face Pending", value: stats.pendingFaceRegs, icon: UserCheck, bg: "bg-pastel-purple", href: "#face-approvals" },
          { label: "New Applicants", value: stats.newJobApplicants, icon: UserPlus, bg: "bg-pastel-pink", href: "/hr-job-applicants" },
        ].map((s) => (
          <Link key={s.label} to={s.href} className="block">
            <Card className="border-border/60 shadow-none hover:shadow-sm transition-shadow cursor-pointer">
              <CardContent className="p-4">
                <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${s.bg} mb-3`}>
                  <s.icon className="h-5 w-5 text-foreground/70" />
                </div>
                <p className="text-2xl font-bold text-foreground">{s.value}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{s.label}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      {/* Weekly chart + Recent punches */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="border-border/60 shadow-none">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold">Weekly Attendance</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={weeklyAttendance} barSize={24}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                <XAxis dataKey="day" tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ borderRadius: "8px", border: "1px solid hsl(var(--border))", fontSize: "12px" }} />
                <Bar dataKey="present" fill="hsl(var(--chart-1))" radius={[4, 4, 0, 0]} name="Present" />
                <Bar dataKey="absent" fill="hsl(var(--chart-5))" radius={[4, 4, 0, 0]} name="Absent" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="border-border/60 shadow-none overflow-hidden">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-semibold">Today's Punches</CardTitle>
              <Link to="/hr-attendance" className="text-xs text-primary hover:underline">View all</Link>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <tbody>
                {recentPunches.length === 0 ? (
                  <tr><td className="px-4 py-8 text-center text-muted-foreground">No punches today</td></tr>
                ) : recentPunches.map((p: any, i) => (
                  <tr key={i} className="border-b border-border last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        {p.selfie_url ? (
                          <img src={p.selfie_url} alt="" className="h-7 w-7 rounded-full object-cover" />
                        ) : (
                          <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center text-[10px] font-bold text-primary">
                            {(p.display_name || "?").split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase()}
                          </div>
                        )}
                        <span className="font-medium text-foreground">{p.display_name || "—"}</span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground font-mono">
                      {p.punch_in ? new Date(p.punch_in).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true }) : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground font-mono">
                      {p.punch_out ? new Date(p.punch_out).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true }) : "—"}
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge className={`text-[10px] border-0 ${p.punch_out ? "bg-pastel-green text-foreground/80" : "bg-pastel-blue text-foreground/80"}`}>
                        {p.punch_out ? "Complete" : "Active"}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>

      {/* Face Registration Approvals */}
      <div id="face-approvals">
        <h2 className="text-lg font-semibold text-foreground mb-3">Face Registrations</h2>
        <FaceApprovalPanel />
      </div>
    </div>
  );
};

export default HrDashboard;
