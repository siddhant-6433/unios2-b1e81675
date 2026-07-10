import { lazy, Suspense, useState, useEffect, memo } from "react";
import { useCountUp } from "@/hooks/useCountUp";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useCampus } from "@/contexts/CampusContext";
import { isAcademicPartnerPortalRole } from "@/lib/accessPolicy";
import {
  Users, IndianRupee, GraduationCap,
  ClipboardCheck, BookOpen, CalendarDays, Bell,
  ArrowUpRight, ChevronRight, Loader2, FileText,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link, Navigate } from "react-router-dom";
import { JdCategoryMappingPanel } from "@/components/admissions/JdCategoryMappingPanel";
import { MetaCourseMappingPanel } from "@/components/admissions/MetaCourseMappingPanel";
import { PendingApprovalsPanel } from "@/components/dashboard/PendingApprovalsPanel";
import { ConsultantVoiceMessagesPanel } from "@/components/dashboard/ConsultantVoiceMessagesPanel";
import { LeadAssignmentHistory } from "@/components/dashboard/LeadAssignmentHistory";

const DashboardAnalytics = lazy(() => import("@/components/dashboard/DashboardAnalytics"));

const AnimatedNumber = memo(({ value }: { value: number }) => {
  const display = useCountUp(value);
  return <>{display.toLocaleString("en-IN")}</>;
});

// ── Helpers ────────────────────────────────────────────────────────────────

function getGreeting(name: string): string {
  const h = new Date().getHours();
  if (h < 5)  return `Up late, ${name}?`;
  if (h < 12) return `Good morning, ${name}`;
  if (h < 17) return `Good afternoon, ${name}`;
  if (h < 21) return `Good evening, ${name}`;
  return `Up late, ${name}?`;
}

const STAGE_LABELS: Record<string, string> = {
  new_lead: "New Lead", application_in_progress: "App In Progress", application_submitted: "App Submitted",
  ai_called: "AI Called", counsellor_call: "In Follow Up",
  visit_scheduled: "Visit Scheduled", interview: "Interview", offer_sent: "Offer Sent",
  token_paid: "Token Paid", pre_admitted: "Pre-Admitted", admitted: "Admitted",
};

const funnelColors = [
  "bg-primary", "bg-chart-2", "bg-chart-3",
  "bg-primary/85", "bg-primary/70",
  "bg-chart-2/80", "bg-chart-3/80",
  "bg-chart-5", "bg-chart-5/80",
  "bg-chart-4", "bg-chart-4/80",
];

const stageBadgeClass: Record<string, string> = {
  new_lead: "bg-pastel-blue text-foreground/70",
  ai_called: "bg-pastel-purple text-foreground/70",
  counsellor_call: "bg-pastel-orange text-foreground/70",
  visit_scheduled: "bg-pastel-yellow text-foreground/70",
  offer_sent: "bg-pastel-green text-foreground/70",
};

type DashboardOverviewPayload = {
  counts?: {
    total_leads?: number;
    today_leads?: number;
    admitted?: number;
    students?: number;
    app_in_progress?: number;
    app_submitted?: number;
  };
  funnel?: { stage: string; count: number }[];
  recent_leads?: {
    id: string;
    name: string | null;
    phone: string | null;
    stage: string;
    source: string | null;
    created_at: string;
    course_name: string | null;
    campus_name: string | null;
  }[];
};

function AnalyticsFallback() {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest whitespace-nowrap">Analytics</p>
        <div className="flex-1 border-t border-border/50" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <div className="lg:col-span-3 h-64 rounded-lg border border-border/60 flutes" />
        <div className="lg:col-span-2 h-64 rounded-lg border border-border/60 flutes" />
      </div>
      <div className="h-72 rounded-lg border border-border/60 flutes" />
      <div className="h-48 rounded-lg border border-border/60 flutes" />
    </div>
  );
}

// ── SuperAdminDashboard ─────────────────────────────────────────────────────

const SuperAdminDashboard = ({ isSuperAdmin }: { isSuperAdmin: boolean }) => {
  const { profile } = useAuth();
  const firstName = profile?.display_name?.split(" ")[0] || "there";
  const { selectedCampusId } = useCampus();
  const [loading, setLoading] = useState(true);

  // CRM stats
  const [leadCount,    setLeadCount]    = useState(0);
  const [todayLeads,   setTodayLeads]   = useState(0);
  const [admittedCount,setAdmittedCount]= useState(0);
  const [studentCount, setStudentCount] = useState(0);
  const [funnel,       setFunnel]       = useState<{ stage: string; count: number }[]>([]);
  const [recentLeads,  setRecentLeads]  = useState<any[]>([]);
  const [appInProgress,setAppInProgress]= useState(0);
  const [appSubmitted, setAppSubmitted] = useState(0);

  const fetchDashboard = async () => {
    setLoading(true);
    const byCampus = selectedCampusId !== "all";
    const { data, error } = await (supabase as any).rpc("dashboard_overview", {
      p_campus_id: byCampus ? selectedCampusId : null,
    });

    if (error) {
      console.error("Failed to load dashboard overview", error);
      setLoading(false);
      return;
    }

    const payload = (data || {}) as DashboardOverviewPayload;
    const counts = payload.counts || {};
    setLeadCount(Number(counts.total_leads) || 0);
    setTodayLeads(Number(counts.today_leads) || 0);
    setAdmittedCount(Number(counts.admitted) || 0);
    setStudentCount(Number(counts.students) || 0);
    setAppInProgress(Number(counts.app_in_progress) || 0);
    setAppSubmitted(Number(counts.app_submitted) || 0);

    const stageMap: Record<string, number> = {};
    for (const r of payload.funnel || []) {
      stageMap[r.stage] = Number(r.count) || 0;
    }
    setFunnel(Object.keys(STAGE_LABELS).map((stage) => ({
      stage: STAGE_LABELS[stage],
      count: stageMap[stage] || 0,
    })));

    setRecentLeads((payload.recent_leads || []).map((l) => ({
      ...l,
      name: l.name || "Unknown",
      course_name: l.course_name || "—",
      campus_name: l.campus_name || "—",
      initials: (l.name || "?").split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase(),
    })));
    setLoading(false);
  };

  useEffect(() => { fetchDashboard(); }, [selectedCampusId]);

  if (loading) return (
    <div className="flex h-64 items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-primary" />
    </div>
  );

  const funnelMax       = Math.max(...funnel.map(s => s.count), 1);
  const conversionRate  = leadCount > 0 ? Math.round((admittedCount / leadCount) * 100) : 0;

  const statCards = [
    { label: "Total Leads",            value: leadCount,    trend: todayLeads > 0 ? `+${todayLeads} today` : null, trendUp: true,  icon: Users,         iconBg: "bg-pastel-blue",   link: "/admissions" },
    { label: "Applications In Progress",value: appInProgress,trend: "Filling application",                         trendUp: null,  icon: FileText,      iconBg: "bg-pastel-orange", link: "/applications" },
    { label: "Applications Submitted",  value: appSubmitted, trend: "Ready for review",                             trendUp: null,  icon: ClipboardCheck,iconBg: "bg-pastel-green",  link: "/applications?status=submitted" },
    { label: "Admitted",               value: admittedCount,trend: conversionRate > 0 ? `${conversionRate}% conversion` : null, trendUp: conversionRate > 0, icon: GraduationCap, iconBg: "bg-pastel-purple", link: "/admissions?stage=admitted" },
  ];

  return (
    <>
      {/* ── Source → course mapping alerts (super admin only) ── */}
      {isSuperAdmin && (
        <div className="space-y-3">
          <JdCategoryMappingPanel />
          <MetaCourseMappingPanel />
        </div>
      )}

      {/* ── Hero banner ── */}
      <div className="rounded-2xl bg-gradient-to-r from-primary/5 via-card to-info/5 border border-border/40 px-6 py-5 mb-1">
        <h1 className="text-2xl font-bold text-foreground">{getGreeting(firstName)}</h1>
        <p className="text-sm text-muted-foreground mt-1">Here's your overview.</p>
      </div>

      {/* ── Stat Cards ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((stat, i) => (
          <Card key={stat.label} className="border-border/60 shadow-none hover:elevation-mid hover:-translate-y-1 transition-all duration-280 ease-standard animate-rs-slide-up group" style={{ animationDelay: `${i * 80}ms`, animationFillMode: "both" }}>
            <CardContent className="p-5 flex flex-col h-full">
              {/* Top: label + icon */}
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-muted-foreground">{stat.label}</p>
                <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${stat.iconBg}`}>
                  <stat.icon className="h-4 w-4 text-foreground/70" />
                </div>
              </div>
              {/* Big number */}
              <p className="text-3xl font-bold text-foreground mt-3 tabular-nums">
                <AnimatedNumber value={stat.value} />
              </p>
              {/* Trend indicator */}
              {stat.trend && (
                <p className="text-xs font-medium mt-1.5 flex items-center gap-1">
                  {stat.trendUp === true && <span className="text-success">▲</span>}
                  {stat.trendUp === false && <span className="text-destructive">▼</span>}
                  <span className={stat.trendUp === true ? "text-success" : stat.trendUp === false ? "text-destructive" : "text-muted-foreground"}>{stat.trend}</span>
                </p>
              )}
              {/* Footer link */}
              <div className="mt-auto pt-3">
                <Link to={stat.link} className="text-[11px] font-medium text-primary/70 group-hover:text-primary transition-colors duration-160 ease-standard flex items-center gap-1">
                  View details <ArrowUpRight className="h-3 w-3" />
                </Link>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ── Funnel + Recent Leads ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2 border-border/60 shadow-none">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-semibold">Admission Funnel</CardTitle>
              <Button variant="link" size="sm" className="text-primary gap-1 px-0" asChild>
                <Link to="/admissions">View all <ChevronRight className="h-3.5 w-3.5" /></Link>
              </Button>
            </div>
            {/* RazorSense segmented progress bar */}
            <div className="flex h-2 w-full gap-0.5 mt-3 rounded-full overflow-hidden">
              {funnel.slice(0, 6).map((item, i) => (
                <div
                  key={item.stage}
                  className={`${funnelColors[i] || "bg-primary"} transition-all duration-640 ease-standard`}
                  style={{ flex: Math.max(item.count, 1) }}
                />
              ))}
            </div>
          </CardHeader>
          <CardContent className="space-y-3.5">
            {funnel.map((item, i) => (
              <div key={item.stage} className="flex items-center gap-4 animate-rs-slide-up cursor-pointer hover:opacity-80 transition-opacity duration-160 ease-standard" style={{ animationDelay: `${i * 50}ms`, animationFillMode: "both" }}>
                <span className="text-sm text-muted-foreground w-28 shrink-0">{item.stage}</span>
                <div className="flex-1 h-8 bg-muted rounded-lg overflow-hidden relative">
                  <div
                    className={`h-full ${funnelColors[i] || "bg-primary"} rounded-lg flex items-center justify-end pr-3 transition-all duration-640 ease-standard`}
                    style={{ width: `${Math.max((item.count / funnelMax) * 100, 5)}%` }}>
                    <span className="text-xs font-semibold text-primary-foreground tabular-nums">{item.count}</span>
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
            {recentLeads.map((lead: any, i: number) => (
              <Link to={`/admissions/${lead.id}`} key={lead.id}
                className="flex items-center gap-3 py-3 border-b border-border/30 last:border-0 hover:bg-muted/30 hover:-translate-x-0.5 transition-all duration-160 ease-standard animate-rs-slide-up"
                style={{ animationDelay: `${i * 60}ms`, animationFillMode: "both" }}>
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-pastel-purple text-xs font-bold text-foreground/70 animate-rs-scale-in">
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
            {recentLeads.length === 0 && (
              <div className="flex flex-col items-center justify-center py-10 animate-rs-slide-up">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted mb-3">
                  <Users className="h-5 w-5 text-muted-foreground" />
                </div>
                <p className="text-sm font-medium text-foreground">No leads yet</p>
                <p className="text-xs text-muted-foreground mt-1">New leads will appear here</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Suspense fallback={<AnalyticsFallback />}>
        <DashboardAnalytics
          selectedCampusId={selectedCampusId}
          studentCount={studentCount}
        />
      </Suspense>
    </>
  );
};

// ── Placeholder role dashboards ─────────────────────────────────────────────

const FacultyDashboard = () => (
  <>
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {[
        { label: "Today's Classes",     value: "—", icon: CalendarDays,  iconBg: "bg-pastel-blue" },
        { label: "Attendance %",         value: "—", icon: ClipboardCheck,iconBg: "bg-pastel-green" },
        { label: "Assignments Pending",  value: "—", icon: BookOpen,      iconBg: "bg-pastel-orange" },
        { label: "Announcements",        value: "—", icon: Bell,          iconBg: "bg-pastel-purple" },
      ].map((stat) => (
        <Card key={stat.label} className="border-border/60 shadow-none">
          <CardContent className="p-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{stat.label}</p>
                <p className="text-2xl font-bold text-foreground mt-1.5">{stat.value}</p>
              </div>
              <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${stat.iconBg}`}>
                <stat.icon className="h-5 w-5 text-foreground/70" />
              </div>
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
        { label: "Attendance %",   value: "—", icon: ClipboardCheck, iconBg: "bg-pastel-green" },
        { label: "Upcoming Exams", value: "—", icon: BookOpen,       iconBg: "bg-pastel-orange" },
        { label: "Fee Due",        value: "—", icon: IndianRupee,    iconBg: "bg-pastel-red" },
        { label: "Announcements",  value: "—", icon: Bell,           iconBg: "bg-pastel-blue" },
      ].map((stat) => (
        <Card key={stat.label} className="border-border/60 shadow-none">
          <CardContent className="p-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{stat.label}</p>
                <p className="text-2xl font-bold text-foreground mt-1.5">{stat.value}</p>
              </div>
              <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${stat.iconBg}`}>
                <stat.icon className="h-5 w-5 text-foreground/70" />
              </div>
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

const ParentDashboard = () => {
  const { user } = useAuth();
  const [children, setChildren] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.id) return;
    const fetchChildren = async () => {
      setLoading(true);
      const { data } = await supabase
        .from("students")
        .select("id, name, admission_no, pre_admission_no, section, status, phone, grade, courses:course_id(name), campuses:campus_id(name)")
        .or(`father_user_id.eq.${user.id},mother_user_id.eq.${user.id},guardian_user_id.eq.${user.id}`);
      setChildren(data || []);
      setLoading(false);
    };
    fetchChildren();
  }, [user?.id]);

  if (loading) return (
    <div className="flex h-64 items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-primary" />
    </div>
  );

  const statusColor: Record<string, string> = {
    active: "bg-success/10 text-success",
    pre_admitted: "bg-info/10 text-info-foreground",
    inactive: "bg-gray-100 text-gray-600",
    alumni: "bg-primary/10 text-primary",
  };

  return (
    <>
      <Card className="border-border/60 shadow-none">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            <CardTitle className="text-base font-semibold">My Children</CardTitle>
            <Badge variant="secondary" className="ml-auto text-xs">{children.length}</Badge>
          </div>
        </CardHeader>
        <CardContent>
          {children.length === 0 ? (
            <div className="text-center py-10">
              <Users className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">No students linked to your account yet.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {children.map((child: any) => {
                const admNo = child.admission_no || child.pre_admission_no || "—";
                const initials = (child.name || "?").split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase();
                return (
                  <Link
                    key={child.id}
                    to={`/students/${child.admission_no || child.pre_admission_no}`}
                    className="flex items-start gap-4 rounded-xl border border-border/60 p-4 hover:bg-muted/40 transition-colors"
                  >
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-pastel-purple text-sm font-bold text-foreground/70">
                      {initials}
                    </div>
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-foreground truncate">{child.name}</p>
                        <Badge className={`text-[11px] font-medium border-0 shrink-0 ${statusColor[child.status] || "bg-muted text-foreground/70"}`}>
                          {(child.status || "—").replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase())}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {(child.courses as any)?.name || "—"} {child.grade ? `· ${child.grade}` : ""} {child.section ? `· Sec ${child.section}` : ""}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Adm No: <span className="font-medium text-foreground/80">{admNo}</span>
                        {(child.campuses as any)?.name ? ` · ${(child.campuses as any).name}` : ""}
                      </p>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
                  </Link>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
};

// ── Page ────────────────────────────────────────────────────────────────────

const Dashboard = () => {
  const { role } = useAuth();

  // Redirect consultant to their portal
  if (role === "consultant") return <Navigate to="/consultant-portal" replace />;
  if (isAcademicPartnerPortalRole(role)) return <Navigate to="/academic-partner-portal" replace />;
  // Video editors land on their portal — they have no access to the staff dashboard.
  if (role === "video_editor") return <Navigate to="/video-editor" replace />;
  // Counsellors land on the cloud dialer — their prioritized queue is the day's work
  if (role === "counsellor") return <Navigate to="/cloud-dialer" replace />;

  const isAdmin   = ["super_admin", "campus_admin", "admission_head", "principal"].includes(role || "");
  const isFaculty = ["faculty", "teacher"].includes(role || "");
  const isStudent = role === "student";
  const isParent  = role === "parent";
  const isCounsellor = role === "counsellor";

  return (
    <div className="space-y-6 animate-fade-in">
      {isAdmin && <PendingApprovalsPanel />}
      {isAdmin && <ConsultantVoiceMessagesPanel />}
      {isAdmin   && <SuperAdminDashboard isSuperAdmin={role === "super_admin"} />}
      {isAdmin && <LeadAssignmentHistory limit={25} compact />}
      {isCounsellor && <SuperAdminDashboard isSuperAdmin={false} />}
      {isFaculty && <FacultyDashboard />}
      {isStudent && <StudentDashboard />}
      {isParent  && <ParentDashboard />}
      {!isAdmin && !isCounsellor && !isFaculty && !isStudent && !isParent && <SuperAdminDashboard isSuperAdmin={false} />}
    </div>
  );
};

export default Dashboard;
