import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { LogOut, Settings, User, ChevronDown } from "lucide-react";

const roleLabels: Record<string, string> = {
  super_admin: "Super Admin", campus_admin: "Campus Admin", principal: "Principal",
  faculty: "Faculty", teacher: "Teacher", student: "Student", parent: "Parent",
  counsellor: "Counsellor", accountant: "Accountant", admission_head: "Admission Head",
  data_entry: "Data Entry", office_admin: "Office Administrator", office_assistant: "Office Assistant", hostel_warden: "Hostel Warden",
  consultant: "Consultant", ib_coordinator: "IB Coordinator",
};

export function HeaderProfile() {
  const { profile, role, signOut } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const displayName = profile?.display_name || "User";
  const roleLabel = role ? (roleLabels[role] || role) : "User";
  const initials = displayName.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase();

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 rounded-xl px-2 py-1 hover:bg-muted transition-colors"
      >
        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
          {initials}
        </div>
        <div className="hidden sm:flex flex-col items-start">
          <span className="text-[12px] font-semibold text-foreground leading-tight truncate max-w-[100px]">{displayName}</span>
          <span className="text-[10px] text-muted-foreground leading-tight">{roleLabel}</span>
        </div>
        <ChevronDown className="h-3 w-3 text-muted-foreground hidden sm:block" />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 w-56 rounded-xl border border-border bg-card shadow-lg z-50 py-1.5 overflow-hidden">
          {/* User info */}
          <div className="px-4 py-2.5 border-b border-border/50">
            <p className="text-sm font-semibold text-foreground truncate">{displayName}</p>
            <p className="text-[11px] text-muted-foreground">{roleLabel}</p>
          </div>

          {/* Menu items */}
          <button
            onClick={() => { navigate("/settings"); setOpen(false); }}
            className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-foreground hover:bg-muted/50 transition-colors"
          >
            <Settings className="h-4 w-4 text-muted-foreground" />
            Settings
          </button>
          <button
            onClick={() => { signOut(); setOpen(false); }}
            className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-destructive hover:bg-destructive/5 transition-colors"
          >
            <LogOut className="h-4 w-4" />
            Sign Out
          </button>
        </div>
      )}
    </div>
  );
}
