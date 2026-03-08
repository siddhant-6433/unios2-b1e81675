import {
  LayoutDashboard, Users, GraduationCap, IndianRupee,
  ClipboardCheck, Settings, ShieldCheck, LogOut,
  Building2, BookOpen, BarChart3, FileText, School
} from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent,
  SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";

type AppRole = 
  | "super_admin" | "campus_admin" | "principal" | "admission_head"
  | "counsellor" | "accountant" | "faculty" | "teacher"
  | "data_entry" | "office_assistant" | "hostel_warden" | "student" | "parent";

type MenuItem = { title: string; url: string; icon: any; roles?: AppRole[] };

const allRolesExcept = (...excluded: AppRole[]): AppRole[] => {
  const all: AppRole[] = [
    "super_admin","campus_admin","principal","admission_head","counsellor",
    "accountant","faculty","teacher","data_entry","office_assistant",
    "hostel_warden","student","parent",
  ];
  return all.filter(r => !excluded.includes(r));
};

const staffRoles = allRolesExcept("student", "parent");
const adminRoles: AppRole[] = ["super_admin", "campus_admin", "principal"];

const mainMenu: MenuItem[] = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard },
  { title: "Admissions", url: "/admissions", icon: GraduationCap, roles: [...adminRoles, "admission_head", "counsellor", "data_entry"] },
  { title: "Students", url: "/students", icon: Users, roles: staffRoles },
  { title: "Attendance", url: "/attendance", icon: ClipboardCheck, roles: [...staffRoles, "student", "parent"] },
  { title: "Finance", url: "/finance", icon: IndianRupee, roles: [...adminRoles, "accountant"] },
  { title: "Exams", url: "/exams", icon: BookOpen, roles: [...staffRoles, "student", "parent"] },
];

const managementMenu: MenuItem[] = [
  { title: "Campuses", url: "/campuses", icon: Building2, roles: adminRoles },
  { title: "Courses", url: "/courses", icon: School, roles: [...adminRoles, "faculty", "teacher"] },
  { title: "Reports", url: "/reports", icon: BarChart3, roles: adminRoles },
  { title: "Documents", url: "/documents", icon: FileText, roles: staffRoles },
  { title: "User Management", url: "/admin", icon: ShieldCheck, roles: ["super_admin"] },
];

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
  admission_head: "Admission Head",
  data_entry: "Data Entry",
  office_assistant: "Office Assistant",
  hostel_warden: "Hostel Warden",
};

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();
  const isActive = (path: string) => location.pathname === path;
  const { profile, role, signOut } = useAuth();

  const displayName = profile?.display_name || "User";
  const roleLabel = role ? (roleLabels[role] || role) : "User";
  const initials = displayName.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();

  const linkClass = "gap-3 rounded-xl px-3 py-2.5 text-[13px] font-medium text-sidebar-foreground transition-all hover:bg-sidebar-accent hover:text-sidebar-accent-foreground";
  const activeClass = "!bg-primary !text-primary-foreground font-semibold shadow-sm";

  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border">
      <SidebarContent className="bg-sidebar pt-5">
        {/* Logo & Module Header */}
        <div className="px-4 pb-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary shadow-sm">
              <GraduationCap className="h-5 w-5 text-primary-foreground" />
            </div>
            {!collapsed && (
              <div className="flex flex-col">
                <span className="text-sm font-bold text-foreground tracking-tight">NIMT UniOs</span>
                <span className="text-[11px] text-muted-foreground">Education Platform</span>
              </div>
            )}
          </div>
        </div>

        <SidebarGroup>
          <SidebarGroupLabel className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/60 px-4 mb-1">
            Main Menu
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {mainMenu.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild isActive={isActive(item.url)}>
                    <NavLink
                      to={item.url}
                      end={item.url === "/"}
                      className={linkClass}
                      activeClassName={activeClass}
                    >
                      <item.icon className="h-[18px] w-[18px]" />
                      {!collapsed && <span>{item.title}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/60 px-4 mb-1">
            Management
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {managementMenu.filter((item) => !("adminOnly" in item && item.adminOnly) || role === "super_admin").map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild isActive={isActive(item.url)}>
                    <NavLink
                      to={item.url}
                      className={linkClass}
                      activeClassName={activeClass}
                    >
                      <item.icon className="h-[18px] w-[18px]" />
                      {!collapsed && <span>{item.title}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <div className="mt-auto">
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={isActive("/settings")}>
                    <NavLink
                      to="/settings"
                      className={linkClass}
                      activeClassName={activeClass}
                    >
                      <Settings className="h-[18px] w-[18px]" />
                      {!collapsed && <span>Settings</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>

          {/* Account */}
          {!collapsed && (
            <div className="border-t border-sidebar-border px-4 py-3.5">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                  {initials}
                </div>
                <div className="flex flex-col flex-1 min-w-0">
                  <span className="text-[13px] font-semibold text-foreground truncate">{displayName}</span>
                  <span className="text-[11px] text-muted-foreground">{roleLabel}</span>
                </div>
                <button onClick={signOut} className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground transition-colors" title="Sign out">
                  <LogOut className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      </SidebarContent>
    </Sidebar>
  );
}