import { ReactNode, useState } from "react";
import { Bell, LogOut, Menu, X } from "lucide-react";
import uniosLogo from "@/assets/unios-logo.png";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";

interface Tab {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

interface PortalLayoutProps {
  children: ReactNode;
  institutionName?: string;
  tabs?: Tab[];
  activeTab?: string;
  onTabChange?: (id: string) => void;
  showNotifications?: boolean;
}

export function PortalLayout({
  children,
  institutionName = "NIMT University",
  tabs,
  activeTab,
  onTabChange,
  showNotifications = true,
}: PortalLayoutProps) {
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  const handleSignOut = async () => {
    await signOut();
    navigate("/login");
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-30">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src={uniosLogo} alt="UniOs" className="h-8 w-8 object-contain" />
            <span className="text-sm font-semibold text-gray-900">{institutionName}</span>
          </div>
          <div className="flex items-center gap-2">
            {showNotifications && (
              <button className="relative p-2 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors">
                <Bell className="h-5 w-5" />
              </button>
            )}
            <button
              onClick={handleSignOut}
              className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors"
              title="Sign out"
            >
              <LogOut className="h-5 w-5" />
            </button>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 max-w-3xl mx-auto w-full px-4 py-6">
        {children}
      </main>

      {/* Bottom tabs (mobile web) */}
      {tabs && tabs.length > 0 && (
        <nav className="sticky bottom-0 bg-white border-t border-gray-200 sm:hidden">
          <div className="flex">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => onTabChange?.(tab.id)}
                className={`flex-1 flex flex-col items-center gap-1 py-3 text-[11px] font-medium transition-colors ${
                  activeTab === tab.id
                    ? "text-primary"
                    : "text-gray-400"
                }`}
              >
                <tab.icon className="h-5 w-5" />
                {tab.label}
              </button>
            ))}
          </div>
        </nav>
      )}
    </div>
  );
}
