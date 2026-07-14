import { type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import { useTheme } from '../../theme/ThemeContext';
import { PressableScale } from './PressableScale';

type IconType = React.ComponentType<{ size?: number; color?: string }>;

interface ListRowProps {
  title: string;
  subtitle?: string;
  icon?: IconType;
  /** rendered on the right — a StatusPill, value text, etc. */
  trailing?: ReactNode;
  /** rendered on the left instead of icon — e.g. an Avatar */
  leading?: ReactNode;
  onPress?: () => void;
  showChevron?: boolean;
}

export function ListRow({ title, subtitle, icon: Icon, trailing, leading, onPress, showChevron }: ListRowProps) {
  const { colors, spacing, type, radius } = useTheme();

  const body = (
    <View style={[styles.row, { paddingVertical: spacing.sm, paddingHorizontal: spacing.md }]}>
      {leading ??
        (Icon ? (
          <View style={[styles.iconWrap, { backgroundColor: colors.cardSubtle, borderRadius: radius.sm }]}>
            <Icon size={18} color={colors.inkSecondary} />
          </View>
        ) : null)}
      <View style={styles.textWrap}>
        <Text style={[type.bodyMedium, { color: colors.ink }]} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={[type.caption, { color: colors.inkSecondary, marginTop: 1 }]} numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {trailing}
      {showChevron && <ChevronRight size={16} color={colors.inkMuted} />}
    </View>
  );

  if (onPress) {
    return (
      <PressableScale onPress={onPress} accessibilityLabel={title}>
        {body}
      </PressableScale>
    );
  }
  return body;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56 },
  iconWrap: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  textWrap: { flex: 1 },
});
