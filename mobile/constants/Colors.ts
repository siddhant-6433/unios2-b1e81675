// Legacy bridge — existing screens import from here.
// Values now come from the design system (mobile/DESIGN.md, theme/tokens.ts).
// New code should use useTheme() from theme/ThemeContext instead.
import { lightColors, spacing as themeSpacing, radius as themeRadius } from '../theme/tokens';

export const colors = {
  primary: lightColors.accent,
  primaryLight: lightColors.accentSoft,
  secondary: '#954919',

  background: lightColors.canvas,
  card: lightColors.card,
  cardBorder: lightColors.line,
  border: lightColors.line,

  text: lightColors.ink,
  textSecondary: lightColors.inkSecondary,
  textMuted: lightColors.inkMuted,

  success: lightColors.tint.green.fg,
  successLight: lightColors.tint.green.bg,
  warning: lightColors.tint.orange.fg,
  warningLight: lightColors.tint.orange.bg,
  destructive: lightColors.tint.red.fg,
  destructiveLight: lightColors.tint.red.bg,

  pastelGreen: lightColors.tint.green.bg,
  pastelBlue: lightColors.tint.blue.bg,
  pastelYellow: lightColors.tint.yellow.bg,
  pastelRed: lightColors.tint.red.bg,
  pastelPurple: lightColors.tint.purple.bg,
  pastelOrange: lightColors.tint.orange.bg,
  pastelMint: lightColors.tint.green.bg,
};

export const spacing = {
  xs: themeSpacing.xxs,
  sm: themeSpacing.xs,
  md: themeSpacing.sm,
  lg: themeSpacing.md,
  xl: themeSpacing.xl,
  xxl: themeSpacing.xxl,
};

export const radius = {
  sm: themeRadius.sm,
  md: themeRadius.md,
  lg: themeRadius.lg,
  xl: themeRadius.xl,
  full: themeRadius.full,
};

export const typography = {
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
    text: '#F4F3F1',
    background: '#0D0D0F',
    tint: '#F4F3F1',
    tabIconDefault: '#6B6965',
    tabIconSelected: '#F4F3F1',
  },
};
