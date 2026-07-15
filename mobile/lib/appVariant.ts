import Constants from 'expo-constants';

export type AppVariant = 'staff' | 'family';

/**
 * Resolve which store app this binary is.
 *
 * Prefer EXPO_PUBLIC_APP_VARIANT (inlined by Metro from env at bundle time) so
 * web/dev never race Constants.expoConfig being null at module init. Fall back
 * to app.config.ts `extra.appVariant` (set from APP_VARIANT at config time).
 */
function resolveVariant(): AppVariant {
  const fromPublicEnv = process.env.EXPO_PUBLIC_APP_VARIANT;
  if (fromPublicEnv === 'staff' || fromPublicEnv === 'family') return fromPublicEnv;

  // app.config.ts only — not available inside the client bundle unless mirrored
  // to EXPO_PUBLIC_*, but keep for native builds where Constants is ready.
  const fromProcess = process.env.APP_VARIANT;
  if (fromProcess === 'staff' || fromProcess === 'family') return fromProcess;

  const extra = Constants.expoConfig?.extra as { appVariant?: string } | undefined;
  const fromConfig = extra?.appVariant;
  if (fromConfig === 'staff' || fromConfig === 'family') return fromConfig;

  // Manifest fallbacks (older Expo / some web SSR paths)
  const manifestExtra =
    (Constants as { manifest2?: { extra?: { expoClient?: { extra?: { appVariant?: string } } } } })
      .manifest2?.extra?.expoClient?.extra?.appVariant ??
    (Constants as { manifest?: { extra?: { appVariant?: string } } }).manifest?.extra?.appVariant;
  if (manifestExtra === 'staff' || manifestExtra === 'family') return manifestExtra;

  return 'family';
}

/** Which store app this binary is (staff = NIMT Staff, family = NIMT Campus). */
export const APP_VARIANT: AppVariant = resolveVariant();

export const isStaffApp = APP_VARIANT === 'staff';
export const isFamilyApp = APP_VARIANT === 'family';
