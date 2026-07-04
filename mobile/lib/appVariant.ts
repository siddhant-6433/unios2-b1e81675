import Constants from 'expo-constants';

export type AppVariant = 'staff' | 'family';

const fromConfig = Constants.expoConfig?.extra?.appVariant as AppVariant | undefined;

/** Which store app this binary is (set at build time via APP_VARIANT). */
export const APP_VARIANT: AppVariant = fromConfig === 'staff' ? 'staff' : 'family';

export const isStaffApp = APP_VARIANT === 'staff';
export const isFamilyApp = APP_VARIANT === 'family';
