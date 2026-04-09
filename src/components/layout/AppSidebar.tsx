import { useState, useEffect } from "react";
import uniosLogo from "@/assets/unios-logo.png";
import {
  LayoutDashboard, Users, GraduationCap, IndianRupee,
  ClipboardCheck, Settings, LogOut,
  BookOpen, BarChart3, FileText, Search, Shuffle, Handshake, PieChart,
  ChevronDown, Phone, Calendar, MessageSquare, Newspaper, Building2, School, ShieldCheck, Zap, Inbox,
  Globe, FolderOpen, Heart, Award, Target, GitMerge
} from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent,
  SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem,
  SidebarMenuSub, SidebarMenuSubButton, SidebarMenuSubItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useCampus } from "@/contexts/CampusContext";

type AppRole =
  | "super_admin" | "campus_admin" | "principal" | "admission_head"
  | "counsellor" | "accountant" | "faculty" | "teacher"
  | "data_entry" | "office_assistant" | "hostel_warden" | "consultant" | "student" | "parent"
  | "ib_coordinator";

type MenuItem = { title: string; url: string; icon: any; roles?: AppRole[]; badge?: number };

const allRolesExcept = (...excluded: AppRole[]): AppRole[] => {
  const all: AppRole[] = [
    "super_admin","campus_admin","principal","admission_head","counsellor",
    "accountant","faculty","teacher","data_entry","office_assistant",
    "hostel_warden","consultant","student","parent","ib_coordinator",
  ];
  return all.filter(r => !excluded.includes(r));
};

const staffRoles = allRolesExcept("student", "parent", "consultant");
const adminRoles: AppRole[] = ["super_admin", "campus_admin", "principal"];

const mainMenu: MenuItem[] = [
  { title: "Overview", url: "/", icon: LayoutDashboard, roles: allRolesExcept("consultant") },
  { title: "Search", url: "/search", icon: Search, roles: staffRoles },
  { title: "Students", url: "/students", icon: Users, roles: staffRoles },
  { title: "Attendance", url: "/attendance", icon: ClipboardCheck, roles: [...staffRoles, "student", "parent"] },
  { title: "Exams", url: "/exams", icon: BookOpen, roles: [...staffRoles, "student", "parent"] },
  { title: "Finance", url: "/finance", icon: IndianRupee, roles: [...adminRoles, "accountant"] },
  { title: "Reports", url: "/reports", icon: BarChart3, roles: adminRoles },
];

const admissionSubMenu: MenuItem[] = [
  { title: "Leads", url: "/admissions", icon: GraduationCap, roles: [...adminRoles, "admission_head", "counsellor", "data_entry"] },
  { title: "WhatsApp", url: "/whatsapp-inbox", icon: MessageSquare, roles: [...adminRoles, "admission_head", "counsellor"] },
  { title: "Performance", url: "/counsellor-dashboard", icon: BarChart3, roles: [...adminRoles, "admission_head"] },
  { title: "Lead Buckets", url: "/lead-buckets", icon: Inbox, roles: [...adminRoles, "admission_head", "counsellor"] },
  { title: "Lead Allocation", url: "/lead-allocation", icon: Shuffle, roles: ["super_admin", "admission_head"] },
  { title: "Automation", url: "/automation-rules", icon: Zap, roles: ["super_admin", "admission_head"] },
  { title: "Consultants", url: "/consultants", icon: Handshake, roles: [...adminRoles, "admission_head", "counsellor"] },
  { title: "Templates", url: "/template-manager", icon: Newspaper, roles: ["super_admin", "admission_head"] },
  { title: "Courses & Fees", url: "/fee-structures", icon: IndianRupee, roles: [...adminRoles, "admission_head", "counsellor", "consultant"] },
  { title: "My Leads", url: "/consultant-portal", icon: Users, roles: ["consultant"] },
  { title: "Analytics", url: "/admission-analytics", icon: PieChart, roles: [...adminRoles, "admission_head"] },
];

const ibAcademicsSubMenu: MenuItem[] = [
  { title: "Programme of Inquiry", url: "/ib/poi",        icon: Globe,      roles: [...adminRoles, "ib_coordinator", "faculty", "teacher"] },
  { title: "Unit Planner",         url: "/ib/units",      icon: BookOpen,   roles: [...adminRoles, "ib_coordinator", "faculty", "teacher"] },
  { title: "Gradebook",            url: "/ib/gradebook",  icon: BarChart3,  roles: [...adminRoles, "ib_coordinator", "faculty", "teacher"] },
  { title: "Portfolios",           url: "/ib/portfolios", icon: FolderOpen, roles: [...adminRoles, "ib_coordinator", "faculty", "teacher", "student", "parent"] },
  { title: "Action & Service",     url: "/ib/action",     icon: Heart,      roles: [...adminRoles, "ib_coordinator", "faculty", "teacher", "student"] },
  { title: "Report Cards",         url: "/ib/reports",    icon: FileText,   roles: [...adminRoles, "ib_coordinator", "faculty", "teacher", "student", "parent"] },
  { title: "Exhibition",           url: "/ib/exhibition", icon: Award,      roles: [...adminRoles, "ib_coordinator", "faculty", "teacher"] },
  { title: "MYP Projects",         url: "/ib/projects",   icon: Target,     roles: [...adminRoles, "ib_coordinator", "faculty", "teacher", "student"] },
  { title: "IDU",                   url: "/ib/idu",       icon: GitMerge,   roles: [...adminRoles, "ib_coordinator", "faculty", "teacher"] },
];

const managementMenu: MenuItem[] = [
  { title: "Campuses & Courses", url: "/admin?tab=course-campus", icon: Building2, roles: adminRoles },
  { title: "Documents", url: "/documents", icon: FileText, roles: [...staffRoles] },
  { title: "User Management", url: "/admin", icon: ShieldCheck, roles: ["super_admin"] },
];

const roleLabels: Record<string, string> = {
  super_admin: "Super Admin", campus_admin: "Campus Admin", principal: "Principal",
  faculty: "Faculty", teacher: "Teacher", student: "Student", parent: "Parent",
  counsellor: "Counsellor", accountant: "Accountant", admission_head: "Admission Head",
  data_entry: "Data Entry", office_assistant: "Office Assistant", hostel_warden: "Hostel Warden",
  ib_coordinator: "IB Coordinator",
};

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();
  const isActive = (path: string) => {
    if (path.includes("?")) return location.pathname + location.search === path;
    return location.pathname === path;
  };
  const { profile, role, realRole, isImpersonating, signOut } = useAuth();
  const { campuses, selectedCampusId, setSelectedCampusId } = useCampus();

  const displayName = profile?.display_name || "User";
  const roleLabel = role ? (roleLabels[role] || role) : "User";
  const initials = displayName.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();

  const canSee = (item: MenuItem) => {
    if (!item.roles) return true;
    // When impersonating, always show the User Management link so admin can navigate back
    if (isImpersonating && realRole === "super_admin" && item.url === "/admin") return true;
    return role && item.roles.includes(role);
  };

  // WhatsApp unread count
  const [waUnread, setWaUnread] = useState(0);
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("whatsapp_conversations" as any)
        .select("unread_count");
      if (data) {
        setWaUnread((data as any[]).reduce((sum: number, c: any) => sum + (c.unread_count || 0), 0));
      }
    })();

    const channel = supabase
      .channel("wa-unread-sidebar")
      .on("postgres_changes" as any, {
        event: "*",
        schema: "public",
        table: "whatsapp_messages",
      }, () => {
        // Refetch on any message change
        supabase
          .from("whatsapp_conversations" as any)
          .select("unread_count")
          .then(({ data }) => {
            if (data) {
              setWaUnread((data as any[]).reduce((sum: number, c: any) => sum + (c.unread_count || 0), 0));
            }
          });
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  const visibleMain = mainMenu.filter(canSee);
  const visibleAdmission = admissionSubMenu.filter(canSee).map(item =>
    item.url === "/whatsapp-inbox" && waUnread > 0
      ? { ...item, badge: waUnread }
      : item
  );
  const visibleIB = ibAcademicsSubMenu.filter(canSee);
  const visibleMgmt = managementMenu.filter(canSee);
  const isAdmissionActive = admissionSubMenu.some(item => isActive(item.url));
  const isIBActive = ibAcademicsSubMenu.some(item => isActive(item.url) || location.pathname.startsWith("/ib/"));

  // IB Academics only shows when Mirai campus is selected (or "all" for super_admin)
  const isMiraiContext = selectedCampusId === "all" || campuses.find(c => c.id === selectedCampusId)?.name?.toLowerCase().includes("mirai");

  const linkClass = "gap-3 rounded-lg px-3 py-2 text-[13px] font-medium text-sidebar-foreground/70 transition-all hover:bg-sidebar-accent hover:text-sidebar-accent-foreground";
  const activeClass = "!bg-sidebar-accent !text-sidebar-accent-foreground font-semibold";
  const subLinkClass = "gap-2.5 rounded-lg px-3 py-1.5 text-[12.5px] font-medium text-sidebar-foreground/70 transition-all hover:bg-sidebar-accent hover:text-sidebar-accent-foreground";

  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border">
      <SidebarContent className="bg-sidebar pt-4">
        {/* Logo */}
        <div className="px-4 pb-2">
          <div className="flex items-center gap-3">
            <img src={uniosLogo} alt="UniOs" className="h-8 w-8 object-contain" />
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
            <select
              value={selectedCampusId}
              onChange={(e) => setSelectedCampusId(e.target.value)}
              className="w-full rounded-lg border border-border bg-muted/40 px-3 py-2 text-[12px] font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 cursor-pointer"
            >
              <option value="all">All Campuses</option>
              {campuses.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
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
                                <span className="flex-1">{item.title}</span>
                                {item.badge ? (
                                  <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-green-500 text-[9px] font-bold text-white px-1">
                                    {item.badge > 99 ? "99+" : item.badge}
                                  </span>
                                ) : null}
                              </NavLink>
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                        ))}
                      </SidebarMenuSub>
                    </CollapsibleContent>
                  </SidebarMenuItem>
                </Collapsible>
              )}

              {/* Collapsible IB Academics — only when Mirai campus context */}
              {isMiraiContext && visibleIB.length > 0 && (
                <Collapsible defaultOpen={isIBActive} className="group/collapsible">
                  <SidebarMenuItem>
                    <CollapsibleTrigger asChild>
                      <SidebarMenuButton className={`${linkClass} justify-between`} isActive={isIBActive}>
                        <span className="flex items-center gap-3">
                          <School className="h-[17px] w-[17px]" />
                          {!collapsed && <span>IB Academics</span>}
                        </span>
                        {!collapsed && (
                          <ChevronDown className="h-3.5 w-3.5 transition-transform group-data-[state=open]/collapsible:rotate-180" />
                        )}
                      </SidebarMenuButton>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <SidebarMenuSub>
                        {visibleIB.map((item) => (
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
