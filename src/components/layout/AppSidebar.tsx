import { useState, useEffect, useCallback } from "react";
import uniosLogo from "@/assets/unios-logo.png";
import {
  LayoutDashboard, Users, GraduationCap, IndianRupee,
  ClipboardCheck, Settings, LogOut,
  BookOpen, BarChart3, FileText, Search, Shuffle, Handshake, PieChart,
  ChevronDown, Phone, Calendar, MessageSquare, Newspaper, Building2, School, ShieldCheck, Zap, Inbox,
  Globe, FolderOpen, Heart, Award, Target, GitMerge, Bot, Gift, AlertTriangle, Sparkles, Receipt,
  Briefcase, CalendarOff, UserCheck, Fingerprint, PhoneCall, PhoneMissed, Send, UserPlus, Footprints,
  FolderLock, Flame, Video, ListPlus,
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
  | "data_entry" | "office_admin" | "office_assistant" | "hostel_warden" | "consultant" | "academic_partner" | "student" | "parent"
  | "ib_coordinator" | "video_editor";

type MenuItem = { title: string; url: string; icon: any; permission?: string; anyPermission?: string[]; badge?: number; hideForSuperAdmin?: boolean };

const mainMenu: MenuItem[] = [
  { title: "Overview", url: "/", icon: LayoutDashboard, permission: "dashboard:view" },
  { title: "Inbox", url: "/inbox", icon: Inbox, permission: "leads:view" },
  { title: "Search", url: "/search", icon: Search, permission: "search:view" },
  { title: "Students", url: "/students", icon: Users, permission: "students:view" },
  { title: "Attendance", url: "/attendance", icon: ClipboardCheck, permission: "attendance:view" },
  { title: "Exams", url: "/exams", icon: BookOpen, permission: "exams:view" },
  { title: "Finance", url: "/finance", icon: IndianRupee, permission: "finance:view" },
  { title: "Collections", url: "/collections", icon: Receipt, permission: "finance:view" },
  { title: "Refer & Earn", url: "/referrals", icon: Gift, permission: "referrals:view" },
  { title: "Reports", url: "/reports", icon: BarChart3, permission: "reports:view" },
  { title: "My Videos", url: "/video-editor", icon: Video, permission: "video_editor:view", hideForSuperAdmin: true },
];

const admissionSubMenu: MenuItem[] = [
  { title: "Leads", url: "/admissions", icon: GraduationCap, permission: "leads:view" },
  { title: "Applications", url: "/applications", icon: FileText, permission: "students:view" },
  { title: "Cloud Dialer", url: "/cloud-dialer", icon: PhoneCall, permission: "call_log:view" },
  { title: "CAHET Sprint", url: "/cahet-sprint", icon: Flame, permission: "call_log:view" },
  { title: "Missed Calls", url: "/missed-calls", icon: PhoneMissed, permission: "call_log:view" },
  { title: "WhatsApp", url: "/whatsapp-inbox", icon: MessageSquare, permission: "whatsapp:view" },
  { title: "WA Outbound", url: "/whatsapp-inbox?mode=outbound", icon: Send, permission: "whatsapp:view" },
  { title: "Performance", url: "/counsellor-dashboard", icon: BarChart3, permission: "performance:view" },
  { title: "Lead Assignments", url: "/lead-assignments", icon: UserCheck, permission: "leads:view" },
  { title: "Lead Buckets", url: "/lead-buckets", icon: Inbox, permission: "lead_buckets:view" },
  { title: "Lists & Campaigns", url: "/lists", icon: ListPlus, permission: "leads:view" },
  { title: "Lead Allocation", url: "/lead-allocation", icon: Shuffle, permission: "lead_allocation:view" },
  { title: "Fresh Leads", url: "/fresh-leads", icon: Sparkles, permission: "call_log:view" },
  { title: "Pending Follow-ups", url: "/pending-followups", icon: AlertTriangle, permission: "call_log:view" },
  { title: "Visit Monitor", url: "/visit-monitor", icon: Footprints, permission: "leads:view" },
  { title: "Call Log", url: "/call-log", icon: Phone, permission: "call_log:view" },
  { title: "AI Call Log", url: "/ai-call-log", icon: Bot, permission: "automation:view" },
  { title: "Automation", url: "/automation-rules", icon: Zap, permission: "automation:view" },
  { title: "Consultants", url: "/consultants", icon: Handshake, permission: "consultants:view" },
  { title: "Academic Partners", url: "/academic-partners", icon: School, permission: "academic_partners:view" },
  { title: "Templates", url: "/template-manager", icon: Newspaper, permission: "templates:view" },
  { title: "Courses & Fees", url: "/fee-structures", icon: IndianRupee, permission: "courses_fees:view" },
  { title: "My Leads", url: "/consultant-portal", icon: Users, permission: "consultant_portal:view", hideForSuperAdmin: true },
  { title: "My Batches", url: "/academic-partner-portal", icon: School, permission: "academic_partner_portal:view", hideForSuperAdmin: true },
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
  { title: "Job Applicants", url: "/hr-job-applicants", icon: UserPlus, permission: "hr:view" },
  { title: "WhatsApp Inbox", url: "/whatsapp-inbox?scope=hr", icon: MessageSquare, permission: "hr:view" },
  { title: "Attendance", url: "/hr-attendance", icon: Fingerprint, permission: "hr:view" },
  { title: "Leave Mgmt", url: "/hr-leave", icon: CalendarOff, permission: "hr:view" },
  { title: "Directory", url: "/hr-directory", icon: Users, permission: "hr:view" },
];

const managementMenu: MenuItem[] = [
  // Single consolidated entry for the /admin page. AdminPanel renders its own
  // tab strip (Campuses & Courses, User Management, Permissions, …) so we
  // don't need separate sidebar links for each tab. Visible to anyone with
  // permission to access at least one of the tabs.
  {
    title: "Admin Panel",
    url: "/admin",
    icon: ShieldCheck,
    anyPermission: ["campuses_courses:view", "user_management:view", "permissions:view"],
  },
  { title: "WhatsApp Health", url: "/whatsapp-health", icon: AlertTriangle, permission: "user_management:view" },
  { title: "Documents", url: "/documents", icon: FileText, permission: "documents:view" },
  { title: "Alumni Verification", url: "/alumni-verifications", icon: ShieldCheck, permission: "alumni_verification:view" },
  { title: "Video Approvals", url: "/video-approvals", icon: Video, permission: "video_approval:view" },
  { title: "Video Bills", url: "/video-bills", icon: Receipt, permission: "video_bills:view" },
];

const roleLabels: Record<string, string> = {
  super_admin: "Super Admin", campus_admin: "Campus Admin", principal: "Principal",
  faculty: "Faculty", teacher: "Teacher", student: "Student", parent: "Parent",
  counsellor: "Counsellor", accountant: "Accountant", admission_head: "Admission Head",
  data_entry: "Data Entry", office_admin: "Office Administrator", office_assistant: "Office Assistant", hostel_warden: "Hostel Warden",
  consultant: "Consultant",
  academic_partner: "Academic Partner",
  ib_coordinator: "IB Coordinator",
  video_editor: "Video Editor",
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
    // When impersonating, always show User Management so admin can navigate back
    if (isImpersonating && realRole === "super_admin" && item.url === "/admin") return true;
    // Role-specific portals: hide from super_admin when not impersonating
    if (item.hideForSuperAdmin && realRole === "super_admin" && !isImpersonating) return false;
    // anyPermission: show if the user has at least one of the listed perms.
    // Used by consolidated entries like "Admin Panel" that fold multiple
    // tabs (course-campus / user-management / permissions) into a single
    // sidebar link, where accountants might have only user_management
    // and counsellors might have only campuses_courses.
    if (item.anyPermission && item.anyPermission.length > 0) {
      return item.anyPermission.some(p => {
        const [mod, act] = p.split(":");
        return can(mod, act);
      });
    }
    if (!item.permission) return true;
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
  // Missed callbacks count (ai_call_records needing followup)
  const [missedCallbackCount, setMissedCallbackCount] = useState(0);
  // Priority interested leads (high-conversion AI calls — top of dialer queue)
  const [priorityInterestedCount, setPriorityInterestedCount] = useState(0);
  // Personal Document Tracker — visible to all super_admins
  const hasPersonalDocs = role === "super_admin";

  const fetchAdmissionBadges = useCallback(async () => {
    if (role === "counsellor" && !profile?.id) return;

    const { data, error } = await (supabase as any).rpc("action_badge_counts", {
      p_scope_counsellor_id: role === "counsellor" ? profile?.id : null,
      p_include_unassigned: true,
    });

    if (error) {
      console.error("[AppSidebar] admission badge fetch failed:", error);
      return;
    }

    setWaUnread(Number(data?.wa_unread || 0));
    setNewLeadCount(Number(data?.new_leads_total || 0));
    setTatDefaults(Number(data?.tat_defaults || 0));
    setPendingFollowupCount(Number(data?.overdue || 0) + Number(data?.today || 0));
    setMissedCallbackCount(Number(data?.ai_needs_followup || 0));
    setPriorityInterestedCount(Number(data?.priority_interested_total || 0));
  }, [role, profile?.id]);

  const fetchPendingApprovals = useCallback(async () => {
    // Only approvers need this count
    if (!["super_admin", "principal", "campus_admin", "admission_head"].includes(role || "")) {
      setPendingApprovals(0);
      return;
    }
    const { data } = await supabase.rpc("count_pending_approvals" as any);
    setPendingApprovals(Number(data) || 0);
  }, [role]);

  useEffect(() => {
    fetchAdmissionBadges();
    fetchPendingApprovals();

    let badgeDebounce: ReturnType<typeof setTimeout> | null = null;
    const scheduleBadgeRefresh = () => {
      if (badgeDebounce) clearTimeout(badgeDebounce);
      badgeDebounce = setTimeout(fetchAdmissionBadges, 1500);
    };

    const badgeChannel = supabase
      .channel("admission-badges-sidebar")
      .on("postgres_changes" as any, { event: "*", schema: "public", table: "whatsapp_messages" }, scheduleBadgeRefresh)
      .on("postgres_changes" as any, { event: "*", schema: "public", table: "leads" }, scheduleBadgeRefresh)
      .on("postgres_changes" as any, { event: "*", schema: "public", table: "lead_followups" }, scheduleBadgeRefresh)
      .on("postgres_changes" as any, { event: "*", schema: "public", table: "ai_call_records" }, scheduleBadgeRefresh)
      .subscribe();

    const approvalsChannel = supabase
      .channel("approvals-count-sidebar")
      .on("postgres_changes" as any, { event: "*", schema: "public", table: "concessions" }, fetchPendingApprovals)
      .on("postgres_changes" as any, { event: "*", schema: "public", table: "offer_letters" }, fetchPendingApprovals)
      .subscribe();

    return () => {
      if (badgeDebounce) clearTimeout(badgeDebounce);
      supabase.removeChannel(badgeChannel);
      supabase.removeChannel(approvalsChannel);
    };
  }, [fetchAdmissionBadges, fetchPendingApprovals]);

  const inboxBadge = pendingApprovals + pendingFollowupCount + waUnread;
  const visibleMain = mainMenu.filter(canSee).map(item => {
    if (item.url === "/" && pendingApprovals > 0) return { ...item, badge: pendingApprovals };
    if (item.url === "/inbox" && inboxBadge > 0) return { ...item, badge: inboxBadge };
    return item;
  });
  const visibleAdmission = admissionSubMenu.filter(canSee).map(item => {
    if (item.url === "/whatsapp-inbox" && waUnread > 0) return { ...item, badge: waUnread };
    if (item.url === "/admissions" && newLeadCount > 0) return { ...item, badge: newLeadCount };
    if (item.url === "/counsellor-dashboard" && tatDefaults > 0) return { ...item, badge: tatDefaults };
    if (item.url === "/pending-followups" && pendingFollowupCount > 0) return { ...item, badge: pendingFollowupCount };
    if (item.url === "/missed-calls" && missedCallbackCount > 0) return { ...item, badge: missedCallbackCount };
    if (item.url === "/cloud-dialer" && priorityInterestedCount > 0) return { ...item, badge: priorityInterestedCount };
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

  // Reference-inspired sidebar items: soft hover background, active item
  // becomes a white pill with a subtle shadow that pops against the tinted
  // sidebar canvas. No DOM/structure change — just className tuning.
  const linkClass = "gap-3 rounded-xl px-3 py-2 text-[13px] font-medium text-sidebar-foreground/70 transition-all hover:bg-sidebar-accent hover:text-sidebar-accent-foreground";
  const activeClass = "!bg-card !text-foreground font-semibold ring-1 ring-sidebar-border shadow-[0_1px_2px_hsl(220_13%_46%/0.08)]";
  const subLinkClass = "gap-2.5 rounded-xl px-3 py-1.5 text-[12.5px] font-medium text-sidebar-foreground/70 transition-all hover:bg-sidebar-accent hover:text-sidebar-accent-foreground";

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
                          // CAHET Sprint gets a rose/urgent treatment to
                          // signal the deadline pressure — matches the
                          // ticker, leaderboard, and register-button colour.
                          const isCahetSprint = item.url === "/cahet-sprint";
                          const itemActiveClass = isCahetSprint
                            ? "!bg-rose-100 dark:!bg-rose-900/30 !text-rose-700 dark:!text-rose-300 font-semibold"
                            : isCloudDialer
                            ? "!bg-cyan-100 dark:!bg-cyan-900/30 !text-cyan-700 dark:!text-cyan-300 font-semibold"
                            : activeClass;
                          const itemBaseClass = isCahetSprint
                            ? `${subLinkClass} text-rose-700 dark:text-rose-400 font-semibold`
                            : isCloudDialer
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
                                    item.url === "/whatsapp-inbox" ? "bg-green-500"
                                    : item.url === "/missed-calls" ? "bg-red-500"
                                    : "bg-primary"
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

        {hasPersonalDocs && (
          <SidebarGroup>
            <SidebarGroupLabel className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/50 px-4 mb-0.5">
              Personal
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={isActive("/my-docs")}>
                    <NavLink to="/my-docs" className={linkClass} activeClassName={activeClass}>
                      <FolderLock className="h-[17px] w-[17px]" />
                      {!collapsed && <span>My Documents</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

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
          {can("user_management", "view") && (
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
          )}

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
