import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

type AppRole = Database["public"]["Enums"]["app_role"];

interface Profile {
  display_name: string | null;
  phone: string | null;
  avatar_url: string | null;
  campus: string | null;
  department: string | null;
  institution: string | null;
}

interface AuthContextType {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  role: AppRole | null;
  loading: boolean;
  roleLoaded: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  profile: null,
  role: null,
  loading: true,
  roleLoaded: false,
  signOut: async () => {},
});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [role, setRole] = useState<AppRole | null>(null);
  const [loading, setLoading] = useState(true);
  const [roleLoaded, setRoleLoaded] = useState(false);

  const fetchUserData = async (userId: string, authUser?: User) => {
    const [profileRes, roleRes] = await Promise.all([
      supabase.from("profiles").select("display_name, phone, avatar_url, campus, department, institution").eq("user_id", userId).single(),
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
        .select("display_name, phone, avatar_url, campus, department, institution")
        .single();
      if (upserted) setProfile(upserted);
    }

    if (roleRes.data) setRole(roleRes.data as AppRole);
    setRoleLoaded(true);
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

  const signOut = async () => {
    await supabase.auth.signOut();
    setSession(null);
    setProfile(null);
    setRole(null);
  };

  return (
    <AuthContext.Provider value={{ session, user: session?.user ?? null, profile, role, loading, roleLoaded, signOut }}>
      {children}
    </AuthContext.Provider>
  );
};
