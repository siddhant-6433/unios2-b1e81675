import { ActivityIndicator, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { PressableScale } from './PressableScale';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'lg' | 'md' | 'sm';

type IconType = React.ComponentType<{ size?: number; color?: string }>;

interface ButtonProps {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconType;
  isLoading?: boolean;
  disabled?: boolean;
  haptic?: boolean;
  style?: StyleProp<ViewStyle>;
}

const sizeStyles: Record<ButtonSize, { height: number; px: number; fontSize: number }> = {
  lg: { height: 52, px: 24, fontSize: 16 },
  md: { height: 44, px: 20, fontSize: 15 },
  sm: { height: 36, px: 14, fontSize: 13 },
};

export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  icon: Icon,
  isLoading,
  disabled,
  haptic,
  style,
}: ButtonProps) {
  const { colors, radius } = useTheme();
  const s = sizeStyles[size];

  const palette = {
    primary: { bg: colors.pillBg, fg: colors.pillFg, border: 'transparent' },
    secondary: { bg: colors.card, fg: colors.ink, border: colors.line },
    ghost: { bg: 'transparent', fg: colors.inkSecondary, border: 'transparent' },
    danger: { bg: colors.tint.red.bg, fg: colors.tint.red.fg, border: 'transparent' },
  }[variant];

  const isInert = disabled || isLoading;

  return (
    <PressableScale
      onPress={isInert ? undefined : onPress}
      haptic={haptic}
      accessibilityLabel={label}
      style={[
        styles.base,
        {
          height: s.height,
          paddingHorizontal: s.px,
          borderRadius: radius.full,
          backgroundColor: palette.bg,
          borderWidth: palette.border === 'transparent' ? 0 : 1,
          borderColor: palette.border,
          opacity: isInert ? 0.5 : 1,
        },
        style,
      ]}
    >
      <View style={styles.content}>
        {isLoading ? (
          <ActivityIndicator size="small" color={palette.fg} />
        ) : (
          Icon && <Icon size={s.fontSize + 2} color={palette.fg} />
        )}
        <Text style={{ color: palette.fg, fontSize: s.fontSize, fontWeight: '600' }}>{label}</Text>
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: 'center', justifyContent: 'center' },
  content: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
