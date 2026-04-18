import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Check, X, Search, Shield } from "lucide-react";

interface Permission {
  id: string;
  module: string;
  action: string;
  description: string;
}

interface RolePermission {
  id: string;
  role: string;
  permission_id: string;
}

interface UserOverride {
  id: string;
  user_id: string;
  permission_id: string;
  granted: boolean;
}

const ROLES = [
  "campus_admin", "principal", "admission_head", "counsellor", "accountant",
  "faculty", "teacher", "data_entry", "office_assistant", "hostel_warden",
  "ib_coordinator", "consultant", "student", "parent",
];

const ROLE_LABELS: Record<string, string> = {
  campus_admin: "Campus Admin", principal: "Principal", admission_head: "Adm. Head",
  counsellor: "Counsellor", accountant: "Accountant", faculty: "Faculty",
  teacher: "Teacher", data_entry: "Data Entry", office_assistant: "Office Asst.",
  hostel_warden: "Hostel", ib_coordinator: "IB Coord.", consultant: "Consultant",
  student: "Student", parent: "Parent",
};

const MODULE_LABELS: Record<string, string> = {
  dashboard: "Dashboard", search: "Search", students: "Students", attendance: "Attendance",
  exams: "Exams", finance: "Finance", reports: "Reports", leads: "Leads",
  whatsapp: "WhatsApp", performance: "Performance", lead_buckets: "Lead Buckets",
  lead_allocation: "Lead Allocation", automation: "Automation", consultants: "Consultants",
  templates: "Templates", courses_fees: "Courses & Fees", consultant_portal: "Consultant Portal",
  analytics: "Analytics", ib_poi: "IB POI", ib_units: "IB Units", ib_gradebook: "IB Gradebook",
  ib_portfolios: "IB Portfolios", ib_action: "IB Action", ib_reports: "IB Reports",
  ib_exhibition: "IB Exhibition", ib_projects: "IB Projects", ib_idu: "IB IDU",
  campuses_courses: "Campuses", documents: "Documents", alumni_verification: "Alumni Verification",
  user_management: "User Mgmt", permissions: "Permissions",
};

export function PermissionMatrixPanel() {
  const { toast } = useToast();
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [rolePerms, setRolePerms] = useState<RolePermission[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [filterModule, setFilterModule] = useState("");

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    const [permsRes, rpRes] = await Promise.all([
      supabase.from("permissions" as any).select("*").order("module").order("action"),
      supabase.from("role_permissions" as any).select("*"),
    ]);
    if (permsRes.data) setPermissions(permsRes.data as any);
    if (rpRes.data) setRolePerms(rpRes.data as any);
    setLoading(false);
  };

  // Group permissions by module
  const modules = useMemo(() => {
    const map = new Map<string, Permission[]>();
    for (const p of permissions) {
      if (!map.has(p.module)) map.set(p.module, []);
      map.get(p.module)!.push(p);
    }
    return Array.from(map.entries()).filter(([mod]) =>
      !filterModule || mod.toLowerCase().includes(filterModule.toLowerCase()) ||
      (MODULE_LABELS[mod] || "").toLowerCase().includes(filterModule.toLowerCase())
    );
  }, [permissions, filterModule]);

  // Build lookup: role:permissionId → true
  const rpSet = useMemo(() => {
    const s = new Set<string>();
    for (const rp of rolePerms) s.add(`${rp.role}::${rp.permission_id}`);
    return s;
  }, [rolePerms]);

  const togglePermission = async (role: string, perm: Permission) => {
    const key = `${role}::${perm.id}`;
    setSaving(key);

    if (rpSet.has(key)) {
      // Remove
      await supabase.from("role_permissions" as any).delete().eq("role", role).eq("permission_id", perm.id);
      setRolePerms(prev => prev.filter(rp => !(rp.role === role && rp.permission_id === perm.id)));
    } else {
      // Add
      const { error } = await supabase.from("role_permissions" as any).insert({ role, permission_id: perm.id });
      if (error) {
        toast({ title: "Error", description: error.message, variant: "destructive" });
      } else {
        setRolePerms(prev => [...prev, { id: crypto.randomUUID(), role, permission_id: perm.id }]);
      }
    }
    setSaving(null);
  };

  // Toggle all actions in a module for a role
  const toggleModule = async (role: string, modulePerms: Permission[]) => {
    const allGranted = modulePerms.every(p => rpSet.has(`${role}::${p.id}`));

    if (allGranted) {
      // Remove all
      for (const p of modulePerms) {
        await supabase.from("role_permissions" as any).delete().eq("role", role).eq("permission_id", p.id);
      }
      setRolePerms(prev => prev.filter(rp => !(rp.role === role && modulePerms.some(p => p.id === rp.permission_id))));
    } else {
      // Grant all missing
      const missing = modulePerms.filter(p => !rpSet.has(`${role}::${p.id}`));
      for (const p of missing) {
        await supabase.from("role_permissions" as any).insert({ role, permission_id: p.id });
      }
      setRolePerms(prev => [...prev, ...missing.map(p => ({ id: crypto.randomUUID(), role, permission_id: p.id }))]);
    }
  };

  if (loading) return <div className="flex h-32 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Permission Matrix</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Configure module access per role. Super Admin always has full access.</p>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={filterModule}
            onChange={e => setFilterModule(e.target.value)}
            placeholder="Filter modules..."
            className="rounded-lg border border-input bg-background py-1.5 pl-9 pr-3 text-xs focus:outline-none focus:ring-1 focus:ring-ring/20 w-48"
          />
        </div>
      </div>

      <div className="rounded-xl border border-border overflow-auto max-h-[calc(100vh-300px)]">
        <table className="w-full text-xs">
          <thead className="sticky top-0 z-10 bg-muted">
            <tr>
              <th className="text-left px-3 py-2.5 font-semibold text-muted-foreground border-b border-border min-w-[180px] sticky left-0 bg-muted z-20">Module / Action</th>
              {ROLES.map(r => (
                <th key={r} className="text-center px-1.5 py-2.5 font-medium text-muted-foreground border-b border-border min-w-[70px]">
                  <span className="text-[9px] leading-tight block">{ROLE_LABELS[r] || r}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {modules.map(([mod, perms]) => (
              <>
                {/* Module header row */}
                <tr key={`mod-${mod}`} className="bg-muted/30">
                  <td className="px-3 py-2 font-semibold text-foreground border-b border-border/50 sticky left-0 bg-muted/30 z-10">
                    <div className="flex items-center gap-2">
                      <Shield className="h-3 w-3 text-primary" />
                      {MODULE_LABELS[mod] || mod}
                    </div>
                  </td>
                  {ROLES.map(r => {
                    const allGranted = perms.every(p => rpSet.has(`${r}::${p.id}`));
                    const someGranted = perms.some(p => rpSet.has(`${r}::${p.id}`));
                    return (
                      <td key={r} className="text-center border-b border-border/50 px-1">
                        <button
                          onClick={() => toggleModule(r, perms)}
                          className={`h-5 w-5 rounded border inline-flex items-center justify-center transition-colors ${
                            allGranted ? "bg-primary border-primary text-primary-foreground" :
                            someGranted ? "bg-primary/30 border-primary/50 text-primary" :
                            "border-border hover:border-primary/50"
                          }`}
                          title={`Toggle all ${mod} permissions for ${r}`}
                        >
                          {allGranted ? <Check className="h-3 w-3" /> : someGranted ? <span className="text-[8px] font-bold">~</span> : null}
                        </button>
                      </td>
                    );
                  })}
                </tr>
                {/* Individual action rows */}
                {perms.map(p => (
                  <tr key={p.id} className="hover:bg-muted/20">
                    <td className="px-3 py-1.5 text-muted-foreground border-b border-border/30 sticky left-0 bg-card z-10 pl-8">
                      <span className="text-[10px]">{p.action}</span>
                      {p.description && <span className="text-[9px] text-muted-foreground/60 ml-1.5">— {p.description}</span>}
                    </td>
                    {ROLES.map(r => {
                      const key = `${r}::${p.id}`;
                      const granted = rpSet.has(key);
                      return (
                        <td key={r} className="text-center border-b border-border/30 px-1">
                          <button
                            onClick={() => togglePermission(r, p)}
                            disabled={saving === key}
                            className={`h-4 w-4 rounded-sm border inline-flex items-center justify-center transition-colors ${
                              granted ? "bg-emerald-500 border-emerald-500 text-white" : "border-border/60 hover:border-emerald-400"
                            }`}
                          >
                            {saving === key ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : granted ? <Check className="h-2.5 w-2.5" /> : null}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
