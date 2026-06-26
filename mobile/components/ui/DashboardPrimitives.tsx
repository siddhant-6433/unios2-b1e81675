import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import { colors, radius, spacing, typography } from '../../constants/Colors';

type IconType = React.ComponentType<{ size?: number; color?: string }>;

export function ScreenHeader({
  title,
  subtitle,
  avatar,
  action,
}: {
  title: string;
  subtitle?: string;
  avatar?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <View style={styles.header}>
      <View style={{ flex: 1 }}>
        <Text style={styles.headerTitle}>{title}</Text>
        {subtitle ? <Text style={styles.headerSubtitle}>{subtitle}</Text> : null}
      </View>
      {avatar}
      {action}
    </View>
  );
}

export function StatusCard({
  icon: Icon,
  title,
  subtitle,
  value,
  tone = 'blue',
  onPress,
  children,
}: {
  icon?: IconType;
  title: string;
  subtitle?: string;
  value?: string;
  tone?: Tone;
  onPress?: () => void;
  children?: ReactNode;
}) {
  const Wrapper = onPress ? Pressable : View;
  const toneStyle = toneStyles[tone];
  return (
    <Wrapper style={[styles.statusCard, { backgroundColor: toneStyle.bg }]} onPress={onPress}>
      <View style={styles.statusTop}>
        {Icon ? (
          <View style={[styles.roundIcon, { backgroundColor: toneStyle.iconBg }]}>
            <Icon size={22} color={toneStyle.fg} />
          </View>
        ) : null}
        {value ? <Text style={[styles.statusValue, { color: toneStyle.fg }]}>{value}</Text> : null}
      </View>
      <Text style={styles.statusTitle}>{title}</Text>
      {subtitle ? <Text style={styles.statusSubtitle}>{subtitle}</Text> : null}
      {children}
    </Wrapper>
  );
}

export function MetricCard({
  icon: Icon,
  label,
  value,
  tone = 'blue',
}: {
  icon: IconType;
  label: string;
  value: string;
  tone?: Tone;
}) {
  const toneStyle = toneStyles[tone];
  return (
    <View style={styles.metricCard}>
      <View style={[styles.smallIcon, { backgroundColor: toneStyle.iconBg }]}>
        <Icon size={18} color={toneStyle.fg} />
      </View>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

export function ActionTile({
  icon: Icon,
  label,
  subtitle,
  tone = 'blue',
  onPress,
  style,
}: {
  icon: IconType;
  label: string;
  subtitle?: string;
  tone?: Tone;
  onPress?: () => void;
  style?: ViewStyle;
}) {
  const toneStyle = toneStyles[tone];
  return (
    <Pressable style={[styles.actionTile, { backgroundColor: toneStyle.bg }, style]} onPress={onPress}>
      <View style={[styles.smallIcon, { backgroundColor: toneStyle.iconBg }]}>
        <Icon size={18} color={toneStyle.fg} />
      </View>
      <Text style={styles.actionLabel}>{label}</Text>
      {subtitle ? <Text style={styles.actionSubtitle}>{subtitle}</Text> : null}
    </Pressable>
  );
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: {
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <View style={styles.segmented}>
      {options.map((option) => (
        <Pressable
          key={option.value}
          style={[styles.segment, value === option.value && styles.segmentActive]}
          onPress={() => onChange(option.value)}
        >
          <Text style={[styles.segmentText, value === option.value && styles.segmentTextActive]}>{option.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export function PillFilter<T extends string>({
  options,
  value,
  onChange,
}: {
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <View style={styles.pills}>
      {options.map((option) => (
        <Pressable
          key={option.value}
          style={[styles.pill, value === option.value && styles.pillActive]}
          onPress={() => onChange(option.value)}
        >
          <Text style={[styles.pillText, value === option.value && styles.pillTextActive]}>{option.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export function SectionTitle({ title, action }: { title: string; action?: string }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {action ? (
        <View style={styles.sectionAction}>
          <Text style={styles.sectionActionText}>{action}</Text>
          <ChevronRight size={14} color={colors.primary} />
        </View>
      ) : null}
    </View>
  );
}

type Tone = 'blue' | 'green' | 'yellow' | 'pink' | 'purple' | 'orange' | 'neutral';

const toneStyles: Record<Tone, { bg: string; fg: string; iconBg: string }> = {
  blue: { bg: '#E3F2FD', fg: '#0369A1', iconBg: '#FFFFFF' },
  green: { bg: '#DCFCE7', fg: '#15803D', iconBg: '#FFFFFF' },
  yellow: { bg: '#FEF3C7', fg: '#B45309', iconBg: '#FFFFFF' },
  pink: { bg: '#FCE7F3', fg: '#BE185D', iconBg: '#FFFFFF' },
  purple: { bg: '#F3E8FF', fg: '#7E22CE', iconBg: '#FFFFFF' },
  orange: { bg: '#FFEDD5', fg: '#C2410C', iconBg: '#FFFFFF' },
  neutral: { bg: colors.card, fg: colors.textSecondary, iconBg: colors.background },
};

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingTop: spacing.sm,
    marginBottom: spacing.lg,
  },
  headerTitle: { ...typography.h1, color: colors.text },
  headerSubtitle: { ...typography.body, color: colors.textSecondary, marginTop: 3 },
  statusCard: {
    borderRadius: 28,
    padding: spacing.lg,
    minHeight: 144,
    overflow: 'hidden',
  },
  statusTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.lg },
  roundIcon: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  smallIcon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  statusTitle: { fontSize: 22, lineHeight: 28, fontWeight: '800', color: colors.text, letterSpacing: 0 },
  statusSubtitle: { ...typography.body, color: colors.textSecondary, marginTop: spacing.xs, lineHeight: 20 },
  statusValue: { fontSize: 24, fontWeight: '800', letterSpacing: 0 },
  metricCard: {
    flex: 1,
    minHeight: 118,
    borderRadius: 22,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    padding: spacing.md,
    justifyContent: 'space-between',
  },
  metricValue: { fontSize: 24, fontWeight: '800', color: colors.text, letterSpacing: 0 },
  metricLabel: { ...typography.caption, color: colors.textSecondary },
  actionTile: {
    flex: 1,
    minWidth: '47%',
    minHeight: 108,
    borderRadius: 22,
    padding: spacing.md,
    justifyContent: 'space-between',
  },
  actionLabel: { ...typography.bodyMedium, color: colors.text, lineHeight: 20 },
  actionSubtitle: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs },
  segmented: {
    flexDirection: 'row',
    gap: spacing.xs,
    backgroundColor: colors.card,
    borderRadius: radius.full,
    padding: spacing.xs,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  segment: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 36, borderRadius: radius.full },
  segmentActive: { backgroundColor: colors.text },
  segmentText: { ...typography.caption, color: colors.textSecondary, fontWeight: '600' },
  segmentTextActive: { color: '#FFFFFF' },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  pill: {
    minHeight: 36,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillActive: { backgroundColor: colors.text, borderColor: colors.text },
  pillText: { ...typography.caption, color: colors.textSecondary, fontWeight: '600' },
  pillTextActive: { color: '#FFFFFF' },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.sm },
  sectionTitle: { ...typography.h3, color: colors.text },
  sectionAction: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  sectionActionText: { ...typography.caption, color: colors.primary, fontWeight: '700' },
});
