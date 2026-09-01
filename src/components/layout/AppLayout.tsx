import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { PageLoader } from "@/components/ui/page-loader";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { ImpersonationBanner } from "@/components/layout/ImpersonationBanner";
import { GlobalActionBar } from "@/components/layout/GlobalActionBar";
import { LiveCallBar } from "@/components/layout/LiveCallBar";
import { CahetSprintTicker } from "@/components/layout/CahetSprintTicker";
import { UpdeledSprintTicker } from "@/components/layout/UpdeledSprintTicker";
import { ApplicantDeadlineTicker } from "@/components/layout/ApplicantDeadlineTicker";
import { NotificationPanel } from "@/components/layout/NotificationPanel";
import { WhatsAppPanel } from "@/components/layout/WhatsAppPanel";
import { HeaderSearch } from "@/components/layout/HeaderSearch";
import { HeaderProfile } from "@/components/layout/HeaderProfile";
import { HeaderFeedbackWidget } from "@/components/layout/HeaderFeedbackWidget";
import { useLocation } from "react-router-dom";
import { Suspense } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { isPortalRole } from "@/lib/accessPolicy";
import { CounsellorFilterProvider } from "@/contexts/CounsellorFilterContext";
import { usePresenceHeartbeat } from "@/hooks/usePresenceHeartbeat";
import { useEffect, useState, lazy } from "react";
import { Footprints } from "lucide-react";
import { Button } from "@/components/ui/button";
import { WalkInDialog } from "@/components/visits/WalkInDialog";
import { supabase } from "@/integrations/supabase/client";

const pageTitles: Record<string, string> = {
  "/": "Dashboard",
  "/admissions": "Admissions",
  "/students": "Students",
  "/attendance": "Attendance",
  "/finance": "Finance",
  "/collections": "Fee Collections",
  "/hr": "HR Dashboard",
  "/hr-attendance": "Employee Attendance",
  "/hr-leave": "Leave Management",
  "/hr-directory": "Employee Directory",
  "/hr-payroll": "Payroll",
  "/cloud-dialer": "Cloud Dialer",
  "/cahet-sprint": "CAHET Sprint",
  "/updeled-sprint": "UPDELED Sprint",
  "/whatsapp-inbox": "WhatsApp Inbox",
  "/pending-followups": "Pending Follow-ups",
  "/fresh-leads": "Fresh Leads",
  "/missed-calls": "Missed Calls",
  "/lead-buckets": "Lead Buckets",
  "/exams": "Exams",
  "/campuses": "Campuses",
  "/courses": "Courses",
  "/reports": "Reports",
  "/documents": "Documents",
  "/settings": "Settings",
  "/admin": "User Management",
  "/ib/poi": "Programme of Inquiry",
  "/ib/units": "Unit Planner",
  "/ib/gradebook": "Gradebook",
  "/ib/portfolios": "Portfolios",
  "/ib/action": "Action & Service",
  "/ib/reports": "Report Cards",
  "/ib/reports/templates": "Report Templates",
  "/ib/exhibition": "Exhibition",
  "/ib/projects": "MYP Projects",
  "/ib/idu": "Interdisciplinary Units",
};

const GREETINGS: Record<string, string[]> = {
  lateNight: [
    "Up late, {{name}}?",
    "Burning the midnight oil, {{name}}?",
    "The night shift, {{name}}?",
    "Can't sleep, {{name}}?",
    "Night owl mode, {{name}}",
    "Still going, {{name}}?",
    "{{name}}, the world is quiet — perfect time to work",
    "Late nights build empires, {{name}}",
    "Everyone's asleep but {{name}}",
    "{{name}}, coffee or willpower?",
  ],
  morning: [
    "Rise and shine, {{name}}",
    "Good morning, {{name}}",
    "Morning, {{name}} — let's get after it",
    "Fresh day, {{name}}",
    "Top of the morning, {{name}}",
    "Ready to roll, {{name}}?",
    "New day, new wins, {{name}}",
    "{{name}}, the early bird gets the lead",
    "Morning, {{name}} — what's the plan?",
    "{{name}}, today's going to be a good one",
  ],
  afternoon: [
    "Good afternoon, {{name}}",
    "Afternoon, {{name}} — keep the momentum",
    "Halfway there, {{name}}",
    "Hope lunch was good, {{name}}",
    "Afternoon push, {{name}}",
    "{{name}}, powering through the afternoon",
    "Still crushing it, {{name}}",
    "Afternoon, {{name}} — how's the day going?",
    "{{name}}, the finish line is in sight",
    "Keep it rolling, {{name}}",
  ],
  evening: [
    "Good evening, {{name}}",
    "Still at it, {{name}}?",
    "Evening, {{name}} — wrapping up?",
    "Burning the evening oil, {{name}}",
    "{{name}}, almost time to call it a day",
    "Evening hustle, {{name}}",
    "Winding down, {{name}}?",
    "{{name}}, one last push?",
    "Evening, {{name}} — solid day?",
    "{{name}}, the sunset shift",
  ],
};

// ponytail: IST-pinned hour so greeting doesn't drift across timezones; day-seeded pick so it's stable per day
function getGreeting(displayName: string | null | undefined): string {
  const now = new Date();
  const h = parseInt(
    new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: "Asia/Kolkata" }).format(now),
    10,
  );
  const pool = h < 5 ? GREETINGS.lateNight
    : h < 12 ? GREETINGS.morning
    : h < 17 ? GREETINGS.afternoon
    : h < 21 ? GREETINGS.evening
    : GREETINGS.lateNight;
  const dayIndex = (now.getFullYear() * 1000 + now.getMonth() * 32 + now.getDate()) % pool.length;
  const firstName = (displayName || "").split(" ")[0] || "there";
  return pool[dayIndex].replace(/\{\{name\}\}/g, firstName);
}

export function AppLayout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const title = pageTitles[location.pathname] || "NIMT UniOs";
  const { profile, role } = useAuth();
  const [deferredShellReady, setDeferredShellReady] = useState(false);
  const [showWalkIn, setShowWalkIn] = useState(false);
  const showWalkInBtn = role === "counsellor" || role === "admission_head" || role === "super_admin" || role === "campus_admin" || role === "principal";
  // Console routes own their own scrolling and want the full viewport: the
  // shell stops growing and <main> stops padding, so a three-column layout can
  // just use h-full instead of guessing the chrome height with calc(100vh-Npx).
  const isConsole = location.pathname === "/cloud-dialer";
  // Partner portals (admission/academic) live inside this same staff shell, so
  // the counsellor/staff status chrome — WhatsApp reply pills, sprint tickers,
  // action bar, live-call bar — would otherwise leak into their view. Gate the
  // whole cluster in one place; each pill's own poll never mounts for portals.
  const isPortal = isPortalRole(role);
  usePresenceHeartbeat();

  useEffect(() => {
    setDeferredShellReady(false);
    const timeoutId = window.setTimeout(() => setDeferredShellReady(true), 600);
    return () => window.clearTimeout(timeoutId);
  }, [location.pathname]);

  return (
    <CounsellorFilterProvider>
    <div className={`flex flex-col ${isConsole ? "h-screen overflow-hidden" : "min-h-screen"}`}>
      <ImpersonationBanner />
      <SidebarProvider>
        <div className="flex-1 flex w-full min-h-0">
          <AppSidebar />
          <div className="flex-1 flex flex-col min-w-0 min-h-0">
            <header className="sticky top-0 z-30 flex min-h-12 items-center justify-between gap-2 border-b border-border/60 bg-card/80 backdrop-blur-xl px-3 py-2 sm:px-5">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <SidebarTrigger className="text-muted-foreground hover:text-foreground transition-colors" />
                <div className="flex min-w-0 items-center gap-1.5 text-sm">
                  <span className="truncate font-semibold text-foreground">
                    {getGreeting(profile?.display_name)}
                  </span>
                  <span className="flex-shrink-0 text-muted-foreground/50">›</span>
                  <span className="truncate font-medium text-muted-foreground">{title}</span>
                </div>
              </div>
              <div className="flex flex-shrink-0 items-center gap-1 sm:gap-1.5">
                {showWalkInBtn && (
                  <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={() => setShowWalkIn(true)}>
                    <Footprints className="h-3.5 w-3.5" /> Record Walk-in
                  </Button>
                )}
                {!isPortal && <HeaderSearch />}
                {deferredShellReady && <HeaderFeedbackWidget />}
                {deferredShellReady && !isPortal && <WhatsAppPanel />}
                {deferredShellReady && <NotificationPanel />}
                <div className="w-px h-6 bg-border/60 mx-0.5" />
                <HeaderProfile />
              </div>
            </header>
            {deferredShellReady && !isPortal && <CahetSprintTicker />}
            {deferredShellReady && !isPortal && <UpdeledSprintTicker />}
            {deferredShellReady && !isPortal && <ApplicantDeadlineTicker />}
            {/* Counsellors get the action bar as cross-page navigation everywhere
                except the Cloud Dialer console, where these same numbers already
                render as bucket chips (and vertical space on the full-viewport
                console is tight). Every other staff role keeps it on all pages;
                partner portals never get it. */}
            {deferredShellReady && !isPortal && !(role === "counsellor" && isConsole) && <GlobalActionBar />}
            {deferredShellReady && !isPortal && <LiveCallBar />}
            <main className={`flex-1 min-h-0 ${isConsole ? "overflow-hidden p-0" : "overflow-auto p-6"}`}>
              {/* Same surface the RequirePermission gate and the page's own
                  loading branch render, so the three handoffs read as one. */}
              <Suspense fallback={<PageLoader className={isConsole ? "p-6" : undefined} />}>
                {children}
              </Suspense>
            </main>
          </div>
        </div>
      </SidebarProvider>
    </div>
    {showWalkIn && (
      <Suspense fallback={null}>
        <NavbarWalkInDialog open={showWalkIn} onOpenChange={setShowWalkIn} />
      </Suspense>
    )}
    </CounsellorFilterProvider>
  );
}

function NavbarWalkInDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [courses, setCourses] = useState<{ id: string; name: string }[]>([]);
  const [campuses, setCampuses] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    if (!open) return;
    Promise.all([
      supabase.from("courses").select("id, name").order("name"),
      supabase.from("campuses").select("id, name").order("name"),
    ]).then(([c, camp]) => {
      if (c.data) setCourses(c.data);
      if (camp.data) setCampuses(camp.data);
    });
  }, [open]);
  return <WalkInDialog open={open} onOpenChange={onOpenChange} courses={courses} campuses={campuses} />;
}
