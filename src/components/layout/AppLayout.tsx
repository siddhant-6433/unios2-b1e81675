import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
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
import { CounsellorFilterProvider } from "@/contexts/CounsellorFilterContext";
import { usePresenceHeartbeat } from "@/hooks/usePresenceHeartbeat";
import { useEffect, useState } from "react";

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

// Counsellor-only greeting prefix shown in the header breadcrumb. Resolves
// "morning / afternoon / evening" against IST so it doesn't drift when the
// app is opened from a different timezone (some counsellors travel).
function counsellorGreeting(displayName: string | null | undefined): string {
  const hourIst = parseInt(
    new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: "Asia/Kolkata" }).format(new Date()),
    10,
  );
  const period = hourIst < 12 ? "Morning" : hourIst < 17 ? "Afternoon" : "Evening";
  const firstName = (displayName || "").split(" ")[0] || "there";
  return `Good ${period}, ${firstName}`;
}

export function AppLayout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const title = pageTitles[location.pathname] || "NIMT UniOs";
  const { profile, role } = useAuth();
  const isCounsellor = role === "counsellor";
  const [deferredShellReady, setDeferredShellReady] = useState(false);
  usePresenceHeartbeat();

  useEffect(() => {
    setDeferredShellReady(false);
    const timeoutId = window.setTimeout(() => setDeferredShellReady(true), 600);
    return () => window.clearTimeout(timeoutId);
  }, [location.pathname]);

  return (
    <CounsellorFilterProvider>
    <div className="flex flex-col min-h-screen">
      <ImpersonationBanner />
      <SidebarProvider>
        <div className="flex-1 flex w-full">
          <AppSidebar />
          <div className="flex-1 flex flex-col min-w-0">
            <header className="sticky top-0 z-30 flex min-h-12 items-center justify-between gap-2 border-b border-border bg-card px-3 py-2 sm:px-5">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <SidebarTrigger className="text-muted-foreground hover:text-foreground transition-colors" />
                <div className="flex min-w-0 items-center gap-1.5 text-sm">
                  <span className="truncate font-semibold text-foreground">
                    {isCounsellor ? counsellorGreeting(profile?.display_name) : "NIMT"}
                  </span>
                  <span className="flex-shrink-0 text-muted-foreground/50">›</span>
                  <span className="truncate font-medium text-muted-foreground">{title}</span>
                </div>
              </div>
              <div className="flex flex-shrink-0 items-center gap-1 sm:gap-1.5">
                <HeaderSearch />
                {deferredShellReady && <HeaderFeedbackWidget />}
                {deferredShellReady && <WhatsAppPanel />}
                {deferredShellReady && <NotificationPanel />}
                <div className="w-px h-6 bg-border/60 mx-0.5" />
                <HeaderProfile />
              </div>
            </header>
            {deferredShellReady && <CahetSprintTicker />}
            {deferredShellReady && <UpdeledSprintTicker />}
            {deferredShellReady && <ApplicantDeadlineTicker />}
            {deferredShellReady && <GlobalActionBar />}
            {deferredShellReady && <LiveCallBar />}
            <main className="flex-1 overflow-auto p-6">
              <Suspense fallback={
                <div className="animate-rs-slide-up space-y-6">
                  <div className="space-y-2">
                    <div className="h-7 w-48 rounded-lg flutes" />
                    <div className="h-4 w-80 rounded-md flutes" />
                  </div>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <div className="h-28 rounded-lg flutes" />
                    <div className="h-28 rounded-lg flutes" />
                    <div className="h-28 rounded-lg flutes" />
                    <div className="h-28 rounded-lg flutes" />
                  </div>
                  <div className="h-64 rounded-lg flutes" />
                </div>
              }>
                {children}
              </Suspense>
            </main>
          </div>
        </div>
      </SidebarProvider>
    </div>
    </CounsellorFilterProvider>
  );
}
