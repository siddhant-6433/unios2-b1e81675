import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  Users, IndianRupee, AlertTriangle, GraduationCap, Building2,
  ClipboardCheck, BookOpen, CalendarDays, Bell, TrendingUp,
  ArrowUpRight, ChevronRight, Phone, MessageSquare, MoreHorizontal, Loader2
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";

const STAGE_LABELS: Record<string, string> = {
  new_lead: "New Lead", ai_called: "AI Called", counsellor_call: "Counsellor Call",
  visit_scheduled: "Visit Scheduled", interview: "Interview", offer_sent: "Offer Sent",
  token_paid: "Token Paid", pre_admitted: "Pre-Admitted", admitted: "Admitted",
};

const funnelColors = [
  "bg-primary", "bg-primary/85", "bg-primary/70",
  "bg-chart-2", "bg-chart-2/80", "bg-chart-3",
  "bg-chart-3/80", "bg-chart-5", "bg-chart-4",
];

const stageBadgeClass: Record<string, string> = {
  new_lead: "bg-pastel-blue text-foreground/70",
  ai_called: "bg-pastel-purple text-foreground/70",
  counsellor_call: "bg-pastel-orange text-foreground/70",
  visit_scheduled: "bg-pastel-yellow text-foreground/70",
  offer_sent: "bg-pastel-green text-foreground/70",
};

const SuperAdminDashboard = () => {
  const [loading, setLoading] = useState(true);
  const [leadCount, setLeadCount] = useState(0);
  const [todayLeads, setTodayLeads] = useState(0);
  const [admittedCount, setAdmittedCount] = useState(0);
  const [studentCount, setStudentCount] = useState(0);
  const [funnel, setFunnel] = useState<{ stage: string; count: number }[]>([]);
  const [recentLeads, setRecentLeads] = useState<any[]>([]);

  useEffect(() => { fetchDashboard(); }, []);

  const fetchDashboard = async () => {
    setLoading(true);
    const today = new Date().toISOString().slice(0, 10);

    const [leadsRes, todayRes, admittedRes, studentsRes, recentRes] = await Promise.all([
      supabase.from("leads").select("id", { count: "exact", head: true }),
      supabase.from("leads").select("id", { count: "exact", head: true }).gte("created_at", today),
      supabase.from("leads").select("id", { count: "exact", head: true }).eq("stage", "admitted"),
      supabase.from("students").select("id", { count: "exact", head: true }),
      supabase.from("leads").select("id, name, phone, stage, source, created_at, courses:course_id(name), campuses:campus_id(name)")
        .order("created_at", { ascending: false }).limit(5),
    ]);

    setLeadCount(leadsRes.count || 0);
    setTodayLeads(todayRes.count || 0);
    setAdmittedCount(admittedRes.count || 0);
    setStudentCount(studentsRes.count || 0);

    // Build funnel - query counts per stage
    const stages = Object.keys(STAGE_LABELS);
    const funnelCounts = await Promise.all(
      stages.map(async (stage) => {
        const { count } = await supabase.from("leads").select("id", { count: "exact", head: true }).eq("stage", stage);
        return { stage: STAGE_LABELS[stage], count: count || 0 };
      })
    );
    setFunnel(funnelCounts);

    if (recentRes.data) {
      setRecentLeads(recentRes.data.map((l: any) => ({
        ...l,
        course_name: l.courses?.name || "—",
        campus_name: l.campuses?.name || "—",
        initials: l.name.split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase(),
      })));
    }
    setLoading(false);
  };

  if (loading) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  const funnelMax = Math.max(...funnel.map(s => s.count), 1);
  const conversionRate = leadCount > 0 ? Math.round((admittedCount / leadCount) * 100) : 0;

  const statCards = [
    { label: "Total Leads", value: String(leadCount), sub: `+${todayLeads} today`, subColor: "text-primary", icon: Users, iconBg: "bg-pastel-blue" },
    { label: "Total Students", value: String(studentCount), sub: "Enrolled", subColor: "text-primary", icon: GraduationCap, iconBg: "bg-pastel-green" },
    { label: "Conversions", value: String(admittedCount), sub: `${conversionRate}% rate`, subColor: "text-primary", icon: TrendingUp, iconBg: "bg-pastel-orange" },
    { label: "Admitted", value: String(admittedCount), sub: "Total admitted", subColor: "text-primary", icon: CalendarDays, iconBg: "bg-pastel-purple" },
  ];

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((stat) => (
          <Card key={stat.label} className="border-border/60 shadow-none hover:shadow-sm transition-shadow">
            <CardContent className="p-5">
              <div className="flex items-start justify-between">
                <div className={`flex h-11 w-11 items-center justify-center rounded-xl ${stat.iconBg}`}>
                  <stat.icon className="h-5 w-5 text-foreground/70" />
                </div>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground"><ArrowUpRight className="h-4 w-4" /></Button>
              </div>
              <p className="text-3xl font-bold text-foreground mt-4">{stat.value}</p>
              <p className="text-sm text-muted-foreground mt-0.5">{stat.label}</p>
              <p className={`text-xs font-medium mt-1 ${stat.subColor}`}>{stat.sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2 border-border/60 shadow-none">
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-semibold">Admission Funnel</CardTitle>
              <Button variant="link" size="sm" className="text-primary gap-1 px-0" asChild>
                <Link to="/admissions">View all <ChevronRight className="h-3.5 w-3.5" /></Link>
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3.5">
            {funnel.map((item, i) => (
              <div key={item.stage} className="flex items-center gap-4">
                <span className="text-sm text-muted-foreground w-28 shrink-0">{item.stage}</span>
                <div className="flex-1 h-8 bg-muted rounded-lg overflow-hidden relative">
                  <div className={`h-full ${funnelColors[i] || "bg-primary"} rounded-lg flex items-center justify-end pr-3 transition-all duration-500`}
                    style={{ width: `${Math.max((item.count / funnelMax) * 100, 5)}%` }}>
                    <span className="text-xs font-semibold text-primary-foreground">{item.count}</span>
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="border-border/60 shadow-none">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-semibold">Recent Leads</CardTitle>
              <Button variant="link" size="sm" className="text-primary gap-1 px-0" asChild>
                <Link to="/admissions">View all <ChevronRight className="h-3.5 w-3.5" /></Link>
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-0">
            {recentLeads.map((lead: any) => (
              <Link to={`/admissions/${lead.id}`} key={lead.id} className="flex items-center gap-3 py-3 border-b border-border/30 last:border-0 hover:bg-muted/30 transition-colors">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-pastel-purple text-xs font-bold text-foreground/70">
                  {lead.initials}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground">{lead.name}</p>
                  <p className="text-xs text-muted-foreground">{lead.course_name} · {lead.campus_name}</p>
                </div>
                <Badge className={`text-[11px] font-medium border-0 ${stageBadgeClass[lead.stage] || "bg-muted text-foreground/70"}`}>
                  {STAGE_LABELS[lead.stage] || lead.stage}
                </Badge>
              </Link>
            ))}
            {recentLeads.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">No leads yet</p>}
          </CardContent>
        </Card>
      </div>
    </>
  );
};

const FacultyDashboard = () => (
  <>
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {[
        { label: "Today's Classes", value: "—", icon: CalendarDays, iconBg: "bg-pastel-blue" },
        { label: "Attendance %", value: "—", icon: ClipboardCheck, iconBg: "bg-pastel-green" },
        { label: "Assignments Pending", value: "—", icon: BookOpen, iconBg: "bg-pastel-orange" },
        { label: "Announcements", value: "—", icon: Bell, iconBg: "bg-pastel-purple" },
      ].map((stat) => (
        <Card key={stat.label} className="border-border/60 shadow-none">
          <CardContent className="p-5">
            <div className="flex items-start justify-between">
              <div><p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{stat.label}</p><p className="text-2xl font-bold text-foreground mt-1.5">{stat.value}</p></div>
              <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${stat.iconBg}`}><stat.icon className="h-5 w-5 text-foreground/70" /></div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
    <Card className="border-border/60 shadow-none">
      <CardContent className="p-8 text-center">
        <BookOpen className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
        <p className="text-sm text-muted-foreground">Your class schedule and assignments will appear here.</p>
      </CardContent>
    </Card>
  </>
);

const StudentDashboard = () => (
  <>
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {[
        { label: "Attendance %", value: "—", icon: ClipboardCheck, iconBg: "bg-pastel-green" },
        { label: "Upcoming Exams", value: "—", icon: BookOpen, iconBg: "bg-pastel-orange" },
        { label: "Fee Due", value: "—", icon: IndianRupee, iconBg: "bg-pastel-red" },
        { label: "Announcements", value: "—", icon: Bell, iconBg: "bg-pastel-blue" },
      ].map((stat) => (
        <Card key={stat.label} className="border-border/60 shadow-none">
          <CardContent className="p-5">
            <div className="flex items-start justify-between">
              <div><p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{stat.label}</p><p className="text-2xl font-bold text-foreground mt-1.5">{stat.value}</p></div>
              <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${stat.iconBg}`}><stat.icon className="h-5 w-5 text-foreground/70" /></div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
    <Card className="border-border/60 shadow-none">
      <CardContent className="p-8 text-center">
        <GraduationCap className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
        <p className="text-sm text-muted-foreground">Your academic overview, schedule, and results will appear here.</p>
      </CardContent>
    </Card>
  </>
);

const ParentDashboard = () => (
  <>
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {[
        { label: "Child Attendance", value: "—", icon: ClipboardCheck, iconBg: "bg-pastel-green" },
        { label: "Fee Due", value: "—", icon: IndianRupee, iconBg: "bg-pastel-red" },
        { label: "Announcements", value: "—", icon: Bell, iconBg: "bg-pastel-blue" },
      ].map((stat) => (
        <Card key={stat.label} className="border-border/60 shadow-none">
          <CardContent className="p-5">
            <div className="flex items-start justify-between">
              <div><p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{stat.label}</p><p className="text-2xl font-bold text-foreground mt-1.5">{stat.value}</p></div>
              <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${stat.iconBg}`}><stat.icon className="h-5 w-5 text-foreground/70" /></div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
    <Card className="border-border/60 shadow-none">
      <CardContent className="p-8 text-center">
        <Users className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
        <p className="text-sm text-muted-foreground">Your child's academic information will appear here.</p>
      </CardContent>
    </Card>
  </>
);

const Dashboard = () => {
  const { role } = useAuth();

  const isAdmin = ["super_admin", "campus_admin", "admission_head", "principal"].includes(role || "");
  const isFaculty = ["faculty", "teacher"].includes(role || "");
  const isStudent = role === "student";
  const isParent = role === "parent";

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-1">Welcome back. Here's your overview.</p>
      </div>
      {isAdmin && <SuperAdminDashboard />}
      {isFaculty && <FacultyDashboard />}
      {isStudent && <StudentDashboard />}
      {isParent && <ParentDashboard />}
      {!isAdmin && !isFaculty && !isStudent && !isParent && <SuperAdminDashboard />}
    </div>
  );
};

export default Dashboard;
