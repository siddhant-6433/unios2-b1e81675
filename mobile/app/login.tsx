import { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator, SafeAreaView,
  ScrollView, Alert, Dimensions,
} from 'react-native';
import { useAuth } from '../contexts/AuthContext';
import { router } from 'expo-router';
import { colors, spacing, radius, typography } from '../constants/Colors';

type LoginMethod = 'google' | 'whatsapp';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export default function LoginScreen() {
  const { session, loading: authLoading, signInWithGoogle, sendWhatsAppOtp, verifyWhatsAppOtp } = useAuth();
  const [method, setMethod] = useState<LoginMethod>('whatsapp');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [otpSentAt, setOtpSentAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());

  // Redirect if already signed in
  useEffect(() => {
    if (!authLoading && session) {
      console.log('[Login] Session detected, navigating to tabs');
      router.replace('/(tabs)');
    }
  }, [session, authLoading]);

  // Countdown timer for OTP resend
  useEffect(() => {
    if (!otpSent || !otpSentAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [otpSent, otpSentAt]);

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

    // Only show OTP screen if send succeeded
    const ts = Date.now();
    setOtpSentAt(ts);
    setNow(ts);
    setOtpSent(true);
    setOtp('');
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

    // Don't manually navigate — the useEffect watching `session` will handle it
    // once onAuthStateChange fires from setSession in the auth context
    // But add a fallback timeout in case the state update is slow
    setTimeout(() => {
      setLoading(false);
    }, 3000);
  };

  const handleResend = async () => {
    setError(null);
    await handleSendOtp();
  };

  const resetOtp = () => {
    setOtpSent(false);
    setOtp('');
    setOtpSentAt(null);
    setError(null);
  };

  const switchMethod = (m: LoginMethod) => {
    setMethod(m);
    resetOtp();
    setPhone('');
  };

  // If auth is still loading, show spinner
  if (authLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Branding */}
          <View style={styles.brandSection}>
            <View style={styles.logoBox}>
              <Text style={styles.logoText}>U</Text>
            </View>
            <Text style={styles.title}>UniOs</Text>
            <Text style={styles.subtitle}>NIMT University</Text>
          </View>

          {/* Method selector */}
          <View style={styles.methodSelector}>
            <TouchableOpacity
              style={[styles.methodTab, method === 'google' && styles.methodTabActive]}
              onPress={() => switchMethod('google')}
              activeOpacity={0.7}
            >
              <Text style={[styles.methodTabText, method === 'google' && styles.methodTabTextActive]}>
                Google
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.methodTab, method === 'whatsapp' && styles.methodTabActive]}
              onPress={() => switchMethod('whatsapp')}
              activeOpacity={0.7}
            >
              <Text style={[styles.methodTabText, method === 'whatsapp' && styles.methodTabTextActive]}>
                WhatsApp
              </Text>
            </TouchableOpacity>
          </View>

          {/* Error */}
          {error && (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          {/* Google */}
          {method === 'google' && (
            <View style={styles.formSection}>
              <TouchableOpacity
                style={[styles.button, loading && styles.buttonDisabled]}
                onPress={handleGoogle}
                disabled={loading}
                activeOpacity={0.8}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.buttonText}>Continue with Google</Text>
                )}
              </TouchableOpacity>
              <Text style={styles.hint}>
                Sign in with your Google account linked to NIMT.
              </Text>
            </View>
          )}

          {/* WhatsApp — Phone Entry */}
          {method === 'whatsapp' && !otpSent && (
            <View style={styles.formSection}>
              <Text style={styles.label}>WhatsApp Number</Text>
              <View style={styles.phoneRow}>
                <View style={styles.countryCode}>
                  <Text style={styles.countryCodeText}>+91</Text>
                </View>
                <TextInput
                  style={styles.phoneInput}
                  placeholder="9876543210"
                  placeholderTextColor={colors.textMuted}
                  keyboardType="phone-pad"
                  maxLength={10}
                  value={phone}
                  onChangeText={(t) => { setPhone(t.replace(/\D/g, '')); setError(null); }}
                  autoFocus
                />
              </View>
              <Text style={styles.hint}>
                OTP will be sent to this number via WhatsApp.
              </Text>
              <TouchableOpacity
                style={[styles.button, (loading || phone.replace(/\D/g, '').length < 10) && styles.buttonDisabled]}
                onPress={handleSendOtp}
                disabled={loading || phone.replace(/\D/g, '').length < 10}
                activeOpacity={0.8}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.buttonText}>Send WhatsApp OTP</Text>
                )}
              </TouchableOpacity>
            </View>
          )}

          {/* WhatsApp — OTP Verify */}
          {method === 'whatsapp' && otpSent && (
            <View style={styles.formSection}>
              <View style={styles.otpInfoBox}>
                <Text style={styles.otpInfoText}>
                  OTP sent to +91 {phone.slice(0, 2)}****{phone.slice(-2)} via WhatsApp
                </Text>
              </View>

              <Text style={styles.label}>Enter 6-digit OTP</Text>
              <TextInput
                style={styles.otpInput}
                placeholder="0  0  0  0  0  0"
                placeholderTextColor={colors.textMuted}
                keyboardType="number-pad"
                maxLength={6}
                value={otp}
                onChangeText={(t) => { setOtp(t.replace(/\D/g, '')); setError(null); }}
                autoFocus
              />

              <TouchableOpacity
                style={[styles.button, (loading || otp.replace(/\D/g, '').length < 6) && styles.buttonDisabled]}
                onPress={handleVerify}
                disabled={loading || otp.replace(/\D/g, '').length < 6}
                activeOpacity={0.8}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.buttonText}>Verify & Sign In</Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.secondaryButton, (!canResend || loading) && styles.buttonDisabled]}
                onPress={handleResend}
                disabled={loading || !canResend}
                activeOpacity={0.7}
              >
                <Text style={styles.secondaryButtonText}>
                  {canResend ? 'Resend OTP' : `Resend in ${resendCountdown}s`}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity onPress={resetOtp} style={styles.linkButton}>
                <Text style={styles.linkText}>Use a different number</Text>
              </TouchableOpacity>
            </View>
          )}

          <Text style={styles.terms}>
            By signing in, you agree to our Terms of Service and Privacy Policy.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 40,
  },

  // Branding
  brandSection: {
    alignItems: 'center',
    marginBottom: 36,
  },
  logoBox: {
    width: 64,
    height: 64,
    borderRadius: 16,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  logoText: {
    color: '#fff',
    fontSize: 32,
    fontWeight: '800',
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 15,
    color: colors.textSecondary,
    marginTop: 4,
  },

  // Method selector
  methodSelector: {
    flexDirection: 'row',
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 4,
    marginBottom: 20,
  },
  methodTab: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  methodTabActive: {
    backgroundColor: colors.primary,
  },
  methodTabText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  methodTabTextActive: {
    color: '#fff',
  },

  // Error
  errorBox: {
    backgroundColor: colors.destructiveLight,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 16,
  },
  errorText: {
    fontSize: 14,
    color: colors.destructive,
    lineHeight: 20,
  },

  // Form
  formSection: {
    gap: 16,
  },
  label: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  hint: {
    fontSize: 13,
    color: colors.textMuted,
    lineHeight: 18,
  },
  phoneRow: {
    flexDirection: 'row',
    gap: 10,
  },
  countryCode: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 16,
    justifyContent: 'center',
    height: 52,
  },
  countryCodeText: {
    fontSize: 16,
    color: colors.textSecondary,
  },
  phoneInput: {
    flex: 1,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 16,
    height: 52,
    fontSize: 18,
    color: colors.text,
    letterSpacing: 1,
  },
  otpInput: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 16,
    height: 56,
    fontSize: 24,
    color: colors.text,
    textAlign: 'center',
    letterSpacing: 12,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },

  // Buttons
  button: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  linkButton: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  linkText: {
    fontSize: 14,
    color: colors.primary,
    fontWeight: '500',
  },

  // OTP info
  otpInfoBox: {
    backgroundColor: colors.primaryLight,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    alignItems: 'center',
  },
  otpInfoText: {
    fontSize: 14,
    color: colors.primary,
    textAlign: 'center',
    lineHeight: 20,
  },

  terms: {
    fontSize: 12,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: 32,
    lineHeight: 18,
  },
});
