import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { ImpersonationBanner } from "@/components/layout/ImpersonationBanner";
import { GlobalActionBar } from "@/components/layout/GlobalActionBar";
import { LiveCallBar } from "@/components/layout/LiveCallBar";
import { NotificationPanel } from "@/components/layout/NotificationPanel";
import { WhatsAppPanel } from "@/components/layout/WhatsAppPanel";
import { HeaderSearch } from "@/components/layout/HeaderSearch";
import { HeaderProfile } from "@/components/layout/HeaderProfile";
import { HeaderResponseTime } from "@/components/layout/HeaderResponseTime";
import { useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { CounsellorFilterProvider } from "@/contexts/CounsellorFilterContext";

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

export function AppLayout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const title = pageTitles[location.pathname] || "NIMT UniOs";
  const { profile } = useAuth();

  return (
    <CounsellorFilterProvider>
    <div className="flex flex-col min-h-screen">
      <ImpersonationBanner />
      <SidebarProvider>
        <div className="flex-1 flex w-full">
          <AppSidebar />
          <div className="flex-1 flex flex-col min-w-0">
            <header className="sticky top-0 z-30 flex h-12 items-center justify-between border-b border-border bg-card px-5">
              <div className="flex items-center gap-3">
                <SidebarTrigger className="text-muted-foreground hover:text-foreground transition-colors" />
                <div className="flex items-center gap-1.5 text-sm">
                  <span className="font-semibold text-foreground">NIMT</span>
                  <span className="text-muted-foreground/50">›</span>
                  <span className="font-medium text-muted-foreground">{title}</span>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <HeaderSearch />
                <HeaderResponseTime />
                <WhatsAppPanel />
                <NotificationPanel />
                <div className="w-px h-6 bg-border/60 mx-0.5" />
                <HeaderProfile />
              </div>
            </header>
            <GlobalActionBar />
            <LiveCallBar />
            <main className="flex-1 overflow-auto p-6">
              {children}
            </main>
          </div>
        </div>
      </SidebarProvider>
    </div>
    </CounsellorFilterProvider>
  );
}