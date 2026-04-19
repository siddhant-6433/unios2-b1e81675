import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

type AppRole = Database["public"]["Enums"]["app_role"];

interface Profile {
  id: string;
  display_name: string | null;
  phone: string | null;
  avatar_url: string | null;
  campus: string | null;
  department: string | null;
  institution: string | null;
}

interface ImpersonationTarget {
  userId: string;
  displayName: string;
  role: AppRole | null;
  profile: Profile | null;
}

interface AuthContextType {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  role: AppRole | null;
  permissions: string[];
  hasPermission: (perm: string) => boolean;
  loading: boolean;
  roleLoaded: boolean;
  signOut: () => Promise<void>;
  /** True role of the logged-in user (unaffected by impersonation) */
  realRole: AppRole | null;
  /** Whether superadmin is currently impersonating another user */
  isImpersonating: boolean;
  /** Name of the user being impersonated */
  impersonatingName: string | null;
  /** Start impersonating a user (super_admin only) */
  startImpersonating: (userId: string) => Promise<void>;
  /** Stop impersonating and revert to superadmin view */
  stopImpersonating: () => void;
}

const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  profile: null,
  role: null,
  permissions: [],
  hasPermission: () => false,
  loading: true,
  roleLoaded: false,
  signOut: async () => {},
  realRole: null,
  isImpersonating: false,
  impersonatingName: null,
  startImpersonating: async () => {},
  stopImpersonating: () => {},
});

export const useAuth = () => useContext(AuthContext);

const IMPERSONATION_KEY = "unios_impersonation";

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [role, setRole] = useState<AppRole | null>(null);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [roleLoaded, setRoleLoaded] = useState(false);
  const [impersonation, setImpersonation] = useState<ImpersonationTarget | null>(() => {
    try {
      const stored = sessionStorage.getItem(IMPERSONATION_KEY);
      return stored ? JSON.parse(stored) : null;
    } catch { return null; }
  });

  const fetchUserData = async (userId: string, authUser?: User) => {
    try {
      const [profileRes, roleRes] = await Promise.all([
        supabase.from("profiles").select("id, display_name, phone, avatar_url, campus, department, institution").eq("user_id", userId).single(),
        supabase.rpc("get_user_role", { _user_id: userId }),
      ]);

      if (profileRes.data) {
        // Sync phone from auth if profile phone is empty but auth user has one
        const existingProfile = profileRes.data;
        const authPhone = authUser?.phone || null;
        if (!existingProfile.phone && authPhone) {
          await supabase.from("profiles").update({ phone: authPhone }).eq("user_id", userId);
          existingProfile.phone = authPhone;
        }
        setProfile(existingProfile);
      } else {
        // Profile missing (user created outside normal signup flow) — create it now
        const meta = authUser?.user_metadata ?? {};
        const displayName = meta.display_name || meta.full_name || authUser?.email || userId;
        const phone = authUser?.phone || null;
        const { data: upserted } = await supabase
          .from("profiles")
          .upsert({ user_id: userId, display_name: displayName, ...(phone && { phone }) }, { onConflict: "user_id" })
          .select("id, display_name, phone, avatar_url, campus, department, institution")
          .single();
        if (upserted) setProfile(upserted);
      }

      if (roleRes.data) setRole(roleRes.data as AppRole);

      // Fetch permissions separately — non-critical, must not block auth
      try {
        const permsRes = await supabase.rpc("get_user_permissions", { _user_id: userId });
        if (Array.isArray(permsRes?.data)) setPermissions(permsRes.data as string[]);
      } catch {
        // Permissions fetch failed — default to empty (role-based access still works)
      }
    } catch (err) {
      console.error("fetchUserData failed:", err);
    } finally {
      setRoleLoaded(true);
    }
  };

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        setSession(session);
        if (session?.user) {
          // Use setTimeout to avoid Supabase client deadlock
          setTimeout(() => fetchUserData(session.user.id, session.user), 0);
        } else {
          setProfile(null);
          setRole(null);
          setRoleLoaded(true); // no user = no role to load
        }
        setLoading(false);
      }
    );

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session?.user) {
        fetchUserData(session.user.id, session.user);
      } else {
        setRoleLoaded(true); // no user = no role to load
      }
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const startImpersonating = useCallback(async (userId: string) => {
    if (role !== "super_admin") return;

    const [profileRes, roleRes] = await Promise.all([
      supabase.from("profiles").select("id, display_name, phone, avatar_url, campus, department, institution").eq("user_id", userId).single(),
      supabase.rpc("get_user_role", { _user_id: userId }),
    ]);

    const target: ImpersonationTarget = {
      userId,
      displayName: profileRes.data?.display_name || "Unknown User",
      role: (roleRes.data as AppRole) || null,
      profile: profileRes.data || null,
    };

    setImpersonation(target);
    sessionStorage.setItem(IMPERSONATION_KEY, JSON.stringify(target));
  }, [role]);

  const stopImpersonating = useCallback(() => {
    setImpersonation(null);
    sessionStorage.removeItem(IMPERSONATION_KEY);
  }, []);

  const signOut = async () => {
    stopImpersonating();
    await supabase.auth.signOut();
    setSession(null);
    setProfile(null);
    setRole(null);
  };

  const hasPermission = useCallback((perm: string) => {
    // super_admin has all permissions
    if (role === "super_admin") return true;
    return permissions.includes(perm);
  }, [role, permissions]);

  // When impersonating, override role, profile, and user.id
  const effectiveRole = impersonation ? impersonation.role : role;
  const effectiveProfile = impersonation ? impersonation.profile : profile;
  const realUser = session?.user ?? null;
  const effectiveUser = impersonation && realUser
    ? { ...realUser, id: impersonation.userId } as User
    : realUser;

  return (
    <AuthContext.Provider value={{
      session,
      user: effectiveUser,
      profile: effectiveProfile,
      role: effectiveRole,
      permissions,
      hasPermission,
      loading,
      roleLoaded,
      signOut,
      realRole: role,
      isImpersonating: !!impersonation,
      impersonatingName: impersonation?.displayName ?? null,
      startImpersonating,
      stopImpersonating,
    }}>
      {children}
    </AuthContext.Provider>
  );
};
