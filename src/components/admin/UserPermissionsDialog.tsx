import { useState, useEffect } from "react";
import { ButtonOrb, OrbLoader } from "@/components/ui/thinking-orb";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { X, ShieldCheck, ShieldOff } from "lucide-react";

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

    // Reading another user's overrides needs the super_admin SELECT policy
    // (20260802140659). Without surfacing this, an RLS-filtered read looks
    // identical to "this user has no overrides".
    if (overridesRes.error) {
      toast({
        title: "Could not load permission overrides",
        description: `${overridesRes.error.message} — showing role defaults only.`,
        variant: "destructive",
      });
    }

    setAllPermissions(permsRes.data || []);
    setRolePermissionIds(new Set((rolePermsRes.data || []).map((rp: any) => rp.permission_id)));
    const ovMap = new Map<string, boolean>();
    (overridesRes.data || []).forEach((o: any) => ovMap.set(o.permission_id, o.granted));
    setOverrides(ovMap);
    setLoading(false);
  };

  const togglePermission = async (permId: string, currentlyEffective: boolean) => {
    setSaving(permId);
    const perm = allPermissions.find((p) => p.id === permId);
    const hasRolePerm = rolePermissionIds.has(permId);

    // Photo Day capture must go through assign_photo_day so principal campus ACL applies
    // (raw overrides table is super_admin-only for writes).
    if (perm?.module === "photo_day" && perm.action === "capture") {
      try {
        const nextGranted = !currentlyEffective;
        const { error } = await supabase.rpc("assign_photo_day" as never, {
          _target_user_id: userId,
          _granted: nextGranted,
        } as never);
        if (error) throw error;
        const newMap = new Map(overrides);
        if (nextGranted) {
          if (hasRolePerm) newMap.delete(permId);
          else newMap.set(permId, true);
        } else {
          if (hasRolePerm) newMap.set(permId, false);
          else newMap.delete(permId);
        }
        setOverrides(newMap);
        toast({
          title: nextGranted ? "Photo Day enabled" : "Photo Day revoked",
          description: `${userName} ${nextGranted ? "can" : "can no longer"} capture student photos.`,
        });
      } catch (err: any) {
        toast({ title: "Error", description: err.message, variant: "destructive" });
      } finally {
        setSaving(null);
      }
      return;
    }

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
      // These writes are super_admin-only at the RLS layer. Without reading the
      // error back, a blocked write still flipped the local checkbox and toasted
      // "Permission updated" — the change looked saved and silently wasn't.
      // .select() makes RLS-filtered no-ops visible too: a policy-filtered write
      // returns no error and no rows.
      if (newOverride === null) {
        const { error, data } = await supabase.from("user_permission_overrides" as any)
          .delete()
          .eq("user_id", userId)
          .eq("permission_id", permId)
          .select("permission_id");
        if (error) throw error;
        // A delete matching nothing is fine — there may have been no override.
        void data;
        const newMap = new Map(overrides);
        newMap.delete(permId);
        setOverrides(newMap);
      } else {
        const { error, data } = await supabase.from("user_permission_overrides" as any)
          .upsert(
            { user_id: userId, permission_id: permId, granted: newOverride, granted_by: user?.id },
            { onConflict: "user_id,permission_id" }
          )
          .select("permission_id");
        if (error) throw error;
        if (!data || (data as unknown[]).length === 0) {
          throw new Error("Not saved — only a super admin can change permission overrides.");
        }
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
              <OrbLoader state="searching" />
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
                              <span className="rounded-full bg-success/10 dark:bg-success/80/30 px-1.5 py-0.5 text-[10px] font-semibold text-success dark:text-success">
                                GRANTED
                              </span>
                            )}
                            {status === "revoked" && (
                              <span className="rounded-full bg-destructive/10 dark:bg-destructive/80/30 px-1.5 py-0.5 text-[10px] font-semibold text-destructive dark:text-destructive/80">
                                REVOKED
                              </span>
                            )}
                            {status === "role" && (
                              <span className="rounded-full bg-info/10 dark:bg-info/80/30 px-1.5 py-0.5 text-[10px] font-semibold text-info-foreground dark:text-info/80">
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
                              ? "bg-success/10 dark:bg-success/80/30 text-success dark:text-success hover:bg-destructive/10 dark:hover:bg-destructive/80/30 hover:text-destructive dark:hover:text-destructive/80"
                              : "bg-muted text-muted-foreground hover:bg-success/10 dark:hover:bg-success/80/30 hover:text-success dark:hover:text-success"
                          }`}
                        >
                          {isSaving ? (
                            <ButtonOrb state="working" onFilled />
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
