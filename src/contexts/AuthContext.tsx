import { createContext, useContext, useEffect, useRef, useState, useCallback, ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { canUsePermission, permissionsForAcademicPartnerRole, type AccessState } from "@/lib/accessPolicy";

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
  permissions: string[];
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
const AUTH_BOOTSTRAP_TIMEOUT_MS = 8_000;

function withTimeout<T>(promise: PromiseLike<T>, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${label} timed out after ${AUTH_BOOTSTRAP_TIMEOUT_MS}ms`));
    }, AUTH_BOOTSTRAP_TIMEOUT_MS);
  });

  return Promise.race([Promise.resolve(promise), timeout]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
  });
}

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
  const fetchedUserDataForRef = useRef<string | null>(null);
  const lastRealUserIdRef = useRef<string | null>(null);

  const fetchUserData = async (userId: string, authUser?: User) => {
    if (fetchedUserDataForRef.current === userId) return;
    fetchedUserDataForRef.current = userId;
    setRoleLoaded(false);
    try {
      const [profileRes, roleRes] = await withTimeout(
        Promise.all([
          supabase.from("profiles").select("id, display_name, phone, avatar_url, campus, department, institution").eq("user_id", userId).single(),
          supabase.rpc("get_user_role", { _user_id: userId }),
        ]),
        "User profile and role load",
      );

      if (profileRes.data) {
        // Sync phone from auth if profile phone is empty but auth user has one
        const existingProfile = profileRes.data;
        const authPhone = authUser?.phone || null;
        if (!existingProfile.phone && authPhone) {
          await withTimeout(
            supabase.from("profiles").update({ phone: authPhone }).eq("user_id", userId),
            "Profile phone sync",
          );
          existingProfile.phone = authPhone;
        }
        setProfile(existingProfile);
      } else {
        // Profile missing (user created outside normal signup flow) — create it now
        const meta = authUser?.user_metadata ?? {};
        const displayName = meta.display_name || meta.full_name || authUser?.email || userId;
        const phone = authUser?.phone || null;
        const { data: upserted } = await withTimeout(
          supabase
            .from("profiles")
            .upsert({ user_id: userId, display_name: displayName, ...(phone && { phone }) }, { onConflict: "user_id" })
            .select("id, display_name, phone, avatar_url, campus, department, institution")
            .single(),
          "Profile creation",
        );
        if (upserted) setProfile(upserted);
      }

      if (roleRes.data) setRole(roleRes.data as AppRole);
      if (roleRes.data !== "super_admin") {
        setImpersonation(null);
        sessionStorage.removeItem(IMPERSONATION_KEY);
      }

      // Fetch permissions — non-critical, errors are safe to ignore
      supabase.rpc("get_user_permissions", { _user_id: userId })
        .then((res) => {
          const partnerPermissions = permissionsForAcademicPartnerRole(roleRes.data as AppRole | null);
          if (partnerPermissions) {
            setPermissions(Array.from(partnerPermissions));
          } else if (Array.isArray(res?.data)) {
            setPermissions(res.data);
          }
        })
        .catch(() => {});
    } catch (err) {
      fetchedUserDataForRef.current = null;
      console.error("fetchUserData failed:", err);
    } finally {
      setRoleLoaded(true);
    }
  };

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (event === "INITIAL_SESSION") return;
        const nextUserId = session?.user?.id ?? null;
        if (lastRealUserIdRef.current && lastRealUserIdRef.current !== nextUserId) {
          setImpersonation(null);
          sessionStorage.removeItem(IMPERSONATION_KEY);
        }
        lastRealUserIdRef.current = nextUserId;
        setSession(session);
        if (session?.user) {
          // Use setTimeout to avoid Supabase client deadlock
          setTimeout(() => fetchUserData(session.user.id, session.user), 0);
        } else {
          fetchedUserDataForRef.current = null;
          setProfile(null);
          setRole(null);
          setRoleLoaded(true); // no user = no role to load
        }
        setLoading(false);
      }
    );

    withTimeout(supabase.auth.getSession(), "Initial auth session load")
      .then(({ data: { session } }) => {
        const nextUserId = session?.user?.id ?? null;
        if (lastRealUserIdRef.current && lastRealUserIdRef.current !== nextUserId) {
          setImpersonation(null);
          sessionStorage.removeItem(IMPERSONATION_KEY);
        }
        lastRealUserIdRef.current = nextUserId;
        setSession(session);
        if (session?.user) {
          fetchUserData(session.user.id, session.user);
        } else {
          fetchedUserDataForRef.current = null;
          setRoleLoaded(true); // no user = no role to load
        }
      })
      .catch((err) => {
        console.error("Initial auth session load failed:", err);
        fetchedUserDataForRef.current = null;
        setSession(null);
        setProfile(null);
        setRole(null);
        setPermissions([]);
        setRoleLoaded(true);
      })
      .finally(() => {
        setLoading(false);
      });

    return () => subscription.unsubscribe();
  }, []);

  const startImpersonating = useCallback(async (userId: string) => {
    if (role !== "super_admin") return;

    const [profileRes, roleRes, permissionRes] = await Promise.all([
      supabase.from("profiles").select("id, display_name, phone, avatar_url, campus, department, institution").eq("user_id", userId).single(),
      supabase.rpc("get_user_role", { _user_id: userId }),
      supabase.rpc("get_user_permissions", { _user_id: userId }),
    ]);

    const targetRole = (roleRes.data as AppRole) || null;
    const partnerPermissions = permissionsForAcademicPartnerRole(targetRole);
    const targetPermissions = partnerPermissions
      ? Array.from(partnerPermissions)
      : Array.isArray(permissionRes.data)
        ? permissionRes.data
        : [];

    const target: ImpersonationTarget = {
      userId,
      displayName: profileRes.data?.display_name || "Unknown User",
      role: targetRole,
      profile: profileRes.data || null,
      permissions: targetPermissions,
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
    fetchedUserDataForRef.current = null;
    setSession(null);
    setProfile(null);
    setRole(null);
  };

  // When impersonating, override role, profile, and user.id
  const effectiveRole = impersonation ? impersonation.role : role;
  const effectiveProfile = impersonation ? impersonation.profile : profile;
  const effectivePermissions = impersonation ? impersonation.permissions : permissions;
  const realUser = session?.user ?? null;
  const effectiveUser = impersonation && realUser
    ? { ...realUser, id: impersonation.userId } as User
    : realUser;

  const hasPermission = useCallback((perm: string) => {
    const accessState: AccessState = {
      isAuthenticated: !!session,
      role: effectiveRole,
      realRole: role,
      permissions: effectivePermissions,
      isImpersonating: !!impersonation,
    };
    return canUsePermission(accessState, perm);
  }, [effectivePermissions, effectiveRole, impersonation, role, session]);

  return (
    <AuthContext.Provider value={{
      session,
      user: effectiveUser,
      profile: effectiveProfile,
      role: effectiveRole,
      permissions: effectivePermissions,
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
