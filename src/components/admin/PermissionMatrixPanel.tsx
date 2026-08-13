import { PageLoader } from "@/components/ui/page-loader";
import { ButtonOrb } from "@/components/ui/thinking-orb";
import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Check, X, Search, Shield, Plus, Trash2 } from "lucide-react";
import { ALL_APP_ROLES, ROLE_LABELS } from "@/lib/accessPolicy";

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

// super_admin is omitted deliberately — it short-circuits every check, so a
// column of permanently-on checkboxes would be a lie.
const ROLES = ALL_APP_ROLES.filter(r => r !== "super_admin");

const MODULE_LABELS: Record<string, string> = {
  dashboard: "Dashboard", search: "Search", students: "Students", attendance: "Attendance",
  exams: "Exams", finance: "Finance", reports: "Reports", leads: "Leads",
  whatsapp: "WhatsApp", performance: "Performance", lead_buckets: "Lead Buckets",
  lead_allocation: "Lead Allocation", automation: "Automation", consultants: "Consultants",
  academic_partners: "Academic Partners", academic_partner_portal: "Academic Partner Portal",
  academic_partner_offer_letters: "Partner Offer Letters",
  templates: "Templates", courses_fees: "Courses & Fees", consultant_portal: "Consultant Portal",
  analytics: "Analytics", ib_poi: "IB POI", ib_units: "IB Units", ib_gradebook: "IB Gradebook",
  ib_portfolios: "IB Portfolios", ib_action: "IB Action", ib_reports: "IB Reports",
  ib_exhibition: "IB Exhibition", ib_projects: "IB Projects", ib_idu: "IB IDU",
  campuses_courses: "Campuses", documents: "Documents", alumni_verification: "Alumni Verification",
  user_management: "User Mgmt", permissions: "Permissions", library: "Library",
  fee_ledger: "Fee Ledger",
  fee_structure: "Fee Structure",
};

export function PermissionMatrixPanel() {
  const { toast } = useToast();
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [rolePerms, setRolePerms] = useState<RolePermission[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [filterModule, setFilterModule] = useState("");
  const [newPerm, setNewPerm] = useState<{ module: string; action: string; description: string } | null>(null);

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

  // Creating/deleting the permission itself, not a grant. A permission only
  // does anything once some code gates on `module:action` — so this is for
  // wiring up a gate that already exists in the app, not for inventing one.
  const createPermission = async () => {
    if (!newPerm) return;
    const module = newPerm.module.trim().toLowerCase().replace(/\s+/g, "_");
    const action = newPerm.action.trim().toLowerCase().replace(/\s+/g, "_");
    if (!module || !action) {
      toast({ title: "Module and action are required", variant: "destructive" });
      return;
    }
    setSaving("new");
    const { data, error } = await supabase
      .from("permissions" as any)
      .insert({ module, action, description: newPerm.description.trim() || null })
      .select()
      .single();
    setSaving(null);
    if (error) {
      toast({ title: "Could not add permission", description: error.message, variant: "destructive" });
      return;
    }
    setPermissions(prev => [...prev, data as any].sort((a, b) =>
      a.module.localeCompare(b.module) || a.action.localeCompare(b.action)));
    setNewPerm(null);
    toast({ title: `Added ${module}:${action}` });
  };

  const deletePermission = async (perm: Permission) => {
    const granted = ROLES.filter(r => rpSet.has(`${r}::${perm.id}`));
    if (granted.length && !confirm(
      `${perm.module}:${perm.action} is still granted to ${granted.length} role(s). Delete it and revoke everywhere?`
    )) return;
    setSaving(perm.id);
    // role_permissions and user_permission_overrides cascade on permission_id.
    const { error } = await supabase.from("permissions" as any).delete().eq("id", perm.id);
    setSaving(null);
    if (error) {
      toast({ title: "Could not delete permission", description: error.message, variant: "destructive" });
      return;
    }
    setPermissions(prev => prev.filter(p => p.id !== perm.id));
    setRolePerms(prev => prev.filter(rp => rp.permission_id !== perm.id));
  };

  if (loading) return <PageLoader />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Permission Matrix</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Configure module access per role. Super Admin always has full access.
            New <em>roles</em> need a migration (app_role is a database enum); permissions can be added here.
          </p>
        </div>
        <div className="flex items-center gap-2">
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
          <Button
            size="sm"
            variant="outline"
            className="h-8 text-xs"
            onClick={() => setNewPerm(newPerm ? null : { module: "", action: "", description: "" })}
          >
            <Plus className="h-3.5 w-3.5 mr-1" /> Permission
          </Button>
        </div>
      </div>

      {newPerm && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-muted/30 p-3">
          <input
            autoFocus
            value={newPerm.module}
            onChange={e => setNewPerm({ ...newPerm, module: e.target.value })}
            placeholder="module (e.g. marks)"
            className="rounded-lg border border-input bg-background px-2.5 py-1.5 text-xs w-44 focus:outline-none focus:ring-1 focus:ring-ring/20"
          />
          <span className="text-muted-foreground text-xs">:</span>
          <input
            value={newPerm.action}
            onChange={e => setNewPerm({ ...newPerm, action: e.target.value })}
            placeholder="action (e.g. publish)"
            className="rounded-lg border border-input bg-background px-2.5 py-1.5 text-xs w-44 focus:outline-none focus:ring-1 focus:ring-ring/20"
          />
          <input
            value={newPerm.description}
            onChange={e => setNewPerm({ ...newPerm, description: e.target.value })}
            placeholder="What it unlocks"
            className="flex-1 min-w-[200px] rounded-lg border border-input bg-background px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring/20"
          />
          <Button size="sm" className="h-8 text-xs" onClick={createPermission} disabled={saving === "new"}>
            {saving === "new" ? <ButtonOrb state="working" onFilled /> : "Add"}
          </Button>
          <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setNewPerm(null)}>Cancel</Button>
        </div>
      )}

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
                      <button
                        onClick={() => deletePermission(p)}
                        disabled={saving === p.id}
                        title={`Delete ${p.module}:${p.action} entirely`}
                        className="ml-1.5 align-middle text-muted-foreground/40 hover:text-destructive transition-colors"
                      >
                        <Trash2 className="h-2.5 w-2.5" />
                      </button>
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
                              granted ? "bg-success/50 border-success/35 text-white" : "border-border/60 hover:border-success/30"
                            }`}
                          >
                            {saving === key ? <ButtonOrb state="working" onFilled /> : granted ? <Check className="h-2.5 w-2.5" /> : null}
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
