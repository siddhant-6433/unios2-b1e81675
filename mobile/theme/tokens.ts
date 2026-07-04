// Design tokens — "Warm Editorial Utility" (see mobile/DESIGN.md).
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
  yellow: { bg: '#FBF3D7', fg: '#8A6100' },
  blue: { bg: '#E4ECFB', fg: '#1D4FD7' },
  purple: { bg: '#EFE8FC', fg: '#6D28D9' },
  red: { bg: '#FBE3E1', fg: '#C0392B' },
  green: { bg: '#DFF3E5', fg: '#187741' },
  orange: { bg: '#FBEBDB', fg: '#B45309' },
  neutral: { bg: '#F1EFEC', fg: '#57534E' },
};

const darkTints: Record<ChipTint, TintPair> = {
  yellow: { bg: '#3A3012', fg: '#EAC85B' },
  blue: { bg: '#1B2440', fg: '#8FA8F5' },
  purple: { bg: '#2A2140', fg: '#B79AF0' },
  red: { bg: '#3C1E1B', fg: '#F09A8F' },
  green: { bg: '#16301F', fg: '#7CCB98' },
  orange: { bg: '#382512', fg: '#EBAA66' },
  neutral: { bg: '#26262B', fg: '#B3B0AC' },
};

export const lightColors: ThemeColors = {
  canvas: '#F7F5F2',
  card: '#FFFFFF',
  cardSubtle: '#FBFAF8',
  inverse: '#17161A',
  inverseInk: '#F4F3F1',
  line: '#EFEDE9',
  ink: '#1A1917',
  inkSecondary: '#6E6A64',
  inkMuted: '#A6A19A',
  accent: '#0035C5',
  accentSoft: '#E8EDFB',
  success: '#187741',
  danger: '#C0392B',
  pillBg: '#1A1917',
  pillFg: '#FFFFFF',
  tint: lightTints,
};

export const darkColors: ThemeColors = {
  canvas: '#0D0D0F',
  card: '#1A1A1E',
  cardSubtle: '#141416',
  inverse: '#F7F5F2',
  inverseInk: '#1A1917',
  line: '#26262B',
  ink: '#F4F3F1',
  inkSecondary: '#A7A4A0',
  inkMuted: '#6B6965',
  accent: '#7B96FF',
  accentSoft: '#1B2440',
  success: '#7CCB98',
  danger: '#F09A8F',
  pillBg: '#F4F3F1',
  pillFg: '#17161A',
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
  pressScale: 0.97,
  fast: 120,
  normal: 220,
  slow: 320,
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
