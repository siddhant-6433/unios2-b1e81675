import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import type { ChipTint } from '../../theme/tokens';
import { Button } from './Button';

type IconType = React.ComponentType<{ size?: number; color?: string }>;

interface EmptyStateProps {
  icon: IconType;
  title: string;
  message?: string;
  tint?: ChipTint;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({ icon: Icon, title, message, tint = 'neutral', actionLabel, onAction }: EmptyStateProps) {
  const { colors, spacing, type } = useTheme();
  const pair = colors.tint[tint];
  return (
    <View style={[styles.wrap, { paddingVertical: spacing.xxl, gap: spacing.sm }]}>
      <View style={[styles.icon, { backgroundColor: pair.bg }]}>
        <Icon size={28} color={pair.fg} />
      </View>
      <Text style={[type.h3, { color: colors.ink, textAlign: 'center' }]}>{title}</Text>
      {message ? (
        <Text style={[type.caption, { color: colors.inkSecondary, textAlign: 'center', maxWidth: 260 }]}>
          {message}
        </Text>
      ) : null}
      {actionLabel && onAction ? (
        <Button label={actionLabel} onPress={onAction} variant="secondary" size="sm" style={{ marginTop: spacing.xs }} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center' },
  icon: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
});
