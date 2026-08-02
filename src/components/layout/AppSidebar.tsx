import { useState, useEffect, useCallback } from "react";
import uniosLogo from "@/assets/unios-logo.png";

const WhatsAppIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
  </svg>
);

import {
  LayoutDashboard, Users, GraduationCap, IndianRupee,
  ClipboardCheck, Settings, LogOut, CreditCard,
  BookOpen, BarChart3, FileText, Search, Shuffle, Handshake, PieChart,
  ChevronDown, Phone, Calendar, MessageSquare, Newspaper, Building2, School, ShieldCheck, Zap, Inbox,
  Globe, FolderOpen, Heart, Award, Target, GitMerge, Bot, Gift, AlertTriangle, Sparkles, Receipt, FileMinus2,
  Briefcase, CalendarOff, UserCheck, Fingerprint, PhoneCall, PhoneMissed, Send, UserPlus, Footprints,
  FolderLock, Flame, Video, ListPlus,
  Megaphone,
  Library, Barcode, DoorOpen,
} from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { usePermissions } from "@/contexts/PermissionContext";
import { supabase } from "@/integrations/supabase/client";
import { fetchActionBadgeCounts } from "@/lib/actionBadgeCounts";
import { canSeePolicyItem, isAcademicPartnerPortalRole, type AccessState } from "@/lib/accessPolicy";
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
  | "data_entry" | "office_admin" | "office_assistant" | "school_coordinator" | "hostel_warden" | "consultant" | "academic_partner" | "academic_partner_offer_letter" | "student" | "parent"
  | "ib_coordinator" | "video_editor" | "librarian";

type MenuItem = {
  title: string;
  url: string;
  icon: any;
  permission?: string;
  anyPermission?: string[];
  roles?: AppRole[];
  blockedRoles?: AppRole[];
  badge?: number;
  hideForSuperAdmin?: boolean;
};

const mainMenu: MenuItem[] = [
  { title: "Overview", url: "/", icon: LayoutDashboard, permission: "dashboard:view" },
  { title: "Inbox", url: "/inbox", icon: Inbox, permission: "leads:view" },
  { title: "Search", url: "/search", icon: Search, permission: "search:view" },
  { title: "Students", url: "/students", icon: Users, permission: "students:view" },
  { title: "Attendance", url: "/attendance", icon: ClipboardCheck, permission: "attendance:view" },
  { title: "Exams", url: "/exams", icon: BookOpen, permission: "exams:view" },
  { title: "Finance", url: "/finance", icon: IndianRupee, permission: "finance:view" },
  { title: "Refer & Earn", url: "/referrals", icon: Gift, permission: "referrals:view" },
  { title: "Reports", url: "/reports", icon: BarChart3, permission: "reports:view" },
  { title: "My Videos", url: "/video-editor", icon: Video, permission: "video_editor:view", hideForSuperAdmin: true },
];

const academicPartnerMenu: MenuItem[] = [
  { title: "Overview", url: "/academic-partner-portal", icon: LayoutDashboard, roles: ["academic_partner", "academic_partner_offer_letter"] },
  { title: "Inbox", url: "/academic-partner-portal?tab=requests", icon: Inbox, roles: ["academic_partner", "academic_partner_offer_letter"] },
  { title: "Leads", url: "/academic-partner-portal?tab=leads", icon: GraduationCap, roles: ["academic_partner", "academic_partner_offer_letter"] },
  { title: "Applications", url: "/academic-partner-portal?tab=applications", icon: FileText, roles: ["academic_partner", "academic_partner_offer_letter"] },
  { title: "Students", url: "/academic-partner-portal?tab=students", icon: Users, roles: ["academic_partner", "academic_partner_offer_letter"] },
  { title: "Attendance", url: "/academic-partner-portal?tab=attendance", icon: ClipboardCheck, roles: ["academic_partner", "academic_partner_offer_letter"] },
  { title: "Finance", url: "/academic-partner-portal?tab=fees", icon: IndianRupee, roles: ["academic_partner", "academic_partner_offer_letter"] },
  { title: "Collections", url: "/academic-partner-portal?tab=fees", icon: Receipt, roles: ["academic_partner", "academic_partner_offer_letter"] },
];

const admissionSubMenu: MenuItem[] = [
  { title: "Leads", url: "/admissions", icon: GraduationCap, permission: "leads:view" },
  { title: "Applications", url: "/applications", icon: FileText, permission: "students:view" },
  { title: "Cloud Dialer", url: "/cloud-dialer", icon: PhoneCall, permission: "call_log:view" },
  { title: "CAHET Sprint", url: "/cahet-sprint", icon: Flame, permission: "call_log:view" },
  { title: "UPDELED Sprint", url: "/updeled-sprint", icon: GraduationCap, permission: "call_log:view" },
  { title: "Missed Calls", url: "/missed-calls", icon: PhoneMissed, permission: "call_log:view" },
  { title: "WhatsApp", url: "/whatsapp-inbox", icon: WhatsAppIcon, permission: "whatsapp:view" },
  { title: "Performance", url: "/counsellor-dashboard", icon: BarChart3, permission: "performance:view" },
  { title: "Incentives", url: "/incentive-approvals", icon: IndianRupee, roles: ["super_admin", "accountant"] },
  { title: "Lead Assignments", url: "/lead-assignments", icon: UserCheck, permission: "leads:view" },
  { title: "Lead Buckets", url: "/lead-buckets", icon: Inbox, permission: "lead_buckets:view" },
  { title: "Lead Allocation", url: "/lead-allocation", icon: Shuffle, permission: "lead_allocation:view" },
  { title: "Fresh Leads", url: "/fresh-leads", icon: Sparkles, permission: "call_log:view" },
  { title: "Pending Follow-ups", url: "/pending-followups", icon: AlertTriangle, permission: "call_log:view" },
  { title: "Visit Center", url: "/visit-center", icon: DoorOpen, permission: "leads:view" },
  { title: "Visit Monitor", url: "/visit-monitor", icon: Footprints, roles: ["super_admin", "principal", "admission_head"] },
  { title: "Call Log", url: "/call-log", icon: Phone, permission: "call_log:view" },
  { title: "AI Call Log", url: "/ai-call-log", icon: Bot, permission: "automation:view" },
  { title: "Automation", url: "/automation-rules", icon: Zap, permission: "automation:view" },
  { title: "Consultants", url: "/consultants", icon: Handshake, permission: "consultants:view" },
  { title: "Credit Notes", url: "/consultant-credit-notes", icon: FileMinus2, roles: ["super_admin"] },
  { title: "Academic Partners", url: "/academic-partners", icon: School, permission: "academic_partners:view" },
  { title: "Courses & Fees", url: "/fee-structures", icon: IndianRupee, permission: "courses_fees:view" },
  { title: "My Leads", url: "/consultant-portal", icon: Users, permission: "consultant_portal:view", hideForSuperAdmin: true },
  { title: "My Batches", url: "/academic-partner-portal", icon: School, permission: "academic_partner_portal:view", hideForSuperAdmin: true },
  { title: "Publisher Leads", url: "/publisher-portal", icon: Users, permission: "publisher_portal:view", hideForSuperAdmin: true },
  { title: "Publisher Portal", url: "/publisher-portal", icon: Users, permission: "user_management:view" },
  { title: "Publisher Analytics", url: "/publisher-analytics", icon: PieChart, permission: "user_management:view" },
  { title: "Analytics", url: "/admission-analytics", icon: PieChart, permission: "analytics:view" },
];

const marketingSubMenu: MenuItem[] = [
  { title: "Marketing Hub", url: "/marketing", icon: Megaphone, permission: "leads:view", blockedRoles: ["academic_partner", "academic_partner_offer_letter"] },
  { title: "Lists", url: "/lists", icon: ListPlus, permission: "leads:view", blockedRoles: ["academic_partner", "academic_partner_offer_letter"] },
  { title: "Templates", url: "/template-manager", icon: Newspaper, permission: "templates:view", blockedRoles: ["academic_partner", "academic_partner_offer_letter"] },
  { title: "WA Outbound", url: "/whatsapp-inbox?mode=outbound", icon: Send, permission: "whatsapp:view", blockedRoles: ["academic_partner", "academic_partner_offer_letter"] },
];

const academicsSubMenu: MenuItem[] = [
  { title: "Library Dashboard", url: "/library?tab=dashboard", icon: Library, permission: "library:view" },
  { title: "Catalog", url: "/library?tab=catalog", icon: BookOpen, permission: "library:view" },
  { title: "Issue / Return", url: "/library?tab=circulation", icon: Shuffle, permission: "library:circulate" },
  { title: "Inventory", url: "/library?tab=inventory", icon: ClipboardCheck, permission: "library:inventory" },
  { title: "Digitization Queue", url: "/library?tab=digitization", icon: Barcode, permission: "library:digitize" },
  { title: "Members", url: "/library?tab=members", icon: Users, permission: "library:view" },
  { title: "Reports", url: "/library?tab=reports", icon: BarChart3, permission: "library:export" },
  { title: "Settings", url: "/library?tab=settings", icon: Settings, permission: "library:manage_settings" },
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
  { title: "WhatsApp Inbox", url: "/whatsapp-inbox?scope=hr", icon: WhatsAppIcon, permission: "hr:view" },
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
  {
    title: "ID Card Center",
    url: "/id-card-center",
    icon: CreditCard,
    roles: ["super_admin", "principal", "office_admin", "office_assistant", "school_coordinator", "campus_admin"],
    anyPermission: ["hr:view"],
  },
  { title: "WhatsApp Health", url: "/whatsapp-health", icon: AlertTriangle, permission: "user_management:view" },
  { title: "Documents", url: "/documents", icon: FileText, permission: "documents:view" },
  { title: "Student Services", url: "/alumni-verifications", icon: ShieldCheck, permission: "alumni_verification:view" },
  { title: "Video Approvals", url: "/video-approvals", icon: Video, permission: "video_approval:view" },
  { title: "Video Bills", url: "/video-bills", icon: Receipt, permission: "video_bills:view" },
];

const roleLabels: Record<string, string> = {
  super_admin: "Super Admin", campus_admin: "Campus Admin", principal: "Principal",
  faculty: "Faculty", teacher: "Teacher", student: "Student", parent: "Parent",
  counsellor: "Counsellor", accountant: "Accountant", admission_head: "Admission Head",
  data_entry: "Data Entry", office_admin: "Office Administrator", office_assistant: "Office Assistant", school_coordinator: "School Coordinator", hostel_warden: "Hostel Warden",
  consultant: "Consultant",
  academic_partner: "Academic Partner",
  academic_partner_offer_letter: "Academic Partner + Offers",
  ib_coordinator: "IB Coordinator",
  video_editor: "Video Editor",
  librarian: "Librarian",
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

  const { permissions } = usePermissions();
  const accessState: AccessState = {
    isAuthenticated: !!user,
    role,
    realRole,
    permissions,
    isImpersonating,
  };
  // Pages that are now buckets of the Cloud Dialer queue. Counsellors get one
  // work surface; every other role keeps the standalone pages.
  const DIALER_FOLDED_URLS = ["/fresh-leads", "/missed-calls"];
  const canSee = (item: MenuItem) => {
    if (role === "counsellor" && DIALER_FOLDED_URLS.includes(item.url)) return false;
    return canSeePolicyItem(accessState, item);
  };
  const canViewSettings = canSeePolicyItem(accessState, {
    title: "Settings",
    url: "/settings",
    icon: Settings,
    permission: "user_management:view",
  });

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
    if (isAcademicPartnerPortalRole(role)) return;
    if (role === "counsellor" && !profile?.id) return;

    const { data, error } = await fetchActionBadgeCounts({
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
    if (isAcademicPartnerPortalRole(role)) {
      setWaUnread(0);
      setNewLeadCount(0);
      setTatDefaults(0);
      setPendingFollowupCount(0);
      setMissedCallbackCount(0);
      setPriorityInterestedCount(0);
      setPendingApprovals(0);
      return;
    }

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
  const isPartnerPortalRole = isAcademicPartnerPortalRole(role);
  const visibleMainSource = isPartnerPortalRole ? academicPartnerMenu : mainMenu;
  const visibleMain = visibleMainSource.filter(canSee).map(item => {
    if (item.url === "/" && pendingApprovals > 0) return { ...item, badge: pendingApprovals };
    if (item.url === "/inbox" && inboxBadge > 0) return { ...item, badge: inboxBadge };
    return item;
  });
  const visibleAdmission = (isPartnerPortalRole ? [] : admissionSubMenu.filter(canSee)).map(item => {
    if (item.url === "/whatsapp-inbox" && waUnread > 0) return { ...item, badge: waUnread };
    if (item.url === "/admissions" && newLeadCount > 0) return { ...item, badge: newLeadCount };
    if (item.url === "/counsellor-dashboard" && tatDefaults > 0) return { ...item, badge: tatDefaults };
    if (item.url === "/pending-followups" && pendingFollowupCount > 0) return { ...item, badge: pendingFollowupCount };
    if (item.url === "/missed-calls" && missedCallbackCount > 0) return { ...item, badge: missedCallbackCount };
    if (item.url === "/cloud-dialer" && priorityInterestedCount > 0) return { ...item, badge: priorityInterestedCount };
    return item;
  }
  );
  const visibleMarketing = isPartnerPortalRole ? [] : marketingSubMenu.filter(canSee);
  const visibleAcademics = academicsSubMenu.filter(canSee);
  const visibleIB = ibAcademicsSubMenu.filter(canSee);
  const visibleHr = hrSubMenu.filter(canSee);
  const visibleMgmt = managementMenu.filter(canSee);
  const isAdmissionActive = !isPartnerPortalRole && admissionSubMenu.some(item => isActive(item.url));
  const isMarketingActive = !isPartnerPortalRole && marketingSubMenu.some(item => isActive(item.url));
  const isAcademicsActive = academicsSubMenu.some(item => isActive(item.url) || location.pathname.startsWith("/library"));
  const isIBActive = ibAcademicsSubMenu.some(item => isActive(item.url) || location.pathname.startsWith("/ib/"));
  const isHrActive = hrSubMenu.some(item => isActive(item.url) || location.pathname.startsWith("/hr"));

  // IB Academics only shows when Mirai campus is selected (or "all" for super_admin)
  const isMiraiContext = selectedCampusId === "all" || campuses.find(c => c.id === selectedCampusId)?.name?.toLowerCase().includes("mirai");

  // Reference-inspired sidebar items: soft hover background, active item
  // becomes a white pill with a subtle shadow that pops against the tinted
  // sidebar canvas. No DOM/structure change — just className tuning.
  const linkClass = "gap-3 rounded-xl px-3 py-2 text-[13px] font-medium text-sidebar-foreground/70 transition-all duration-160 ease-standard hover:bg-sidebar-accent hover:text-sidebar-accent-foreground";
  const activeClass = "!bg-card !text-foreground font-semibold ring-1 ring-sidebar-border shadow-[0_1px_2px_hsl(214_32%_12%/0.08)]";
  const subLinkClass = "gap-2.5 rounded-xl px-3 py-1.5 text-[12.5px] font-medium text-sidebar-foreground/70 transition-all duration-160 ease-standard hover:bg-sidebar-accent hover:text-sidebar-accent-foreground";

  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border">
      <SidebarContent className="bg-sidebar pt-4">
        {/* Logo */}
        <div className="px-3 pb-2">
          <div className="flex items-center gap-3 rounded-xl bg-gradient-to-r from-primary/5 to-transparent px-3 py-2.5">
            <img src={uniosLogo} alt="UniOs" className="h-8 w-8 object-contain" />
            {!collapsed && (
              <div className="flex flex-col">
                <span className="text-sm font-bold text-foreground tracking-tight">NIMT UniOs</span>
              </div>
            )}
          </div>
        </div>

        {/* Campus Selector */}
        {!collapsed && !isPartnerPortalRole && campuses.length > 0 && (
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
                        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-destructive-foreground px-1 animate-rs-scale-in">
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
                          // Sprint routes get deadline-pressure treatment that
                          // matches their ticker and register-button colours.
                          const isCahetSprint = item.url === "/cahet-sprint";
                          const isUpdeledSprint = item.url === "/updeled-sprint";
                          const itemActiveClass = isCahetSprint
                            ? "!bg-destructive/10 dark:!bg-destructive/80/30 !text-destructive dark:!text-destructive/50 font-semibold"
                            : isUpdeledSprint
                            ? "!bg-primary/10 dark:!bg-primary/80/30 !text-primary dark:!text-primary/50 font-semibold"
                            : isCloudDialer
                            ? "!bg-cyan-100 dark:!bg-cyan-900/30 !text-cyan-700 dark:!text-cyan-300 font-semibold"
                            : activeClass;
                          const itemBaseClass = isCahetSprint
                            ? `${subLinkClass} text-destructive dark:text-destructive/70 font-semibold`
                            : isUpdeledSprint
                            ? `${subLinkClass} text-primary dark:text-primary/60 font-semibold`
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
                                    item.url === "/whatsapp-inbox" ? "bg-success/50"
                                    : item.url === "/missed-calls" ? "bg-destructive/50"
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

              {/* Marketing */}
              {visibleMarketing.length > 0 && (
                <Collapsible defaultOpen={isMarketingActive} className="group/collapsible">
                  <SidebarMenuItem>
                    <CollapsibleTrigger asChild>
                      <SidebarMenuButton className={`${linkClass} justify-between`} isActive={isMarketingActive}>
                        <span className="flex items-center gap-3">
                          <Megaphone className="h-[17px] w-[17px]" />
                          {!collapsed && <span>Marketing Hub</span>}
                        </span>
                        {!collapsed && (
                          <ChevronDown className="h-3.5 w-3.5 transition-transform group-data-[state=open]/collapsible:rotate-180" />
                        )}
                      </SidebarMenuButton>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <SidebarMenuSub>
                        {visibleMarketing.map((item) => (
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

              {/* Library */}
              {visibleAcademics.length > 0 && (
                <Collapsible defaultOpen={isAcademicsActive} className="group/collapsible">
                  <SidebarMenuItem>
                    <CollapsibleTrigger asChild>
                      <SidebarMenuButton className={`${linkClass} justify-between`} isActive={isAcademicsActive}>
                        <span className="flex items-center gap-3">
                          <Library className="h-[17px] w-[17px]" />
                          {!collapsed && <span>Library</span>}
                        </span>
                        {!collapsed && (
                          <ChevronDown className="h-3.5 w-3.5 transition-transform group-data-[state=open]/collapsible:rotate-180" />
                        )}
                      </SidebarMenuButton>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <SidebarMenuSub>
                        {visibleAcademics.map((item) => (
                          <SidebarMenuSubItem key={item.title}>
                            <SidebarMenuSubButton asChild isActive={isActive(item.url) || (item.url.startsWith("/library") && location.pathname === "/library" && !location.search && item.url.includes("dashboard"))}>
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
              Administrative
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
          {canViewSettings && (
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
