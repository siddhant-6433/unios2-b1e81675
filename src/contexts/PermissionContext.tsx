import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./AuthContext";

interface PermissionContextType {
  permissions: Set<string>;
  loading: boolean;
  /** Check if user has a specific permission */
  can: (module: string, action: string) => boolean;
  /** Check if user has ANY permission on a module */
  canAny: (module: string) => boolean;
  /** Reload permissions (e.g. after admin changes) */
  refresh: () => Promise<void>;
}

const PermissionContext = createContext<PermissionContextType>({
  permissions: new Set(),
  loading: true,
  can: () => false,
  canAny: () => false,
  refresh: async () => {},
});

export const usePermissions = () => useContext(PermissionContext);

/** Shorthand: usePermission("leads", "view") → boolean */
export function usePermission(module: string, action?: string): boolean {
  const { can, canAny } = usePermissions();
  if (action) return can(module, action);
  return canAny(module);
}

export const PermissionProvider = ({ children }: { children: ReactNode }) => {
  const { user, role, realRole, roleLoaded } = useAuth();
  const [permissions, setPermissions] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  const fetchPermissions = useCallback(async () => {
    if (!user?.id || !roleLoaded) return;

    // Super admin has all permissions — no query needed (even when impersonating)
    if (role === "super_admin" || realRole === "super_admin") {
      setPermissions(new Set(["*"])); // sentinel for "all"
      setLoading(false);
      return;
    }

    const { data, error } = await supabase.rpc("get_user_permissions", { _user_id: user.id });
    if (error) {
      console.error("Failed to load permissions:", error.message);
      setPermissions(new Set());
    } else {
      setPermissions(new Set(data || []));
    }
    setLoading(false);
  }, [user?.id, role, realRole, roleLoaded]);

  useEffect(() => {
    if (roleLoaded) fetchPermissions();
  }, [fetchPermissions, roleLoaded]);

  // Reset on logout
  useEffect(() => {
    if (!user) {
      setPermissions(new Set());
      setLoading(true);
    }
  }, [user]);

  const can = useCallback((module: string, action: string): boolean => {
    if (role === "super_admin" || realRole === "super_admin") return true;
    if (loading) return true; // Show everything while loading to avoid flash
    return permissions.has(`${module}:${action}`);
  }, [permissions, role, realRole, loading]);

  const canAny = useCallback((module: string): boolean => {
    if (role === "super_admin" || realRole === "super_admin") return true;
    if (loading) return true;
    for (const p of permissions) {
      if (p.startsWith(`${module}:`)) return true;
    }
    return false;
  }, [permissions, role, realRole, loading]);

  return (
    <PermissionContext.Provider value={{ permissions, loading, can, canAny, refresh: fetchPermissions }}>
      {children}
    </PermissionContext.Provider>
  );
};
