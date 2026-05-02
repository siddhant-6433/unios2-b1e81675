import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { Platform, Alert } from 'react-native';
import { supabase } from '../lib/supabase';
import * as WebBrowser from 'expo-web-browser';
import { makeRedirectUri } from 'expo-auth-session';
import type { Session, User } from '@supabase/supabase-js';

if (Platform.OS === 'web') {
  WebBrowser.maybeCompleteAuthSession();
}

export type AppRole =
  | 'super_admin' | 'campus_admin' | 'principal' | 'admission_head'
  | 'counsellor' | 'accountant' | 'faculty' | 'teacher'
  | 'data_entry' | 'office_admin' | 'office_assistant' | 'hostel_warden'
  | 'student' | 'parent';

interface Profile {
  id: string;
  display_name: string;
  phone: string;
  role: AppRole;
  campus_id: string | null;
  employee_id: string | null;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  role: AppRole | null;
  loading: boolean;
  signInWithGoogle: () => Promise<{ error: string | null }>;
  sendWhatsAppOtp: (phone: string) => Promise<{ error: string | null }>;
  verifyWhatsAppOtp: (phone: string, otp: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [role, setRole] = useState<AppRole | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      console.log('[Auth] Initial session:', session ? 'exists' : 'null');
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) fetchProfile(session.user.id);
      else setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      console.log('[Auth] State change:', event, session ? 'session exists' : 'no session');
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        // Use setTimeout to avoid Supabase client deadlock (same as web)
        setTimeout(() => fetchProfile(session.user.id), 0);
      } else {
        setProfile(null);
        setRole(null);
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const fetchProfile = async (userId: string) => {
    console.log('[Auth] Fetching profile for:', userId);
    try {
      const [profileRes, roleRes] = await Promise.all([
        supabase.from('profiles')
          .select('id, display_name, phone, avatar_url, campus, department, institution, employee_id')
          .eq('user_id', userId)
          .single(),
        supabase.rpc('get_user_role', { _user_id: userId }),
      ]);

      console.log('[Auth] Profile result:', profileRes.data ? 'found' : 'not found', 'error:', profileRes.error?.message);
      console.log('[Auth] Role result:', roleRes.data, 'error:', roleRes.error?.message);

      if (profileRes.data) {
        setProfile({
          id: profileRes.data.id,
          display_name: profileRes.data.display_name || '',
          phone: profileRes.data.phone || '',
          role: (roleRes.data as AppRole) || 'student',
          campus_id: profileRes.data.campus || null,
          employee_id: (profileRes.data as any).employee_id || null,
        });
      }
      if (roleRes.data) setRole(roleRes.data as AppRole);
    } catch (err) {
      console.error('[Auth] fetchProfile error:', err);
    }
    setLoading(false);
  };

  // ── Google OAuth ──────────────────────────────────────────────────────────
  const signInWithGoogle = async (): Promise<{ error: string | null }> => {
    try {
      const redirectUrl = makeRedirectUri({ scheme: 'unios' });
      console.log('[Auth] Google redirect URL:', redirectUrl);

      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: redirectUrl,
          skipBrowserRedirect: true,
        },
      });

      if (error) return { error: error.message };
      if (!data.url) return { error: 'No auth URL returned' };

      const result = await WebBrowser.openAuthSessionAsync(data.url, redirectUrl);
      console.log('[Auth] Browser result type:', result.type);

      if (result.type === 'success' && result.url) {
        const url = new URL(result.url);
        const hashParams = new URLSearchParams(url.hash.substring(1));
        const queryParams = new URLSearchParams(url.search);
        const accessToken = hashParams.get('access_token') || queryParams.get('access_token');
        const refreshToken = hashParams.get('refresh_token') || queryParams.get('refresh_token');

        if (accessToken && refreshToken) {
          const { error: sessionError } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (sessionError) return { error: sessionError.message };
          // onAuthStateChange will fire and update session
        } else {
          return { error: 'No tokens received. Add this redirect URL to Supabase: ' + redirectUrl };
        }
      } else if (result.type === 'cancel' || result.type === 'dismiss') {
        return { error: null };
      }

      return { error: null };
    } catch (err: any) {
      return { error: err.message || 'Google sign-in failed' };
    }
  };

  // ── WhatsApp OTP ──────────────────────────────────────────────────────────
  const sendWhatsAppOtp = async (phone: string): Promise<{ error: string | null }> => {
    try {
      // Edge function expects phone with country code prefix
      const normalizedPhone = phone.startsWith('+') ? phone : `+91${phone.replace(/\D/g, '')}`;
      console.log('[Auth] Sending WhatsApp OTP to:', normalizedPhone);

      const { data, error } = await supabase.functions.invoke('whatsapp-otp', {
        body: { action: 'send', phone: normalizedPhone },
      });

      console.log('[Auth] Send OTP response:', JSON.stringify({ data, error: error?.message }));

      if (error) {
        let msg = error.message || 'Failed to send OTP';
        // Try to parse error body from edge function
        try {
          const ctx = (error as any)?.context;
          if (ctx) {
            if (typeof ctx.json === 'function') {
              const body = await ctx.json();
              msg = body?.error || msg;
            } else if (typeof ctx.text === 'function') {
              const text = await ctx.text();
              try { msg = JSON.parse(text)?.error || msg; } catch { msg = text.slice(0, 200); }
            }
          }
        } catch {}
        return { error: msg };
      }
      if (data?.error) return { error: data.error };
      return { error: null };
    } catch (err: any) {
      console.error('[Auth] sendWhatsAppOtp error:', err);
      return { error: err.message || 'Failed to send OTP' };
    }
  };

  const verifyWhatsAppOtp = async (phone: string, otp: string): Promise<{ error: string | null }> => {
    try {
      const normalizedPhone = phone.startsWith('+') ? phone : `+91${phone.replace(/\D/g, '')}`;
      console.log('[Auth] Verifying OTP for:', normalizedPhone);

      const { data, error } = await supabase.functions.invoke('whatsapp-otp', {
        body: { action: 'verify', phone: normalizedPhone, otp: otp.trim() },
      });

      console.log('[Auth] Verify OTP response:', JSON.stringify({
        data: data ? { success: data.success, verified: data.verified, hasToken: !!data.token } : null,
        error: error?.message,
      }));

      if (error) {
        let msg = error.message || 'Verification failed';
        try {
          const ctx = (error as any)?.context;
          if (ctx) {
            if (typeof ctx.json === 'function') {
              const body = await ctx.json();
              msg = body?.error || msg;
            } else if (typeof ctx.text === 'function') {
              const text = await ctx.text();
              try { msg = JSON.parse(text)?.error || msg; } catch { msg = text.slice(0, 200); }
            }
          }
        } catch {}
        return { error: msg };
      }

      if (data?.error) return { error: data.error };

      // Edge function returns { success, verified, token: { access_token, refresh_token } }
      if (data?.token?.access_token && data?.token?.refresh_token) {
        console.log('[Auth] Setting session from WhatsApp OTP token');
        const { error: sessionError } = await supabase.auth.setSession({
          access_token: data.token.access_token,
          refresh_token: data.token.refresh_token,
        });
        if (sessionError) {
          console.error('[Auth] setSession error:', sessionError.message);
          return { error: sessionError.message };
        }
        console.log('[Auth] Session set successfully');
        // onAuthStateChange will fire and update state
        return { error: null };
      }

      // If no token returned (applicant flow — verified but no staff profile)
      if (data?.verified) {
        return { error: 'Phone verified but no staff account found. Contact your administrator.' };
      }

      return { error: 'Unexpected response from server' };
    } catch (err: any) {
      console.error('[Auth] verifyWhatsAppOtp error:', err);
      return { error: err.message || 'Verification failed' };
    }
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setProfile(null);
    setRole(null);
  };

  return (
    <AuthContext.Provider value={{
      user, session, profile, role, loading,
      signInWithGoogle, sendWhatsAppOtp, verifyWhatsAppOtp, signOut,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
