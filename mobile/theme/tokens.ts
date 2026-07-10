// Design tokens — RazorSense (cool blue-gray, see mobile/DESIGN.md).
// Single source of truth; screens and components never hardcode these values.
import { Platform, type TextStyle } from 'react-native';

export type ThemeMode = 'light' | 'dark';
export type ChipTint = 'yellow' | 'blue' | 'purple' | 'red' | 'green' | 'orange' | 'neutral';

export interface TintPair {
  bg: string;
  fg: string;
}

export interface ThemeColors {
  canvas: string;
  card: string;
  cardSubtle: string;
  inverse: string;
  inverseInk: string;
  line: string;
  ink: string;
  inkSecondary: string;
  inkMuted: string;
  accent: string;
  accentSoft: string;
  success: string;
  danger: string;
  pillBg: string;
  pillFg: string;
  tint: Record<ChipTint, TintPair>;
}

const lightTints: Record<ChipTint, TintPair> = {
  yellow: { bg: '#FEF4D5', fg: '#7A5600' },
  blue: { bg: '#E1EEFF', fg: '#0035C5' },
  purple: { bg: '#EDE5FC', fg: '#5B21B6' },
  red: { bg: '#FDE5E3', fg: '#B91C1C' },
  green: { bg: '#DDFBE6', fg: '#166534' },
  orange: { bg: '#FDE8D4', fg: '#9A3412' },
  neutral: { bg: '#EEF0F4', fg: '#4B5563' },
};

const darkTints: Record<ChipTint, TintPair> = {
  yellow: { bg: '#372D0F', fg: '#E8C44E' },
  blue: { bg: '#0F1B3D', fg: '#8EAAFC' },
  purple: { bg: '#251C3D', fg: '#B491F0' },
  red: { bg: '#391A18', fg: '#EF9590' },
  green: { bg: '#0F2B1C', fg: '#6FCA93' },
  orange: { bg: '#331F0E', fg: '#E8A45E' },
  neutral: { bg: '#1E2028', fg: '#A8ADB8' },
};

export const lightColors: ThemeColors = {
  canvas: '#F5F7FA',
  card: '#FFFFFF',
  cardSubtle: '#F8F9FC',
  inverse: '#161B22',
  inverseInk: '#F3F5F9',
  line: '#E2E6ED',
  ink: '#161B22',
  inkSecondary: '#636D7E',
  inkMuted: '#9BA3B2',
  accent: '#0035C5',
  accentSoft: '#E1EEFF',
  success: '#166534',
  danger: '#B91C1C',
  pillBg: '#161B22',
  pillFg: '#FFFFFF',
  tint: lightTints,
};

export const darkColors: ThemeColors = {
  canvas: '#0C0E14',
  card: '#161B24',
  cardSubtle: '#111620',
  inverse: '#F3F5F9',
  inverseInk: '#161B22',
  line: '#1E2430',
  ink: '#F3F5F9',
  inkSecondary: '#A3AAB8',
  inkMuted: '#636D80',
  accent: '#7B96FF',
  accentSoft: '#0F1B3D',
  success: '#6FCA93',
  danger: '#EF9590',
  pillBg: '#F3F5F9',
  pillFg: '#0C0E14',
  tint: darkTints,
};

export const spacing = {
  xxs: 4,
  xs: 8,
  sm: 12,
  md: 16,
  lg: 20,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 10,
  md: 14,
  lg: 18,
  xl: 22,
  full: 9999,
} as const;

const serifFamily = Platform.select({ ios: 'Georgia', default: 'serif' });
const tabularNums: TextStyle['fontVariant'] = ['tabular-nums'];

export const type = {
  display: { fontSize: 32, fontWeight: '700' as const, letterSpacing: -0.8, lineHeight: 38 },
  displaySerif: {
    fontSize: 32,
    fontWeight: '600' as const,
    fontStyle: 'italic' as const,
    fontFamily: serifFamily,
    letterSpacing: -0.4,
    lineHeight: 38,
  },
  h1: { fontSize: 24, fontWeight: '700' as const, letterSpacing: -0.5, lineHeight: 30 },
  h2: { fontSize: 20, fontWeight: '700' as const, letterSpacing: -0.3, lineHeight: 26 },
  h3: { fontSize: 16, fontWeight: '600' as const, lineHeight: 22 },
  body: { fontSize: 15, fontWeight: '400' as const, lineHeight: 21 },
  bodyMedium: { fontSize: 15, fontWeight: '500' as const, lineHeight: 21 },
  caption: { fontSize: 13, fontWeight: '400' as const, lineHeight: 18 },
  captionMedium: { fontSize: 13, fontWeight: '600' as const, lineHeight: 18 },
  micro: { fontSize: 11, fontWeight: '600' as const, lineHeight: 14, letterSpacing: 0.2 },
  numeralLg: {
    fontSize: 34,
    fontWeight: '800' as const,
    letterSpacing: -1,
    fontVariant: tabularNums,
  },
  numeral: {
    fontSize: 24,
    fontWeight: '800' as const,
    letterSpacing: -0.5,
    fontVariant: tabularNums,
  },
  numeralSm: {
    fontSize: 17,
    fontWeight: '700' as const,
    fontVariant: tabularNums,
  },
} as const;

export const motion = {
  pressScale: 0.98,
  fast: 160,
  normal: 280,
  slow: 480,
  // ponytail: Blade easing curves for Animated.timing
  easing: {
    entrance: [0, 0, 0.2, 1] as const,
    exit: [0.17, 0, 1, 1] as const,
    standard: [0.3, 0, 0.2, 1] as const,
    emphasized: [0.5, 0, 0, 1] as const,
  },
} as const;

export interface Theme {
  mode: ThemeMode;
  colors: ThemeColors;
  spacing: typeof spacing;
  radius: typeof radius;
  type: typeof type;
  motion: typeof motion;
}

export const lightTheme: Theme = {
  mode: 'light',
  colors: lightColors,
  spacing,
  radius,
  type,
  motion,
};

export const darkTheme: Theme = {
  mode: 'dark',
  colors: darkColors,
  spacing,
  radius,
  type,
  motion,
};
