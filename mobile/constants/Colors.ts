// Design tokens matching the web Tailwind config
// Primary: indigo #0035C5 (HSL 224 100% 39%)
// Secondary: warm #954919

export const colors = {
  primary: '#0035C5',
  primaryLight: '#E8EDFB',
  secondary: '#954919',

  background: '#FAFAFA',
  card: '#FFFFFF',
  cardBorder: '#F0F0F0',
  border: '#E5E7EB',

  text: '#111827',
  textSecondary: '#6B7280',
  textMuted: '#9CA3AF',

  success: '#16A34A',
  successLight: '#F0FDF4',
  warning: '#F59E0B',
  warningLight: '#FFFBEB',
  destructive: '#EF4444',
  destructiveLight: '#FEF2F2',

  // Pastel palette (from web)
  pastelGreen: '#E8F5E9',
  pastelBlue: '#E3F2FD',
  pastelYellow: '#FFF8E1',
  pastelRed: '#FFEBEE',
  pastelPurple: '#F3E5F5',
  pastelOrange: '#FFF3E0',
  pastelMint: '#E0F7FA',
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
};

export const radius = {
  sm: 4,
  md: 8,
  lg: 12,
  xl: 16,
  full: 9999,
};

export const typography = {
  // Will use Inter + Manrope via expo-font
  h1: { fontSize: 24, fontWeight: '700' as const, letterSpacing: -0.5 },
  h2: { fontSize: 20, fontWeight: '700' as const, letterSpacing: -0.3 },
  h3: { fontSize: 16, fontWeight: '600' as const },
  body: { fontSize: 14, fontWeight: '400' as const },
  bodyMedium: { fontSize: 14, fontWeight: '500' as const },
  caption: { fontSize: 12, fontWeight: '400' as const },
  small: { fontSize: 11, fontWeight: '500' as const },
  mono: { fontSize: 12, fontFamily: 'monospace' },
};

// Default export for backwards compatibility with template
export default {
  light: {
    text: colors.text,
    background: colors.background,
    tint: colors.primary,
    tabIconDefault: colors.textMuted,
    tabIconSelected: colors.primary,
  },
  dark: {
    text: '#FFFFFF',
    background: '#000000',
    tint: '#FFFFFF',
    tabIconDefault: '#6B7280',
    tabIconSelected: '#FFFFFF',
  },
};
