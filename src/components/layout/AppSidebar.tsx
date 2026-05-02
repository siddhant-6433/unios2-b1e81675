import { useState, useEffect } from "react";
import uniosLogo from "@/assets/unios-logo.png";
import {
  LayoutDashboard, Users, GraduationCap, IndianRupee,
  ClipboardCheck, Settings, LogOut,
  BookOpen, BarChart3, FileText, Search, Shuffle, Handshake, PieChart,
  ChevronDown, Phone, Calendar, MessageSquare, Newspaper, Building2, School, ShieldCheck, Zap, Inbox,
  Globe, FolderOpen, Heart, Award, Target, GitMerge, Bot, Gift, AlertTriangle, Sparkles, Receipt,
  Briefcase, CalendarOff, UserCheck, Fingerprint, PhoneCall, Send,
} from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { usePermissions } from "@/contexts/PermissionContext";
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
  | "data_entry" | "office_admin" | "office_assistant" | "hostel_warden" | "consultant" | "student" | "parent"
  | "ib_coordinator";

type MenuItem = { title: string; url: string; icon: any; permission?: string; badge?: number; hideForSuperAdmin?: boolean };

const mainMenu: MenuItem[] = [
  { title: "Overview", url: "/", icon: LayoutDashboard, permission: "dashboard:view" },
  { title: "Search", url: "/search", icon: Search, permission: "search:view" },
  { title: "Students", url: "/students", icon: Users, permission: "students:view" },
  { title: "Attendance", url: "/attendance", icon: ClipboardCheck, permission: "attendance:view" },
  { title: "Exams", url: "/exams", icon: BookOpen, permission: "exams:view" },
  { title: "Finance", url: "/finance", icon: IndianRupee, permission: "finance:view" },
  { title: "Collections", url: "/collections", icon: Receipt, permission: "finance:view" },
  { title: "Refer & Earn", url: "/referrals", icon: Gift, permission: "referrals:view" },
  { title: "Reports", url: "/reports", icon: BarChart3, permission: "reports:view" },
];

const admissionSubMenu: MenuItem[] = [
  { title: "Lead Dashboard", url: "/admissions", icon: GraduationCap, permission: "leads:view" },
  { title: "Applications", url: "/applications", icon: FileText, permission: "leads:view" },
  { title: "Cloud Dialer", url: "/cloud-dialer", icon: PhoneCall, permission: "call_log:view" },
  { title: "WhatsApp", url: "/whatsapp-inbox", icon: MessageSquare, permission: "whatsapp:view" },
  { title: "WA Outbound", url: "/whatsapp-inbox?mode=outbound", icon: Send, permission: "whatsapp:view" },
  { title: "Performance", url: "/counsellor-dashboard", icon: BarChart3, permission: "performance:view" },
  { title: "Lead Buckets", url: "/lead-buckets", icon: Inbox, permission: "lead_buckets:view" },
  { title: "Lead Allocation", url: "/lead-allocation", icon: Shuffle, permission: "lead_allocation:view" },
  { title: "Fresh Leads", url: "/fresh-leads", icon: Sparkles, permission: "call_log:view" },
  { title: "Pending Follow-ups", url: "/pending-followups", icon: AlertTriangle, permission: "call_log:view" },
  { title: "Call Log", url: "/call-log", icon: Phone, permission: "call_log:view" },
  { title: "AI Call Log", url: "/ai-call-log", icon: Bot, permission: "automation:view" },
  { title: "Automation", url: "/automation-rules", icon: Zap, permission: "automation:view" },
  { title: "Consultants", url: "/consultants", icon: Handshake, permission: "consultants:view" },
  { title: "Templates", url: "/template-manager", icon: Newspaper, permission: "templates:view" },
  { title: "Courses & Fees", url: "/fee-structures", icon: IndianRupee, permission: "courses_fees:view" },
  { title: "My Leads", url: "/consultant-portal", icon: Users, permission: "consultant_portal:view", hideForSuperAdmin: true },
  { title: "Publisher Leads", url: "/publisher-portal", icon: Users, permission: "publisher_portal:view", hideForSuperAdmin: true },
  { title: "Publisher Portal", url: "/publisher-portal", icon: Users, permission: "user_management:view" },
  { title: "Publisher Analytics", url: "/publisher-analytics", icon: PieChart, permission: "user_management:view" },
  { title: "Analytics", url: "/admission-analytics", icon: PieChart, permission: "analytics:view" },
];

const ibAcademicsSubMenu: MenuItem[] = [
  { title: "Programme of Inquiry", url: "/ib/poi",        icon: Globe,      permission: "ib_poi:view" },
  { title: "Unit Planner",         url: "/ib/units",      icon: BookOpen,   permission: "ib_units:view" },
  { title: "Gradebook",            url: "/ib/gradebook",  icon: BarChart3,  permission: "ib_gradebook:view" },
  { title: "Portfolios",           url: "/ib/portfolios", icon: FolderOpen, permission: "ib_portfolios:view" },
  { title: "Action & Service",     url: "/ib/action",     icon: Heart,      permission: "ib_action:view" },
  { title: "Report Cards",         url: "/ib/reports",    icon: FileText,   permission: "ib_reports:view" },
  { title: "Exhibition",           url: "/ib/exhibition", icon: Award,      permission: "ib_exhibition:view" },
  { title: "MYP Projects",         url: "/ib/projects",   icon: Target,     permission: "ib_projects:view" },
  { title: "IDU",                   url: "/ib/idu",       icon: GitMerge,   permission: "ib_idu:view" },
];

const hrSubMenu: MenuItem[] = [
  { title: "HR Overview", url: "/hr", icon: Briefcase, permission: "hr:view" },
  { title: "Attendance", url: "/hr-attendance", icon: Fingerprint, permission: "hr:view" },
  { title: "Leave Mgmt", url: "/hr-leave", icon: CalendarOff, permission: "hr:view" },
  { title: "Directory", url: "/hr-directory", icon: Users, permission: "hr:view" },
];

const managementMenu: MenuItem[] = [
  { title: "Campuses & Courses", url: "/admin?tab=course-campus", icon: Building2, permission: "campuses_courses:view" },
  { title: "Documents", url: "/documents", icon: FileText, permission: "documents:view" },
  { title: "Alumni Verification", url: "/alumni-verifications", icon: ShieldCheck, permission: "alumni_verification:view" },
  { title: "User Management", url: "/admin", icon: ShieldCheck, permission: "user_management:view" },
  { title: "Permissions", url: "/admin?tab=permissions", icon: ShieldCheck, permission: "permissions:view" },
];

const roleLabels: Record<string, string> = {
  super_admin: "Super Admin", campus_admin: "Campus Admin", principal: "Principal",
  faculty: "Faculty", teacher: "Teacher", student: "Student", parent: "Parent",
  counsellor: "Counsellor", accountant: "Accountant", admission_head: "Admission Head",
  data_entry: "Data Entry", office_admin: "Office Administrator", office_assistant: "Office Assistant", hostel_warden: "Hostel Warden",
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
  const { user, profile, role, realRole, isImpersonating, signOut } = useAuth();
  const { campuses, selectedCampusId, setSelectedCampusId } = useCampus();

  const displayName = profile?.display_name || "User";
  const roleLabel = role ? (roleLabels[role] || role) : "User";
  const initials = displayName.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();

  const { can } = usePermissions();
  const canSee = (item: MenuItem) => {
    if (!item.permission) return true;
    // When impersonating, always show User Management so admin can navigate back
    if (isImpersonating && realRole === "super_admin" && item.url === "/admin") return true;
    // Role-specific portals: hide from super_admin when not impersonating
    if (item.hideForSuperAdmin && realRole === "super_admin" && !isImpersonating) return false;
    const [mod, act] = item.permission.split(":");
    return can(mod, act);
  };

  // WhatsApp unread count
  const [waUnread, setWaUnread] = useState(0);
  // New leads count (stage = new_lead)
  const [newLeadCount, setNewLeadCount] = useState(0);
  // Pending approvals for current user role
  const [pendingApprovals, setPendingApprovals] = useState(0);
  // TAT defaults for current user
  const [tatDefaults, setTatDefaults] = useState(0);
  // Pending followups count for sidebar badge
  const [pendingFollowupCount, setPendingFollowupCount] = useState(0);

  const fetchNewLeadCount = () => {
    let query = supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("stage", "new_lead");
    // Counsellors only see their assigned leads
    if (role === "counsellor" && profile?.id) {
      query = query.eq("counsellor_id", profile.id);
    }
    query.then(({ count }) => setNewLeadCount(count || 0));
  };

  const fetchPendingApprovals = async () => {
    // Only approvers need this count
    if (!["super_admin", "principal", "campus_admin", "admission_head"].includes(role || "")) {
      setPendingApprovals(0);
      return;
    }
    const { data } = await supabase.rpc("count_pending_approvals" as any);
    setPendingApprovals(Number(data) || 0);
  };

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("whatsapp_conversations" as any)
        .select("unread_count")
        .gt("unread_count", 0);
      if (data) {
        setWaUnread((data as any[]).reduce((sum: number, c: any) => sum + (c.unread_count || 0), 0));
      }
    })();
    fetchNewLeadCount();
    fetchPendingApprovals();

    // Fetch TAT defaults for sidebar badge
    (async () => {
      const { data } = await supabase
        .from("counsellor_tat_defaults" as any)
        .select("total_defaults, user_id");
      if (data) {
        // For counsellors: show their own defaults. For admins: show team total.
        if (role === "counsellor") {
          const mine = (data as any[]).find(d => d.user_id === user?.id);
          setTatDefaults(mine?.total_defaults || 0);
        } else {
          setTatDefaults((data as any[]).reduce((s: number, d: any) => s + (d.total_defaults || 0), 0));
        }
      }
    })();

    // Fetch pending followup count (overdue + today)
    (async () => {
      const today = new Date().toISOString().slice(0, 10);
      let q = supabase.from("lead_followups").select("id", { count: "exact", head: true })
        .eq("status", "pending").lte("scheduled_at", `${today}T23:59:59`);
      if (role === "counsellor" && profile?.id) {
        const { data: myLeads } = await supabase.from("leads").select("id").eq("counsellor_id", profile.id);
        if (myLeads?.length) q = q.in("lead_id", myLeads.map((l: any) => l.id));
        else { setPendingFollowupCount(0); return; }
      }
      const { count } = await q;
      setPendingFollowupCount(count || 0);
    })();

    const waChannel = supabase
      .channel("wa-unread-sidebar")
      .on("postgres_changes" as any, {
        event: "*",
        schema: "public",
        table: "whatsapp_messages",
      }, () => {
        supabase
          .from("whatsapp_conversations" as any)
          .select("unread_count")
          .gt("unread_count", 0)
          .then(({ data }) => {
            if (data) {
              setWaUnread((data as any[]).reduce((sum: number, c: any) => sum + (c.unread_count || 0), 0));
            }
          });
      })
      .subscribe();

    const leadsChannel = supabase
      .channel("leads-count-sidebar")
      .on("postgres_changes" as any, {
        event: "*",
        schema: "public",
        table: "leads",
      }, () => { fetchNewLeadCount(); })
      .subscribe();

    const approvalsChannel = supabase
      .channel("approvals-count-sidebar")
      .on("postgres_changes" as any, {
        event: "*",
        schema: "public",
        table: "concessions",
      }, () => { fetchPendingApprovals(); })
      .on("postgres_changes" as any, {
        event: "*",
        schema: "public",
        table: "offer_letters",
      }, () => { fetchPendingApprovals(); })
      .subscribe();

    return () => {
      supabase.removeChannel(waChannel);
      supabase.removeChannel(leadsChannel);
      supabase.removeChannel(approvalsChannel);
    };
  }, [role]);

  const visibleMain = mainMenu.filter(canSee).map(item => {
    if (item.url === "/" && pendingApprovals > 0) return { ...item, badge: pendingApprovals };
    return item;
  });
  const visibleAdmission = admissionSubMenu.filter(canSee).map(item => {
    if (item.url === "/whatsapp-inbox" && waUnread > 0) return { ...item, badge: waUnread };
    if (item.url === "/admissions" && newLeadCount > 0) return { ...item, badge: newLeadCount };
    if (item.url === "/counsellor-dashboard" && tatDefaults > 0) return { ...item, badge: tatDefaults };
    if (item.url === "/pending-followups" && pendingFollowupCount > 0) return { ...item, badge: pendingFollowupCount };
    return item;
  }
  );
  const visibleIB = ibAcademicsSubMenu.filter(canSee);
  const visibleHr = hrSubMenu.filter(canSee);
  const visibleMgmt = managementMenu.filter(canSee);
  const isAdmissionActive = admissionSubMenu.some(item => isActive(item.url));
  const isIBActive = ibAcademicsSubMenu.some(item => isActive(item.url) || location.pathname.startsWith("/ib/"));
  const isHrActive = hrSubMenu.some(item => isActive(item.url) || location.pathname.startsWith("/hr"));

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
                        {visibleAdmission.map((item) => {
                          const isCloudDialer = item.url === "/cloud-dialer";
                          const itemActiveClass = isCloudDialer
                            ? "!bg-cyan-100 dark:!bg-cyan-900/30 !text-cyan-700 dark:!text-cyan-300 font-semibold"
                            : activeClass;
                          const itemBaseClass = isCloudDialer
                            ? `${subLinkClass} text-cyan-700 dark:text-cyan-400`
                            : subLinkClass;
                          return (
                          <SidebarMenuSubItem key={item.title}>
                            <SidebarMenuSubButton asChild isActive={isActive(item.url)}>
                              <NavLink to={item.url} className={itemBaseClass} activeClassName={itemActiveClass}>
                                <item.icon className="h-3.5 w-3.5" />
                                <span className="flex-1">{item.title}</span>
                                {item.badge ? (
                                  <span className={`flex h-[18px] min-w-[18px] items-center justify-center rounded-full text-[9px] font-bold text-white px-1 ${
                                    item.url === "/whatsapp-inbox" ? "bg-green-500" : "bg-primary"
                                  }`}>
                                    {item.badge > 99 ? "99+" : item.badge}
                                  </span>
                                ) : null}
                              </NavLink>
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                          );
                        })}
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

              {/* HR */}
              {visibleHr.length > 0 && (
                <Collapsible defaultOpen={isHrActive} className="group/collapsible">
                  <SidebarMenuItem>
                    <CollapsibleTrigger asChild>
                      <SidebarMenuButton className={`${linkClass} justify-between`} isActive={isHrActive}>
                        <span className="flex items-center gap-3">
                          <Briefcase className="h-[17px] w-[17px]" />
                          {!collapsed && <span>HR</span>}
                        </span>
                        {!collapsed && (
                          <ChevronDown className="h-3.5 w-3.5 transition-transform group-data-[state=open]/collapsible:rotate-180" />
                        )}
                      </SidebarMenuButton>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <SidebarMenuSub>
                        {visibleHr.map((item) => (
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

          {/* Profile moved to header — only show initials when collapsed */}
          {collapsed && (
            <div className="flex justify-center py-3 border-t border-sidebar-border">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground" title={displayName}>
                {initials}
              </div>
            </div>
          )}
        </div>
      </SidebarContent>
    </Sidebar>
  );
}
