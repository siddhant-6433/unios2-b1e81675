import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Check, Clock, Eye, X, type LucideIcon } from 'lucide-react-native';
import { useTheme } from '../../theme/ThemeContext';
import type { ChipTint } from '../../theme/tokens';

type IconType = React.ComponentType<{ size?: number; color?: string }>;

interface ChipProps {
  label: string;
  tint?: ChipTint;
  icon?: IconType;
  size?: 'md' | 'sm';
}

/** Soft-tint metadata chip — the signature atom (tinted bg + saturated icon/text). */
export function Chip({ label, tint = 'neutral', icon: Icon, size = 'md' }: ChipProps) {
  const { colors, radius } = useTheme();
  const pair = colors.tint[tint];
  const isSm = size === 'sm';
  return (
    <View
      style={[
        styles.chip,
        {
          backgroundColor: pair.bg,
          borderRadius: radius.sm,
          paddingHorizontal: isSm ? 8 : 10,
          height: isSm ? 24 : 30,
        },
      ]}
    >
      {Icon && <Icon size={isSm ? 12 : 14} color={pair.fg} />}
      <Text
        numberOfLines={1}
        style={{ color: pair.fg, fontSize: isSm ? 11 : 13, fontWeight: '600' }}
      >
        {label}
      </Text>
    </View>
  );
}

export type StatusKind = 'approved' | 'pending' | 'review' | 'rejected' | 'neutral';

const statusConfig: Record<StatusKind, { tint: ChipTint; icon: LucideIcon | null; spinner?: boolean }> = {
  approved: { tint: 'green', icon: Check },
  pending: { tint: 'yellow', icon: Clock, spinner: true },
  review: { tint: 'blue', icon: Eye },
  rejected: { tint: 'red', icon: X },
  neutral: { tint: 'neutral', icon: null },
};

/** Status pill — statuses are never plain text. */
export function StatusPill({ status, label, size = 'md' }: { status: StatusKind; label: string; size?: 'md' | 'sm' }) {
  const { colors, radius } = useTheme();
  const cfg = statusConfig[status];
  const pair = colors.tint[cfg.tint];
  const isSm = size === 'sm';
  const Icon = cfg.icon;
  return (
    <View
      style={[
        styles.chip,
        {
          backgroundColor: pair.bg,
          borderRadius: radius.full,
          paddingHorizontal: isSm ? 8 : 10,
          height: isSm ? 24 : 30,
        },
      ]}
    >
      {cfg.spinner ? (
        <ActivityIndicator size={isSm ? 10 : 12} color={pair.fg} />
      ) : (
        Icon && <Icon size={isSm ? 12 : 14} color={pair.fg} strokeWidth={3} />
      )}
      <Text style={{ color: pair.fg, fontSize: isSm ? 11 : 13, fontWeight: '700' }}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start' },
});
