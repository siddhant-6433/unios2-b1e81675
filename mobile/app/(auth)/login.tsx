import { useState, useEffect } from 'react';
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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../contexts/AuthContext';
import { router } from 'expo-router';
import { isStaffApp } from '../../lib/appVariant';
import { useTheme } from '../../theme/ThemeContext';
import { spacing, radius } from '../../theme/tokens';

type StaffStep = 'main' | 'whatsapp' | 'whatsapp_otp' | 'email';

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

  if (authLoading) {
    return (
      <SafeAreaView style={[styles.root, { backgroundColor: colors.canvas }]}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.inkSecondary} />
        </View>
      </SafeAreaView>
    );
  }

  // ── Family: WhatsApp-only (unchanged product rule) ────────────────────────
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

  // ── Staff: sleek multi-method ─────────────────────────────────────────────
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
          <Brand colors={colors} title="NIMT Staff" tagline="Campus operations, secured." />

          {error ? <ErrorBox colors={colors} text={error} /> : null}

          {step === 'main' && (
            <View style={styles.stack}>
              <PrimaryButton
                colors={colors}
                label="Continue with Google"
                loading={loading}
                onPress={handleGoogle}
              />

              <View style={styles.orRow}>
                <View style={[styles.orLine, { backgroundColor: colors.line }]} />
                <Text style={[styles.orText, { color: colors.inkMuted }]}>or</Text>
                <View style={[styles.orLine, { backgroundColor: colors.line }]} />
              </View>

              <SecondaryButton
                colors={colors}
                label="Continue with WhatsApp"
                onPress={() => {
                  setError(null);
                  setStep('whatsapp');
                }}
              />

              <TouchableOpacity
                onPress={() => {
                  setError(null);
                  setStep('email');
                }}
                style={styles.linkBtn}
                hitSlop={12}
              >
                <Text style={[styles.linkText, { color: colors.accent }]}>
                  Sign in with email instead
                </Text>
              </TouchableOpacity>
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
              <PrimaryButton
                colors={colors}
                label="Sign in"
                loading={loading}
                disabled={!email || !password}
                onPress={handleEmailLogin}
              />
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
  colors: { accent: string; ink: string; inkSecondary: string };
  title: string;
  tagline: string;
}) {
  return (
    <View style={styles.brand}>
      <View style={[styles.logo, { backgroundColor: colors.accent }]}>
        <Text style={styles.logoText}>N</Text>
      </View>
      <Text style={[styles.title, { color: colors.ink }]}>{title}</Text>
      <Text style={[styles.tagline, { color: colors.inkSecondary }]}>{tagline}</Text>
    </View>
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

function SecondaryButton({
  colors,
  label,
  onPress,
}: {
  colors: { card: string; line: string; ink: string };
  label: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.secondaryBtn, { backgroundColor: colors.card, borderColor: colors.line }]}
      onPress={onPress}
      activeOpacity={0.85}
    >
      <Text style={[styles.secondaryBtnText, { color: colors.ink }]}>{label}</Text>
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
        colors={colors}
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
      <View style={[styles.otpBanner, { backgroundColor: colors.accentSoft }]}>
        <Text style={{ color: colors.accent, textAlign: 'center', fontSize: 14, lineHeight: 20 }}>
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
        colors={colors}
        label="Verify & sign in"
        loading={loading}
        disabled={otp.replace(/\D/g, '').length < 6}
        onPress={onVerify}
      />
      <SecondaryButton
        colors={colors}
        label={canResend ? 'Resend code' : `Resend in ${resendCountdown}s`}
        onPress={() => {
          if (canResend && !loading) onResend();
        }}
      />
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
  logo: {
    width: 64,
    height: 64,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  logoText: { color: '#fff', fontSize: 32, fontWeight: '800' },
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
  primaryBtn: {
    height: 52,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: { fontSize: 16, fontWeight: '600' },
  secondaryBtn: {
    height: 52,
    borderRadius: radius.full,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryBtnText: { fontSize: 16, fontWeight: '600' },
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
