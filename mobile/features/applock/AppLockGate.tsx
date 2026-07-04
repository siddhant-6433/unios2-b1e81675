import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AppState, StyleSheet, Text, View, type AppStateStatus } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { Fingerprint } from 'lucide-react-native';
import { useTheme } from '../../theme/ThemeContext';
import { Button } from '../../components/ui/Button';

const APPLOCK_KEY = 'unios-applock-enabled';
const BACKGROUND_LOCK_MS = 5 * 60 * 1000;

interface AppLockContextType {
  isEnabled: boolean;
  isSupported: boolean;
  setEnabled: (enabled: boolean) => Promise<void>;
  /** Step-up prompt for sensitive actions (approvals, payments). Resolves true when authenticated. */
  requireBiometric: (reason: string) => Promise<boolean>;
}

const AppLockContext = createContext<AppLockContextType | null>(null);

async function authenticate(reason: string): Promise<boolean> {
  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: reason,
    cancelLabel: 'Cancel',
  });
  return result.success;
}

export function AppLockGate({ children }: { children: ReactNode }) {
  const { colors, spacing, type } = useTheme();
  const [isEnabled, setIsEnabled] = useState(false);
  const [isSupported, setIsSupported] = useState(false);
  const [isLocked, setIsLocked] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const backgroundedAt = useRef<number | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [hasHardware, enrolled, stored] = await Promise.all([
          LocalAuthentication.hasHardwareAsync(),
          LocalAuthentication.isEnrolledAsync(),
          SecureStore.getItemAsync(APPLOCK_KEY),
        ]);
        const supported = hasHardware && enrolled;
        setIsSupported(supported);
        const enabled = supported && stored === 'true';
        setIsEnabled(enabled);
        setIsLocked(enabled);
      } catch {
        setIsSupported(false);
      }
      setIsReady(true);
    })();
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (!isEnabled) return;
      if (state === 'background') {
        backgroundedAt.current = Date.now();
      } else if (state === 'active' && backgroundedAt.current) {
        if (Date.now() - backgroundedAt.current > BACKGROUND_LOCK_MS) setIsLocked(true);
        backgroundedAt.current = null;
      }
    });
    return () => sub.remove();
  }, [isEnabled]);

  const unlock = useCallback(async () => {
    const ok = await authenticate('Unlock NIMT');
    if (ok) setIsLocked(false);
  }, []);

  useEffect(() => {
    if (isReady && isLocked) unlock();
  }, [isReady, isLocked, unlock]);

  const setEnabled = useCallback(async (enabled: boolean) => {
    if (enabled) {
      const ok = await authenticate('Confirm to enable app lock');
      if (!ok) return;
    }
    await SecureStore.setItemAsync(APPLOCK_KEY, enabled ? 'true' : 'false');
    setIsEnabled(enabled);
  }, []);

  const requireBiometric = useCallback(
    async (reason: string) => {
      if (!isSupported || !isEnabled) return true;
      return authenticate(reason);
    },
    [isSupported, isEnabled],
  );

  return (
    <AppLockContext.Provider value={{ isEnabled, isSupported, setEnabled, requireBiometric }}>
      {children}
      {isReady && isLocked && (
        <View style={[StyleSheet.absoluteFill, styles.lock, { backgroundColor: colors.canvas }]}>
          <View style={[styles.iconWrap, { backgroundColor: colors.accentSoft }]}>
            <Fingerprint size={32} color={colors.accent} />
          </View>
          <Text style={[type.h2, { color: colors.ink, marginTop: spacing.md }]}>Locked</Text>
          <Text style={[type.caption, { color: colors.inkSecondary, marginTop: spacing.xxs }]}>
            Unlock with Face ID or fingerprint
          </Text>
          <Button label="Unlock" onPress={unlock} style={{ marginTop: spacing.xl, minWidth: 160 }} />
        </View>
      )}
    </AppLockContext.Provider>
  );
}

export function useAppLock(): AppLockContextType {
  const ctx = useContext(AppLockContext);
  if (!ctx) throw new Error('useAppLock must be used within AppLockGate');
  return ctx;
}

const styles = StyleSheet.create({
  lock: { alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  iconWrap: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center' },
});
