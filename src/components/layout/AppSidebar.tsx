import {
  LayoutDashboard, Users, GraduationCap, IndianRupee,
  ClipboardCheck, Settings, LogOut,
  BookOpen, BarChart3, FileText, Search, Shuffle, Handshake, PieChart,
  ChevronDown, Phone, Calendar, MessageSquare, Newspaper, Building2, School, ShieldCheck
} from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent,
  SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem,
  SidebarMenuSub, SidebarMenuSubButton, SidebarMenuSubItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

type AppRole =
  | "super_admin" | "campus_admin" | "principal" | "admission_head"
  | "counsellor" | "accountant" | "faculty" | "teacher"
  | "data_entry" | "office_assistant" | "hostel_warden" | "student" | "parent";

type MenuItem = { title: string; url: string; icon: any; roles?: AppRole[]; badge?: number };

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
  { title: "Overview", url: "/", icon: LayoutDashboard },
  { title: "Search", url: "/search", icon: Search, roles: staffRoles },
  { title: "Students", url: "/students", icon: Users, roles: staffRoles },
  { title: "Attendance", url: "/attendance", icon: ClipboardCheck, roles: [...staffRoles, "student", "parent"] },
  { title: "Exams", url: "/exams", icon: BookOpen, roles: [...staffRoles, "student", "parent"] },
  { title: "Finance", url: "/finance", icon: IndianRupee, roles: [...adminRoles, "accountant"] },
  { title: "Reports", url: "/reports", icon: BarChart3, roles: adminRoles },
];

const admissionSubMenu: MenuItem[] = [
  { title: "Leads", url: "/admissions", icon: GraduationCap, roles: [...adminRoles, "admission_head", "counsellor", "data_entry"] },
  { title: "Lead Allocation", url: "/lead-allocation", icon: Shuffle, roles: ["super_admin", "admission_head"] },
  { title: "Consultants", url: "/consultants", icon: Handshake, roles: [...adminRoles, "admission_head", "counsellor"] },
  { title: "Analytics", url: "/admission-analytics", icon: PieChart, roles: [...adminRoles, "admission_head"] },
];

const managementMenu: MenuItem[] = [
  { title: "Campuses", url: "/admin?tab=course-campus", icon: Building2, roles: adminRoles },
  { title: "Courses", url: "/admin?tab=course-campus", icon: School, roles: [...adminRoles, "faculty", "teacher"] },
  { title: "Documents", url: "/documents", icon: FileText, roles: staffRoles },
  { title: "User Management", url: "/admin", icon: ShieldCheck, roles: ["super_admin"] },
];

const roleLabels: Record<string, string> = {
  super_admin: "Super Admin", campus_admin: "Campus Admin", principal: "Principal",
  faculty: "Faculty", teacher: "Teacher", student: "Student", parent: "Parent",
  counsellor: "Counsellor", accountant: "Accountant", admission_head: "Admission Head",
  data_entry: "Data Entry", office_assistant: "Office Assistant", hostel_warden: "Hostel Warden",
};

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();
  const isActive = (path: string) => {
    if (path.includes("?")) return location.pathname + location.search === path;
    return location.pathname === path;
  };
  const { profile, role, signOut } = useAuth();

  // Campus selector
  const [campuses, setCampuses] = useState<{ id: string; name: string }[]>([]);
  const [selectedCampus, setSelectedCampus] = useState("");
  const [campusOpen, setCampusOpen] = useState(false);

  useEffect(() => {
    supabase.from("campuses").select("id, name").order("name").then(({ data }) => {
      if (data && data.length > 0) {
        setCampuses(data);
        setSelectedCampus(data[0].name);
      }
    });
  }, []);

  const displayName = profile?.display_name || "User";
  const roleLabel = role ? (roleLabels[role] || role) : "User";
  const initials = displayName.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();

  const canSee = (item: MenuItem) => !item.roles || (role && item.roles.includes(role));

  const visibleMain = mainMenu.filter(canSee);
  const visibleAdmission = admissionSubMenu.filter(canSee);
  const visibleMgmt = managementMenu.filter(canSee);
  const isAdmissionActive = admissionSubMenu.some(item => isActive(item.url));

  const linkClass = "gap-3 rounded-lg px-3 py-2 text-[13px] font-medium text-sidebar-foreground/70 transition-all hover:bg-sidebar-accent hover:text-sidebar-accent-foreground";
  const activeClass = "!bg-sidebar-accent !text-sidebar-accent-foreground font-semibold";
  const subLinkClass = "gap-2.5 rounded-lg px-3 py-1.5 text-[12.5px] font-medium text-sidebar-foreground/70 transition-all hover:bg-sidebar-accent hover:text-sidebar-accent-foreground";

  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border">
      <SidebarContent className="bg-sidebar pt-4">
        {/* Logo */}
        <div className="px-4 pb-2">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-foreground shadow-sm">
              <GraduationCap className="h-4 w-4 text-background" />
            </div>
            {!collapsed && (
              <div className="flex flex-col">
                <span className="text-sm font-bold text-foreground tracking-tight">NIMT UniOs</span>
              </div>
            )}
          </div>
        </div>

        {/* Campus Selector */}
        {!collapsed && campuses.length > 0 && (
          <div className="px-3 pb-3">
            <Collapsible open={campusOpen} onOpenChange={setCampusOpen}>
              <CollapsibleTrigger className="w-full flex items-center justify-between rounded-lg border border-border bg-muted/40 px-3 py-2 text-[12px] font-medium text-foreground hover:bg-muted/60 transition-colors">
                <span className="truncate">{selectedCampus}</span>
                <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${campusOpen ? "rotate-180" : ""}`} />
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="mt-1 rounded-lg border border-border bg-card p-1 shadow-sm">
                  {campuses.map(c => (
                    <button key={c.id} onClick={() => { setSelectedCampus(c.name); setCampusOpen(false); }}
                      className={`w-full text-left rounded-md px-3 py-1.5 text-[12px] transition-colors ${c.name === selectedCampus ? "bg-primary/10 text-primary font-medium" : "text-foreground hover:bg-muted/50"}`}>
                      {c.name}
                    </button>
                  ))}
                </div>
              </CollapsibleContent>
            </Collapsible>
          </div>
        )}

        <SidebarGroup>
          <SidebarGroupLabel className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/50 px-4 mb-0.5">
            Main Menu
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {visibleMain.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild isActive={isActive(item.url)}>
                    <NavLink to={item.url} end={item.url === "/"} className={linkClass} activeClassName={activeClass}>
                      <item.icon className="h-[17px] w-[17px]" />
                      {!collapsed && (
                        <span className="flex-1">{item.title}</span>
                      )}
                      {!collapsed && item.badge && (
                        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-destructive-foreground px-1">
                          {item.badge}
                        </span>
                      )}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}

              {/* Collapsible Admissions */}
              {visibleAdmission.length > 0 && (
                <Collapsible defaultOpen={isAdmissionActive} className="group/collapsible">
                  <SidebarMenuItem>
                    <CollapsibleTrigger asChild>
                      <SidebarMenuButton className={`${linkClass} justify-between`} isActive={isAdmissionActive}>
                        <span className="flex items-center gap-3">
                          <GraduationCap className="h-[17px] w-[17px]" />
                          {!collapsed && <span>Admissions</span>}
                        </span>
                        {!collapsed && (
                          <ChevronDown className="h-3.5 w-3.5 transition-transform group-data-[state=open]/collapsible:rotate-180" />
                        )}
                      </SidebarMenuButton>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <SidebarMenuSub>
                        {visibleAdmission.map((item) => (
                          <SidebarMenuSubItem key={item.title}>
                            <SidebarMenuSubButton asChild isActive={isActive(item.url)}>
                              <NavLink to={item.url} className={subLinkClass} activeClassName={activeClass}>
                                <item.icon className="h-3.5 w-3.5" />
                                <span>{item.title}</span>
                              </NavLink>
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                        ))}
                      </SidebarMenuSub>
                    </CollapsibleContent>
                  </SidebarMenuItem>
                </Collapsible>
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {visibleMgmt.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/50 px-4 mb-0.5">
              Management
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {visibleMgmt.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild isActive={isActive(item.url)}>
                      <NavLink to={item.url} className={linkClass} activeClassName={activeClass}>
                        <item.icon className="h-[17px] w-[17px]" />
                        {!collapsed && <span>{item.title}</span>}
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {/* Bottom: Settings + Account */}
        <div className="mt-auto">
          <SidebarGroup>
            <SidebarGroupLabel className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/50 px-4 mb-0.5">
              Settings
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={isActive("/settings")}>
                    <NavLink to="/settings" className={linkClass} activeClassName={activeClass}>
                      <Settings className="h-[17px] w-[17px]" />
                      {!collapsed && <span>Settings</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>

          {/* Account */}
          {!collapsed && (
            <div className="border-t border-sidebar-border px-4 py-3">
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-orange-400 text-xs font-bold text-white">
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
