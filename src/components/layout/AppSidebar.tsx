import {
  LayoutDashboard, Users, GraduationCap, IndianRupee,
  ClipboardCheck, Settings, Bell, MessageSquare, Search,
  Building2, BookOpen, BarChart3, FileText, School
} from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useLocation } from "react-router-dom";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent,
  SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";

const mainMenu = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard },
  { title: "Admissions", url: "/admissions", icon: GraduationCap },
  { title: "Students", url: "/students", icon: Users },
  { title: "Attendance", url: "/attendance", icon: ClipboardCheck },
  { title: "Finance", url: "/finance", icon: IndianRupee },
  { title: "Exams", url: "/exams", icon: BookOpen },
];

const managementMenu = [
  { title: "Campuses", url: "/campuses", icon: Building2 },
  { title: "Courses", url: "/courses", icon: School },
  { title: "Reports", url: "/reports", icon: BarChart3 },
  { title: "Documents", url: "/documents", icon: FileText },
];

const settingsMenu = [
  { title: "Settings", url: "/settings", icon: Settings },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();
  const isActive = (path: string) => location.pathname === path;

  return (
    <Sidebar collapsible="icon" className="border-r-0">
      <SidebarContent className="bg-sidebar pt-4">
        {/* Logo */}
        <div className="flex items-center gap-2.5 px-4 pb-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary">
            <GraduationCap className="h-5 w-5 text-primary-foreground" />
          </div>
          {!collapsed && (
            <div>
              <span className="text-sm font-bold text-foreground tracking-tight">NIMT</span>
              <span className="text-sm font-medium text-muted-foreground ml-1">UniOs</span>
            </div>
          )}
        </div>

        <SidebarGroup>
          <SidebarGroupLabel className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70 px-4">
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
                      className="gap-3 rounded-lg px-3 py-2 text-sm font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                      activeClassName="bg-sidebar-accent text-sidebar-accent-foreground font-semibold"
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
          <SidebarGroupLabel className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70 px-4">
            Management
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {managementMenu.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild isActive={isActive(item.url)}>
                    <NavLink
                      to={item.url}
                      className="gap-3 rounded-lg px-3 py-2 text-sm font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                      activeClassName="bg-sidebar-accent text-sidebar-accent-foreground font-semibold"
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
                {settingsMenu.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild isActive={isActive(item.url)}>
                      <NavLink
                        to={item.url}
                        className="gap-3 rounded-lg px-3 py-2 text-sm font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                        activeClassName="bg-sidebar-accent text-sidebar-accent-foreground font-semibold"
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

          {/* Account */}
          {!collapsed && (
            <div className="border-t border-sidebar-border px-4 py-3">
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                  SA
                </div>
                <div className="flex flex-col">
                  <span className="text-sm font-medium text-foreground">Super Admin</span>
                  <span className="text-[11px] text-muted-foreground">admin@nimt.edu</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </SidebarContent>
    </Sidebar>
  );
}
