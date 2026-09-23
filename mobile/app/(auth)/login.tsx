import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  ScrollView,
  Image,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { useAuth } from '../../contexts/AuthContext';
import { router } from 'expo-router';
import { isStaffApp } from '../../lib/appVariant';
import { supabase } from '../../lib/supabase';
import { useTheme } from '../../theme/ThemeContext';
import { spacing, radius } from '../../theme/tokens';

type StaffStep = 'main' | 'whatsapp' | 'whatsapp_otp' | 'email';
type WhatsAppSignInState = 'idle' | 'starting' | 'waiting' | 'expired' | 'failed';

// Brand palette — deliberately fixed to the web palette so the app matches the
// UniOs portal rather than the device theme.
const BRAND = '#0035C5';
const WHATSAPP = '#25D366';
const WHATSAPP_DARK = '#1DA851';
const GOOGLE_G = {
  blue: '#4285F4',
  green: '#34A853',
  yellow: '#FBBC05',
  red: '#EA4335',
};

async function readFunctionError(error: unknown, fallback: string): Promise<string> {
  let msg = error instanceof Error ? error.message : fallback;
  try {
    const ctx = (error as { context?: unknown })?.context as
      | { json?: () => Promise<unknown>; text?: () => Promise<string> }
      | undefined;
    if (ctx?.json) {
      const body = (await ctx.json()) as { error?: string } | null;
      if (body?.error) msg = body.error;
    } else if (ctx?.text) {
      const text = await ctx.text();
      try {
        msg = (JSON.parse(text) as { error?: string })?.error || msg;
      } catch {
        msg = text.slice(0, 200);
      }
    }
  } catch {
    /* keep fallback */
  }
  return msg;
}

export default function LoginScreen() {
  const {
    session,
    loading: authLoading,
    signInWithPassword,
    signInWithGoogle,
    sendWhatsAppOtp,
    verifyWhatsAppOtp,
  } = useAuth();
  const { colors } = useTheme();

  const [step, setStep] = useState<StaffStep>('main');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [otpSentAt, setOtpSentAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());

  // WhatsApp deep-link ("Continue with WhatsApp") sign-in.
  const [waState, setWaState] = useState<WhatsAppSignInState>('idle');
  const [waIntentId, setWaIntentId] = useState<string | null>(null);
  const [waClientSecret, setWaClientSecret] = useState<string | null>(null);
  const [waDeepLink, setWaDeepLink] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && session) router.replace('/');
  }, [session, authLoading]);

  useEffect(() => {
    if (step !== 'whatsapp_otp' || !otpSentAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [step, otpSentAt]);

  const elapsed = otpSentAt ? (now - otpSentAt) / 1000 : 0;
  const canResend = elapsed >= 60;
  const resendCountdown = Math.max(0, 60 - Math.floor(elapsed));

  const handleGoogle = async () => {
    setLoading(true);
    setError(null);
    const { error: err } = await signInWithGoogle();
    if (err) setError(err);
    setLoading(false);
  };

  const handleEmailLogin = async () => {
    if (!email.includes('@') || password.length < 6) {
      setError('Enter your work email and password');
      return;
    }
    setLoading(true);
    setError(null);
    const { error: err } = await signInWithPassword(email, password);
    if (err) setError(err);
    setLoading(false);
  };

  const handleSendOtp = async () => {
    const cleaned = phone.replace(/\D/g, '');
    if (cleaned.length < 10) {
      setError('Enter a valid 10-digit phone number');
      return;
    }
    setLoading(true);
    setError(null);
    const { error: err } = await sendWhatsAppOtp(cleaned);
    if (err) {
      setError(err);
      setLoading(false);
      return;
    }
    const ts = Date.now();
    setOtpSentAt(ts);
    setNow(ts);
    setOtp('');
    setStep('whatsapp_otp');
    setLoading(false);
  };

  const handleVerify = async () => {
    const cleaned = otp.replace(/\D/g, '');
    if (cleaned.length < 6) {
      setError('Enter the 6-digit OTP');
      return;
    }
    setLoading(true);
    setError(null);
    const { error: err } = await verifyWhatsAppOtp(phone.replace(/\D/g, ''), cleaned);
    if (err) {
      setError(err);
      setLoading(false);
      return;
    }
    setTimeout(() => setLoading(false), 3000);
  };

  const resetWhatsAppSignIn = useCallback(() => {
    setWaIntentId(null);
    setWaClientSecret(null);
    setWaDeepLink(null);
    setWaState('idle');
  }, []);

  const startWhatsAppSignIn = useCallback(async () => {
    resetWhatsAppSignIn();
    setError(null);
    setWaState('starting');
    try {
      const { data, error: fnError } = await supabase.functions.invoke('whatsapp-otp', {
        body: { action: 'start_sign_in' },
      });
      if (fnError) throw new Error(await readFunctionError(fnError, 'Could not start WhatsApp sign-in'));
      if (data?.error) throw new Error(data.error);

      setWaIntentId(data.intent_id);
      setWaClientSecret(data.client_secret);
      setWaDeepLink(data.deeplink_url);
      setWaState('waiting');
      if (data.deeplink_url) {
        await Linking.openURL(data.deeplink_url).catch(() => {});
      }
    } catch (err) {
      setWaState('failed');
      setError(err instanceof Error ? err.message : 'Could not start WhatsApp sign-in');
    }
  }, [resetWhatsAppSignIn]);

  useEffect(() => {
    if (waState !== 'waiting' || !waIntentId || !waClientSecret) return;
    let cancelled = false;

    const poll = async () => {
      try {
        const { data } = await supabase.functions.invoke('whatsapp-otp', {
          body: { action: 'status_sign_in', intent_id: waIntentId, client_secret: waClientSecret },
        });
        if (cancelled || !data) return;
        if (data.status === 'verified' && data.token?.access_token) {
          await supabase.auth.setSession({
            access_token: data.token.access_token,
            refresh_token: data.token.refresh_token,
          });
          return;
        }
        if (data.status === 'expired') {
          if (!cancelled) setWaState('expired');
          return;
        }
        if (data.status === 'failed') {
          if (!cancelled) {
            setWaState('failed');
            setError(data.error || 'No account is linked to that WhatsApp number.');
          }
        }
      } catch {
        /* transient — keep polling */
      }
    };

    poll();
    const id = setInterval(poll, 2500);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [waState, waIntentId, waClientSecret]);

  if (authLoading) {
    return (
      <SafeAreaView style={[styles.root, { backgroundColor: colors.canvas }]}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.inkSecondary} />
        </View>
      </SafeAreaView>
    );
  }

  // ── Family: WhatsApp-only (product rule unchanged) ────────────────────────
  if (!isStaffApp) {
    return (
      <SafeAreaView style={[styles.root, { backgroundColor: colors.canvas }]}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1 }}
        >
          <ScrollView
            contentContainerStyle={styles.scroll}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Brand colors={colors} title="NIMT Campus" tagline="For students and parents" />
            {error ? <ErrorBox colors={colors} text={error} /> : null}
            {step !== 'whatsapp_otp' ? (
              <WhatsAppPhoneForm
                colors={colors}
                phone={phone}
                setPhone={setPhone}
                setError={setError}
                loading={loading}
                onSend={handleSendOtp}
              />
            ) : (
              <WhatsAppOtpForm
                colors={colors}
                phone={phone}
                otp={otp}
                setOtp={setOtp}
                setError={setError}
                loading={loading}
                canResend={canResend}
                resendCountdown={resendCountdown}
                onVerify={handleVerify}
                onResend={handleSendOtp}
                onBack={() => {
                  setStep('main');
                  setOtp('');
                  setOtpSentAt(null);
                  setError(null);
                }}
              />
            )}
            <Terms colors={colors} />
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  // ── Staff: multi-method, matching the web portal ──────────────────────────
  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.canvas }]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Brand colors={colors} title="NIMT Staff" tagline="Sign in to UniOs" />

          {error ? <ErrorBox colors={colors} text={error} /> : null}

          {step === 'main' && (
            <View style={styles.stack}>
              {waState === 'waiting' ? (
                <View style={[styles.waCard, { borderColor: WHATSAPP }]}>
                  <ActivityIndicator color={WHATSAPP_DARK} />
                  <Text style={[styles.waCardTitle, { color: colors.ink }]}>Waiting for WhatsApp</Text>
                  <Text style={[styles.waCardText, { color: colors.inkSecondary }]}>
                    Send the prefilled message from WhatsApp to finish signing in.
                  </Text>
                  {waDeepLink ? (
                    <TouchableOpacity
                      style={[styles.outlineBtn, { borderColor: WHATSAPP }]}
                      onPress={() => Linking.openURL(waDeepLink).catch(() => {})}
                    >
                      <WhatsAppGlyph size={18} color={WHATSAPP_DARK} />
                      <Text style={[styles.outlineBtnText, { color: WHATSAPP_DARK }]}>
                        Open WhatsApp again
                      </Text>
                    </TouchableOpacity>
                  ) : null}
                  <TouchableOpacity onPress={startWhatsAppSignIn} style={styles.linkBtn}>
                    <Text style={[styles.linkText, { color: colors.inkSecondary }]}>
                      Try a different number
                    </Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <>
                  <TouchableOpacity
                    style={[styles.primaryBtn, { backgroundColor: WHATSAPP }]}
                    onPress={startWhatsAppSignIn}
                    disabled={waState === 'starting'}
                    activeOpacity={0.85}
                  >
                    {waState === 'starting' ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <>
                        <WhatsAppGlyph size={20} color="#fff" />
                        <Text style={styles.primaryBtnText}>Continue with WhatsApp</Text>
                      </>
                    )}
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.primaryBtn, { backgroundColor: BRAND }]}
                    onPress={() => {
                      setError(null);
                      resetWhatsAppSignIn();
                      setStep('whatsapp');
                    }}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.primaryBtnText}>Login with WhatsApp OTP</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.outlineBtn, { borderColor: colors.line, backgroundColor: colors.card }]}
                    onPress={() => {
                      setError(null);
                      resetWhatsAppSignIn();
                      setStep('email');
                    }}
                    activeOpacity={0.85}
                  >
                    <Text style={[styles.outlineBtnText, { color: colors.ink }]}>Login with email</Text>
                  </TouchableOpacity>

                  {(waState === 'expired' || waState === 'failed') && (
                    <TouchableOpacity onPress={startWhatsAppSignIn} style={styles.linkBtn}>
                      <Text style={[styles.linkText, { color: BRAND }]}>Try WhatsApp sign-in again</Text>
                    </TouchableOpacity>
                  )}

                  <View style={styles.orRow}>
                    <View style={[styles.orLine, { backgroundColor: colors.line }]} />
                    <Text style={[styles.orText, { color: colors.inkMuted }]}>or</Text>
                    <View style={[styles.orLine, { backgroundColor: colors.line }]} />
                  </View>

                  <TouchableOpacity
                    style={[styles.outlineBtn, { borderColor: colors.line, backgroundColor: colors.card }]}
                    onPress={handleGoogle}
                    disabled={loading}
                    activeOpacity={0.85}
                  >
                    <GoogleGlyph size={20} />
                    <Text style={[styles.outlineBtnText, { color: colors.ink }]}>Continue with Google</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          )}

          {step === 'whatsapp' && (
            <View style={styles.stack}>
              <WhatsAppPhoneForm
                colors={colors}
                phone={phone}
                setPhone={setPhone}
                setError={setError}
                loading={loading}
                onSend={handleSendOtp}
              />
              <TouchableOpacity
                onPress={() => {
                  setStep('main');
                  setError(null);
                }}
                style={styles.linkBtn}
              >
                <Text style={[styles.linkText, { color: colors.inkSecondary }]}>Back</Text>
              </TouchableOpacity>
            </View>
          )}

          {step === 'whatsapp_otp' && (
            <WhatsAppOtpForm
              colors={colors}
              phone={phone}
              otp={otp}
              setOtp={setOtp}
              setError={setError}
              loading={loading}
              canResend={canResend}
              resendCountdown={resendCountdown}
              onVerify={handleVerify}
              onResend={handleSendOtp}
              onBack={() => {
                setStep('whatsapp');
                setOtp('');
                setOtpSentAt(null);
                setError(null);
              }}
            />
          )}

          {step === 'email' && (
            <View style={styles.stack}>
              <Text style={[styles.label, { color: colors.ink }]}>Work email</Text>
              <TextInput
                style={[
                  styles.input,
                  { backgroundColor: colors.card, borderColor: colors.line, color: colors.ink },
                ]}
                placeholder="you@nimt.ac.in"
                placeholderTextColor={colors.inkMuted}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                value={email}
                onChangeText={(t) => {
                  setEmail(t);
                  setError(null);
                }}
              />
              <Text style={[styles.label, { color: colors.ink }]}>Password</Text>
              <TextInput
                style={[
                  styles.input,
                  { backgroundColor: colors.card, borderColor: colors.line, color: colors.ink },
                ]}
                placeholder="••••••••"
                placeholderTextColor={colors.inkMuted}
                secureTextEntry
                value={password}
                onChangeText={(t) => {
                  setPassword(t);
                  setError(null);
                }}
              />
              <TouchableOpacity
                style={[styles.primaryBtn, { backgroundColor: BRAND }, (!email || !password) && styles.disabled]}
                onPress={handleEmailLogin}
                disabled={loading || !email || !password}
                activeOpacity={0.85}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.primaryBtnText}>Sign in</Text>
                )}
              </TouchableOpacity>
              <Text style={[styles.hint, { color: colors.inkMuted }]}>
                Same email and password as the UniOs web portal.
              </Text>
              <TouchableOpacity
                onPress={() => {
                  setStep('main');
                  setError(null);
                }}
                style={styles.linkBtn}
              >
                <Text style={[styles.linkText, { color: colors.inkSecondary }]}>Back</Text>
              </TouchableOpacity>
            </View>
          )}

          <Terms colors={colors} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ── Pieces ──────────────────────────────────────────────────────────────────

function Brand({
  colors,
  title,
  tagline,
}: {
  colors: { ink: string; inkSecondary: string };
  title: string;
  tagline: string;
}) {
  return (
    <View style={styles.brand}>
      {/* White tile so the brand mark reads on both the light and dark canvas. */}
      <View style={styles.logoTile}>
        <Image
          source={require('../../assets/images/unios-logo.png')}
          style={styles.logoImg}
          resizeMode="contain"
        />
      </View>
      <Text style={[styles.title, { color: colors.ink }]}>{title}</Text>
      <Text style={[styles.tagline, { color: colors.inkSecondary }]}>{tagline}</Text>
    </View>
  );
}

function WhatsAppGlyph({ size = 20, color = '#fff' }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <Path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </Svg>
  );
}

function GoogleGlyph({ size = 20 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill={GOOGLE_G.blue} />
      <Path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill={GOOGLE_G.green} />
      <Path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill={GOOGLE_G.yellow} />
      <Path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill={GOOGLE_G.red} />
    </Svg>
  );
}

function ErrorBox({ colors, text }: { colors: { danger: string; tint: { red: { bg: string } } }; text: string }) {
  return (
    <View style={[styles.errorBox, { backgroundColor: colors.tint.red.bg }]}>
      <Text style={[styles.errorText, { color: colors.danger }]}>{text}</Text>
    </View>
  );
}

function PrimaryButton({
  colors,
  label,
  loading,
  disabled,
  onPress,
}: {
  colors: { pillBg: string; pillFg: string };
  label: string;
  loading?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[
        styles.primaryBtn,
        { backgroundColor: colors.pillBg },
        (loading || disabled) && styles.disabled,
      ]}
      onPress={onPress}
      disabled={loading || disabled}
      activeOpacity={0.85}
    >
      {loading ? (
        <ActivityIndicator color={colors.pillFg} />
      ) : (
        <Text style={[styles.primaryBtnText, { color: colors.pillFg }]}>{label}</Text>
      )}
    </TouchableOpacity>
  );
}

function WhatsAppPhoneForm({
  colors,
  phone,
  setPhone,
  setError,
  loading,
  onSend,
}: {
  colors: any;
  phone: string;
  setPhone: (t: string) => void;
  setError: (t: string | null) => void;
  loading: boolean;
  onSend: () => void;
}) {
  return (
    <View style={styles.stack}>
      <Text style={[styles.label, { color: colors.ink }]}>WhatsApp number</Text>
      <View style={styles.phoneRow}>
        <View style={[styles.cc, { backgroundColor: colors.card, borderColor: colors.line }]}>
          <Text style={{ color: colors.inkSecondary, fontSize: 16 }}>+91</Text>
        </View>
        <TextInput
          style={[
            styles.input,
            styles.phoneInput,
            { backgroundColor: colors.card, borderColor: colors.line, color: colors.ink },
          ]}
          placeholder="9876543210"
          placeholderTextColor={colors.inkMuted}
          keyboardType="phone-pad"
          maxLength={10}
          value={phone}
          onChangeText={(t) => {
            setPhone(t.replace(/\D/g, ''));
            setError(null);
          }}
        />
      </View>
      <PrimaryButton
        colors={{ pillBg: BRAND, pillFg: '#fff' }}
        label="Send code on WhatsApp"
        loading={loading}
        disabled={phone.replace(/\D/g, '').length < 10}
        onPress={onSend}
      />
    </View>
  );
}

function WhatsAppOtpForm({
  colors,
  phone,
  otp,
  setOtp,
  setError,
  loading,
  canResend,
  resendCountdown,
  onVerify,
  onResend,
  onBack,
}: {
  colors: any;
  phone: string;
  otp: string;
  setOtp: (t: string) => void;
  setError: (t: string | null) => void;
  loading: boolean;
  canResend: boolean;
  resendCountdown: number;
  onVerify: () => void;
  onResend: () => void;
  onBack: () => void;
}) {
  return (
    <View style={styles.stack}>
      <View style={[styles.otpBanner, { backgroundColor: colors.tint.green.bg }]}>
        <Text style={{ color: colors.tint.green.fg, textAlign: 'center', fontSize: 14, lineHeight: 20 }}>
          Code sent to +91 {phone.slice(0, 2)}****{phone.slice(-2)} on WhatsApp
        </Text>
      </View>
      <Text style={[styles.label, { color: colors.ink }]}>Enter 6-digit code</Text>
      <TextInput
        style={[
          styles.otpInput,
          { backgroundColor: colors.card, borderColor: colors.line, color: colors.ink },
        ]}
        placeholder="000000"
        placeholderTextColor={colors.inkMuted}
        keyboardType="number-pad"
        maxLength={6}
        value={otp}
        onChangeText={(t) => {
          setOtp(t.replace(/\D/g, ''));
          setError(null);
        }}
        autoFocus
      />
      <PrimaryButton
        colors={{ pillBg: BRAND, pillFg: '#fff' }}
        label="Verify & sign in"
        loading={loading}
        disabled={otp.replace(/\D/g, '').length < 6}
        onPress={onVerify}
      />
      <TouchableOpacity
        style={[styles.outlineBtn, { borderColor: colors.line, backgroundColor: colors.card }]}
        onPress={() => {
          if (canResend && !loading) onResend();
        }}
        disabled={!canResend || loading}
        activeOpacity={0.85}
      >
        <Text style={[styles.outlineBtnText, { color: colors.ink }]}>
          {canResend ? 'Resend code' : `Resend in ${resendCountdown}s`}
        </Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={onBack} style={styles.linkBtn}>
        <Text style={[styles.linkText, { color: colors.inkSecondary }]}>Use a different number</Text>
      </TouchableOpacity>
    </View>
  );
}

function Terms({ colors }: { colors: { inkMuted: string } }) {
  return (
    <Text style={[styles.terms, { color: colors.inkMuted }]}>
      By signing in, you agree to our Terms of Service and Privacy Policy.
    </Text>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xxl,
  },
  brand: { alignItems: 'center', marginBottom: spacing.xxl },
  logoTile: {
    width: 92,
    height: 92,
    borderRadius: radius.xl,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  logoImg: { width: 68, height: 68 },
  title: { fontSize: 28, fontWeight: '700', letterSpacing: -0.5 },
  tagline: { fontSize: 15, marginTop: 6 },
  stack: { gap: spacing.md },
  label: { fontSize: 14, fontWeight: '600' },
  hint: { fontSize: 13, lineHeight: 18 },
  input: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    height: 52,
    fontSize: 16,
  },
  phoneRow: { flexDirection: 'row', gap: spacing.sm },
  cc: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    height: 52,
    justifyContent: 'center',
  },
  phoneInput: { flex: 1, letterSpacing: 1 },
  otpInput: {
    borderWidth: 1,
    borderRadius: radius.md,
    height: 56,
    fontSize: 24,
    textAlign: 'center',
    letterSpacing: 10,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  otpBanner: {
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  waCard: {
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.lg,
    alignItems: 'center',
    gap: spacing.sm,
  },
  waCardTitle: { fontSize: 16, fontWeight: '700' },
  waCardText: { fontSize: 13, textAlign: 'center', lineHeight: 18 },
  primaryBtn: {
    height: 52,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  outlineBtn: {
    height: 52,
    borderRadius: radius.full,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  outlineBtnText: { fontSize: 16, fontWeight: '600' },
  disabled: { opacity: 0.45 },
  orRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginVertical: spacing.xs },
  orLine: { flex: 1, height: StyleSheet.hairlineWidth },
  orText: { fontSize: 13, fontWeight: '500' },
  linkBtn: { alignItems: 'center', paddingVertical: spacing.sm },
  linkText: { fontSize: 14, fontWeight: '500' },
  errorBox: {
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.md,
  },
  errorText: { fontSize: 14, lineHeight: 20 },
  terms: { fontSize: 12, textAlign: 'center', marginTop: spacing.xxl, lineHeight: 18 },
});
