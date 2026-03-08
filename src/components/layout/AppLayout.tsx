import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { Bell, MessageSquare, Search } from "lucide-react";
import { useLocation } from "react-router-dom";

const pageTitles: Record<string, string> = {
  "/": "Dashboard",
  "/admissions": "Admissions",
  "/students": "Students",
  "/attendance": "Attendance",
  "/finance": "Finance",
  "/exams": "Exams",
  "/campuses": "Campuses",
  "/courses": "Courses",
  "/reports": "Reports",
  "/documents": "Documents",
  "/settings": "Settings",
};

export function AppLayout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const title = pageTitles[location.pathname] || "NIMT UniOs";

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border bg-card px-4">
            <div className="flex items-center gap-3">
              <SidebarTrigger className="text-muted-foreground hover:text-foreground" />
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span className="font-medium text-foreground">{title}</span>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground transition-colors">
                <Search className="h-[18px] w-[18px]" />
              </button>
              <button className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground transition-colors">
                <MessageSquare className="h-[18px] w-[18px]" />
              </button>
              <button className="relative flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground transition-colors">
                <Bell className="h-[18px] w-[18px]" />
                <span className="absolute right-1.5 top-1.5 flex h-2 w-2 rounded-full bg-destructive" />
              </button>
            </div>
          </header>
          <main className="flex-1 overflow-auto p-6">
            {children}
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
