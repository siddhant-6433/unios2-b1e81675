import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Loader2, X, ShieldCheck, ShieldOff } from "lucide-react";

interface Permission {
  id: string;
  module: string;
  action: string;
  description: string | null;
}

interface Override {
  permission_id: string;
  granted: boolean;
}

interface Props {
  open: boolean;
  onClose: () => void;
  userId: string;
  userName: string;
  userRole: string | null;
}

export default function UserPermissionsDialog({ open, onClose, userId, userName, userRole }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [allPermissions, setAllPermissions] = useState<Permission[]>([]);
  const [rolePermissionIds, setRolePermissionIds] = useState<Set<string>>(new Set());
  const [overrides, setOverrides] = useState<Map<string, boolean>>(new Map());

  useEffect(() => {
    if (!open || !userId) return;
    fetchData();
  }, [open, userId]);

  const fetchData = async () => {
    setLoading(true);
    const [permsRes, rolePermsRes, overridesRes] = await Promise.all([
      supabase.from("permissions").select("id, module, action, description").order("module").order("action"),
      supabase.from("role_permissions").select("permission_id").eq("role", userRole || ""),
      supabase.from("user_permission_overrides" as any).select("permission_id, granted").eq("user_id", userId),
    ]);

    setAllPermissions(permsRes.data || []);
    setRolePermissionIds(new Set((rolePermsRes.data || []).map((rp: any) => rp.permission_id)));
    const ovMap = new Map<string, boolean>();
    (overridesRes.data || []).forEach((o: any) => ovMap.set(o.permission_id, o.granted));
    setOverrides(ovMap);
    setLoading(false);
  };

  const togglePermission = async (permId: string, currentlyEffective: boolean) => {
    setSaving(permId);
    const hasRolePerm = rolePermissionIds.has(permId);
    const currentOverride = overrides.get(permId);

    // Determine new state
    let newOverride: boolean | null = null; // null = remove override
    if (currentlyEffective) {
      // Currently has permission — revoke it
      if (hasRolePerm) {
        newOverride = false; // need explicit revoke since role grants it
      } else {
        newOverride = null; // remove the grant override
      }
    } else {
      // Currently doesn't have permission — grant it
      if (hasRolePerm) {
        newOverride = null; // remove the revoke override, role will grant it
      } else {
        newOverride = true; // need explicit grant since role doesn't have it
      }
    }

    try {
      if (newOverride === null) {
        // Remove override
        await supabase.from("user_permission_overrides" as any)
          .delete()
          .eq("user_id", userId)
          .eq("permission_id", permId);
        const newMap = new Map(overrides);
        newMap.delete(permId);
        setOverrides(newMap);
      } else {
        // Upsert override
        await supabase.from("user_permission_overrides" as any)
          .upsert(
            { user_id: userId, permission_id: permId, granted: newOverride, granted_by: user?.id },
            { onConflict: "user_id,permission_id" }
          );
        const newMap = new Map(overrides);
        newMap.set(permId, newOverride);
        setOverrides(newMap);
      }
      toast({ title: "Permission updated" });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSaving(null);
    }
  };

  const getEffective = (permId: string): boolean => {
    const override = overrides.get(permId);
    if (override !== undefined) return override;
    return rolePermissionIds.has(permId);
  };

  const getStatus = (permId: string): "role" | "granted" | "revoked" | "none" => {
    const override = overrides.get(permId);
    const hasRole = rolePermissionIds.has(permId);
    if (override === true) return "granted";
    if (override === false) return "revoked";
    if (hasRole) return "role";
    return "none";
  };

  if (!open) return null;

  // Group permissions by module
  const grouped = allPermissions.reduce<Record<string, Permission[]>>((acc, p) => {
    (acc[p.module] ||= []).push(p);
    return acc;
  }, {});

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="relative w-full max-w-lg max-h-[85vh] rounded-2xl bg-card shadow-xl border border-border overflow-hidden flex flex-col">
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Permissions: {userName}</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Role: {userRole?.replace(/_/g, " ") || "None"} &middot; Toggle to grant/revoke per-user overrides
            </p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-6 py-4 space-y-5">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            Object.entries(grouped).map(([module, perms]) => (
              <div key={module}>
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                  {module.replace(/_/g, " ")}
                </h3>
                <div className="space-y-1">
                  {perms.map((p) => {
                    const effective = getEffective(p.id);
                    const status = getStatus(p.id);
                    const isSaving = saving === p.id;
                    return (
                      <div key={p.id} className="flex items-center justify-between rounded-lg px-3 py-2 hover:bg-muted/50 transition-colors">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-foreground">{p.action}</span>
                            {status === "granted" && (
                              <span className="rounded-full bg-emerald-100 dark:bg-emerald-900/30 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-400">
                                GRANTED
                              </span>
                            )}
                            {status === "revoked" && (
                              <span className="rounded-full bg-red-100 dark:bg-red-900/30 px-1.5 py-0.5 text-[10px] font-semibold text-red-700 dark:text-red-400">
                                REVOKED
                              </span>
                            )}
                            {status === "role" && (
                              <span className="rounded-full bg-blue-100 dark:bg-blue-900/30 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700 dark:text-blue-400">
                                FROM ROLE
                              </span>
                            )}
                          </div>
                          {p.description && (
                            <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{p.description}</p>
                          )}
                        </div>
                        <button
                          onClick={() => togglePermission(p.id, effective)}
                          disabled={!!saving}
                          className={`ml-3 flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
                            effective
                              ? "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 hover:bg-red-100 dark:hover:bg-red-900/30 hover:text-red-700 dark:hover:text-red-400"
                              : "bg-muted text-muted-foreground hover:bg-emerald-100 dark:hover:bg-emerald-900/30 hover:text-emerald-700 dark:hover:text-emerald-400"
                          }`}
                        >
                          {isSaving ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : effective ? (
                            <ShieldCheck className="h-3.5 w-3.5" />
                          ) : (
                            <ShieldOff className="h-3.5 w-3.5" />
                          )}
                          {effective ? "On" : "Off"}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
