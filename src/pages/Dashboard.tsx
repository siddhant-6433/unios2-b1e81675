import { dashboardStats } from "@/data/mockData";
import { useAuth } from "@/contexts/AuthContext";
import {
  Users, IndianRupee, AlertTriangle, GraduationCap, Building2,
  ClipboardCheck, BookOpen, CalendarDays, Bell, TrendingUp,
  ArrowUpRight, ChevronRight, Phone, MessageSquare, MoreHorizontal
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";

const stats = dashboardStats.superAdmin;

/* ── Funnel data with max for width calc ── */
const funnelMax = Math.max(...stats.admissionFunnel.map((s) => s.count));
const funnelColors = [
  "bg-primary", "bg-primary/85", "bg-primary/70",
  "bg-chart-2", "bg-chart-2/80", "bg-chart-3",
  "bg-chart-3/80", "bg-chart-5",
];

/* ── Lead sources ── */
const leadSources = [
  { name: "Website", count: 34, color: "bg-chart-5" },
  { name: "Meta Ads", count: 28, color: "bg-chart-2" },
  { name: "Google Ads", count: 22, color: "bg-chart-3" },
  { name: "Shiksha", count: 19, color: "bg-primary" },
  { name: "Walk-in", count: 16, color: "bg-chart-4" },
  { name: "Consultant", count: 12, color: "bg-pastel-pink" },
  { name: "JustDial", count: 11, color: "bg-chart-3/70" },
];
const sourceMax = Math.max(...leadSources.map((s) => s.count));

/* ── Counsellor performance ── */
const counsellors = [
  { name: "Ritu Verma", initials: "RV", bg: "bg-pastel-red", active: "2 min ago", leads: 48, calls: 94, visits: 8, conversion: 25 },
  { name: "Sunita Devi", initials: "SD", bg: "bg-pastel-purple", active: "Active now", leads: 52, calls: 112, visits: 11, conversion: 35 },
  { name: "Anil Kapoor", initials: "AK", bg: "bg-pastel-green", active: "15 min ago", leads: 35, calls: 78, visits: 5, conversion: 23 },
  { name: "Meera Singh", initials: "MS", bg: "bg-pastel-yellow", active: "1 hr ago", leads: 41, calls: 85, visits: 7, conversion: 24 },
];

/* ── Recent leads ── */
const recentLeads = [
  { name: "Rahul Sharma", initials: "RS", course: "B.Tech CS", campus: "NIMT GN", source: "Website", stage: "New", time: "3 min ago" },
  { name: "Priya Gupta", initials: "PG", course: "MBA", campus: "Kotputli", source: "Meta Ads", stage: "AI Called", time: "12 min ago" },
  { name: "Ankit Kumar", initials: "AK", course: "BBA", campus: "NIMT GN", source: "Shiksha", stage: "Counsellor Call", time: "28 min ago" },
  { name: "Sneha Rao", initials: "SR", course: "Class 5", campus: "Avantika II", source: "Walk-in", stage: "Visit Scheduled", time: "1 hr ago" },
  { name: "Vikram Patel", initials: "VP", course: "B.Tech ME", campus: "NIMT GN", source: "Google Ads", stage: "Offer", time: "2 hr ago" },
];

const stageBadgeClass: Record<string, string> = {
  New: "bg-pastel-blue text-foreground/70",
  "AI Called": "bg-pastel-purple text-foreground/70",
  "Counsellor Call": "bg-pastel-orange text-foreground/70",
  "Visit Scheduled": "bg-pastel-yellow text-foreground/70",
  Offer: "bg-pastel-green text-foreground/70",
};

/* ── Activity feed ── */
const activityFeed = [
  { icon: GraduationCap, text: "New admission: Meera Iyer – B.Tech CSE", time: "10 min ago" },
  { icon: Phone, text: "AI called 24 leads today — 83% connected", time: "30 min ago" },
  { icon: IndianRupee, text: "₹2.4L fee collected from 6 students", time: "1 hr ago" },
  { icon: MessageSquare, text: "WhatsApp sent to 18 applicants", time: "2 hr ago" },
];

/* ───────────────────────── Super Admin Dashboard ───────────────────────── */

const SuperAdminDashboard = () => {
  const statCards = [
    { label: "Total Leads", value: "500", sub: "+18 today", subColor: "text-primary", icon: Users, iconBg: "bg-pastel-blue" },
    { label: "AI Calls Today", value: "24", sub: "83% connect rate", subColor: "text-primary", icon: Phone, iconBg: "bg-pastel-orange" },
    { label: "Conversions", value: "48", sub: "9.6% rate", subColor: "text-primary", icon: TrendingUp, iconBg: "bg-pastel-green" },
    { label: "Visits This Week", value: "12", sub: "3 confirmed today", subColor: "text-primary", icon: CalendarDays, iconBg: "bg-pastel-purple" },
  ];

  return (
    <>
      {/* ── Stat Cards ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((stat) => (
          <Card key={stat.label} className="border-border/60 shadow-none hover:shadow-sm transition-shadow">
            <CardContent className="p-5">
              <div className="flex items-start justify-between">
                <div className={`flex h-11 w-11 items-center justify-center rounded-xl ${stat.iconBg}`}>
                  <stat.icon className="h-5 w-5 text-foreground/70" />
                </div>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground">
                  <ArrowUpRight className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-3xl font-bold text-foreground mt-4">{stat.value}</p>
              <p className="text-sm text-muted-foreground mt-0.5">{stat.label}</p>
              <p className={`text-xs font-medium mt-1 ${stat.subColor}`}>{stat.sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ── Admission Funnel + Activity ── */}
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
            {stats.admissionFunnel.map((item, i) => (
              <div key={item.stage} className="flex items-center gap-4">
                <span className="text-sm text-muted-foreground w-28 shrink-0">{item.stage}</span>
                <div className="flex-1 h-8 bg-muted rounded-lg overflow-hidden relative">
                  <div
                    className={`h-full ${funnelColors[i] || "bg-primary"} rounded-lg flex items-center justify-end pr-3 transition-all duration-500`}
                    style={{ width: `${(item.count / funnelMax) * 100}%` }}
                  >
                    <span className="text-xs font-semibold text-primary-foreground">{item.count}</span>
                  </div>
                </div>
                <span className="text-xs text-muted-foreground w-10 text-right">
                  {Math.round((item.count / funnelMax) * 100)}%
                </span>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Activity Feed */}
        <Card className="border-border/60 shadow-none">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">Recent Activity</CardTitle>
          </CardHeader>
          <CardContent className="space-y-0">
            {activityFeed.map((item, i) => (
              <div key={i} className="flex items-start gap-3 py-3 border-b border-border/40 last:border-0">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                  <item.icon className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-foreground leading-snug">{item.text}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{item.time}</p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* ── Counsellor Performance ── */}
      <Card className="border-border/60 shadow-none">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base font-semibold">Counsellor Performance</CardTitle>
            <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {/* Table header */}
          <div className="grid grid-cols-[1fr_80px_80px_80px_100px] gap-2 text-xs font-medium text-muted-foreground pb-3 border-b border-border/40">
            <span>Counsellor</span>
            <span className="text-center">Leads</span>
            <span className="text-center">Calls</span>
            <span className="text-center">Visits</span>
            <span className="text-right">Conversion</span>
          </div>
          {counsellors.map((c) => (
            <div key={c.name} className="grid grid-cols-[1fr_80px_80px_80px_100px] gap-2 items-center py-3.5 border-b border-border/30 last:border-0">
              <div className="flex items-center gap-3">
                <div className={`flex h-9 w-9 items-center justify-center rounded-full ${c.bg} text-xs font-bold text-foreground/70`}>
                  {c.initials}
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">{c.name}</p>
                  <p className="text-xs text-muted-foreground">{c.active}</p>
                </div>
              </div>
              <span className="text-sm font-semibold text-center text-foreground">{c.leads}</span>
              <span className="text-sm font-semibold text-center text-foreground">{c.calls}</span>
              <span className="text-sm font-semibold text-center text-foreground">{c.visits}</span>
              <div className="flex items-center justify-end gap-2">
                <div className="w-12 h-1.5 bg-muted rounded-full overflow-hidden">
                  <div className="h-full bg-chart-2 rounded-full" style={{ width: `${c.conversion}%` }} />
                </div>
                <span className="text-sm font-semibold text-primary">{c.conversion}%</span>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* ── Lead Sources + Recent Leads ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Lead Sources */}
        <Card className="border-border/60 shadow-none">
          <CardHeader className="pb-4">
            <CardTitle className="text-base font-semibold">Lead Sources</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {leadSources.map((src) => (
              <div key={src.name} className="flex items-center gap-3">
                <div className={`h-2.5 w-2.5 rounded-full ${src.color}`} />
                <span className="text-sm text-foreground flex-1">{src.name}</span>
                <div className="w-24 h-2 bg-muted rounded-full overflow-hidden">
                  <div className={`h-full ${src.color} rounded-full`} style={{ width: `${(src.count / sourceMax) * 100}%` }} />
                </div>
                <span className="text-sm font-semibold text-foreground w-8 text-right">{src.count}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Recent Leads */}
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
            {recentLeads.map((lead) => (
              <div key={lead.name} className="flex items-center gap-3 py-3 border-b border-border/30 last:border-0">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-pastel-purple text-xs font-bold text-foreground/70">
                  {lead.initials}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground">{lead.name}</p>
                  <p className="text-xs text-muted-foreground">{lead.course} · {lead.campus}</p>
                </div>
                <div className="hidden sm:flex items-center gap-2">
                  <Badge variant="outline" className="text-[11px] font-medium">{lead.source}</Badge>
                  <Badge className={`text-[11px] font-medium border-0 ${stageBadgeClass[lead.stage] || "bg-muted text-foreground/70"}`}>
                    {lead.stage}
                  </Badge>
                </div>
                <span className="text-xs text-muted-foreground whitespace-nowrap">{lead.time}</span>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground">
                    <Phone className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground">
                    <MessageSquare className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </>
  );
};

/* ───────────────────────── Faculty Dashboard ───────────────────────── */

const FacultyDashboard = () => (
  <>
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {[
        { label: "Today's Classes", value: "5", icon: CalendarDays, iconBg: "bg-pastel-blue" },
        { label: "Attendance %", value: "87%", icon: ClipboardCheck, iconBg: "bg-pastel-green" },
        { label: "Assignments Pending", value: "3", icon: BookOpen, iconBg: "bg-pastel-orange" },
        { label: "Announcements", value: "2", icon: Bell, iconBg: "bg-pastel-purple" },
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

/* ───────────────────────── Student Dashboard ───────────────────────── */

const StudentDashboard = () => (
  <>
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {[
        { label: "Attendance %", value: "92%", icon: ClipboardCheck, iconBg: "bg-pastel-green" },
        { label: "Upcoming Exams", value: "2", icon: BookOpen, iconBg: "bg-pastel-orange" },
        { label: "Fee Due", value: "₹15,000", icon: IndianRupee, iconBg: "bg-pastel-red" },
        { label: "Announcements", value: "3", icon: Bell, iconBg: "bg-pastel-blue" },
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

/* ───────────────────────── Parent Dashboard ───────────────────────── */

const ParentDashboard = () => (
  <>
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {[
        { label: "Child Attendance", value: "92%", icon: ClipboardCheck, iconBg: "bg-pastel-green" },
        { label: "Fee Due", value: "₹15,000", icon: IndianRupee, iconBg: "bg-pastel-red" },
        { label: "Announcements", value: "3", icon: Bell, iconBg: "bg-pastel-blue" },
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
        <Users className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
        <p className="text-sm text-muted-foreground">Your child's performance and updates will appear here.</p>
      </CardContent>
    </Card>
  </>
);

/* ───────────────────────── Main Dashboard ───────────────────────── */

const roleLabels: Record<string, string> = {
  super_admin: "Super Admin",
  campus_admin: "Campus Admin",
  principal: "Principal",
  faculty: "Faculty",
  teacher: "Teacher",
  student: "Student",
  parent: "Parent",
  counsellor: "Counsellor",
  accountant: "Accountant",
};

const Dashboard = () => {
  const { profile, role } = useAuth();
  const displayName = profile?.display_name || "User";
  const roleLabel = role ? (roleLabels[role] || role) : "User";

  const getDashboard = () => {
    switch (role) {
      case "faculty":
      case "teacher":
        return <FacultyDashboard />;
      case "student":
        return <StudentDashboard />;
      case "parent":
        return <ParentDashboard />;
      default:
        return <SuperAdminDashboard />;
    }
  };

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Good Morning, {displayName} 👋</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {roleLabel} Dashboard — Here's your overview for today.
          </p>
        </div>
        <div className="hidden sm:flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-2">
            <CalendarDays className="h-4 w-4" />
            This Month
          </Button>
          <Button size="sm" className="gap-2">
            + Add Lead
          </Button>
        </div>
      </div>
      {getDashboard()}
    </div>
  );
};

export default Dashboard;