import { dashboardStats } from "@/data/mockData";
import { TrendingUp, Users, IndianRupee, AlertTriangle, GraduationCap, Building2 } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";

const stats = dashboardStats.superAdmin;

const statCards = [
  { label: "Total Campuses", value: stats.totalCampuses, icon: Building2, color: "bg-pastel-blue" },
  { label: "Total Students", value: stats.totalStudents.toLocaleString(), icon: Users, color: "bg-pastel-green" },
  { label: "Fee Collected", value: `₹${(stats.feeCollected / 100000).toFixed(1)}L`, icon: IndianRupee, color: "bg-pastel-mint" },
  { label: "Overdue Amount", value: `₹${(stats.overdueAmount / 100000).toFixed(1)}L`, icon: AlertTriangle, color: "bg-pastel-red" },
  { label: "New Admissions", value: stats.newAdmissions, icon: GraduationCap, color: "bg-pastel-purple" },
];

const CHART_COLORS = [
  "hsl(175, 40%, 40%)", "hsl(250, 60%, 60%)", "hsl(45, 80%, 55%)",
  "hsl(0, 65%, 55%)", "hsl(215, 70%, 55%)", "hsl(330, 60%, 55%)",
  "hsl(150, 50%, 45%)", "hsl(30, 70%, 55%)"
];

const Dashboard = () => {
  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Good Morning, Admin 👋</h1>
        <p className="text-sm text-muted-foreground mt-1">Here's your institution overview for today.</p>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {statCards.map((stat) => (
          <div key={stat.label} className="rounded-xl bg-card p-5 card-shadow transition-all hover:card-shadow-md">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{stat.label}</p>
                <p className="text-2xl font-bold text-foreground mt-1.5">{stat.value}</p>
              </div>
              <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${stat.color}`}>
                <stat.icon className="h-5 w-5 text-foreground/70" />
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Admission Funnel */}
        <div className="rounded-xl bg-card p-6 card-shadow">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-base font-semibold text-foreground">Admission Funnel</h2>
            <span className="text-xs text-muted-foreground">2026 Session</span>
          </div>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={stats.admissionFunnel} barSize={28}>
              <XAxis dataKey="stage" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
              <Tooltip
                contentStyle={{
                  borderRadius: "12px",
                  border: "none",
                  boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
                  fontSize: "13px",
                }}
              />
              <Bar dataKey="count" fill="hsl(175, 40%, 40%)" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Campus Comparison */}
        <div className="rounded-xl bg-card p-6 card-shadow">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-base font-semibold text-foreground">Campus Comparison</h2>
            <span className="text-xs text-muted-foreground">Students & Fee</span>
          </div>
          <div className="flex items-center justify-center">
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie
                  data={stats.campusComparison}
                  cx="50%"
                  cy="50%"
                  innerRadius={65}
                  outerRadius={100}
                  dataKey="students"
                  nameKey="campus"
                  paddingAngle={4}
                >
                  {stats.campusComparison.map((_, index) => (
                    <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    borderRadius: "12px",
                    border: "none",
                    boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
                    fontSize: "13px",
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="flex justify-center gap-6 mt-2">
            {stats.campusComparison.map((c, i) => (
              <div key={c.campus} className="flex items-center gap-2 text-xs">
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: CHART_COLORS[i] }} />
                <span className="text-muted-foreground">{c.campus}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "4", sub: "New Leads", bg: "bg-pastel-blue" },
          { label: "3", sub: "Pending Interviews", bg: "bg-pastel-orange" },
          { label: "12", sub: "Fee Reminders", bg: "bg-pastel-red" },
          { label: "8", sub: "Today's Classes", bg: "bg-pastel-green" },
        ].map((item) => (
          <div key={item.sub} className={`rounded-xl ${item.bg} p-5 flex items-center gap-4 cursor-pointer transition-transform hover:scale-[1.02]`}>
            <span className="text-3xl font-bold text-foreground/80">{item.label}</span>
            <span className="text-sm font-medium text-foreground/60">{item.sub}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default Dashboard;
