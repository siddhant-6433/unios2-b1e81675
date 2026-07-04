import { StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Check, X } from 'lucide-react-native';
import { useTheme } from '../../theme/ThemeContext';
import type { ChipTint } from '../../theme/tokens';
import { Card } from './Card';
import { Chip } from './Chip';
import { Button } from './Button';

type IconType = React.ComponentType<{ size?: number; color?: string }>;

export interface ApprovalChipData {
  label: string;
  tint: ChipTint;
  icon?: IconType;
}

interface ApprovalCardProps {
  title: string;
  context: string;
  chips: ApprovalChipData[];
  onApprove?: () => void;
  onReject?: () => void;
  onPress?: () => void;
  /** hide action row for informational / already-decided items */
  actionable?: boolean;
  isDeciding?: boolean;
}

/**
 * Inbox actionable card (ticket-card reference): title, two-line context,
 * soft-tint chip row, approve/reject actions with haptic confirmation.
 */
export function ApprovalCard({
  title,
  context,
  chips,
  onApprove,
  onReject,
  onPress,
  actionable = true,
  isDeciding,
}: ApprovalCardProps) {
  const { colors, spacing, type } = useTheme();

  const decide = (fn?: () => void) => () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    fn?.();
  };

  return (
    <Card onPress={onPress}>
      <Text style={[type.h3, { color: colors.ink }]}>{title}</Text>
      <Text style={[type.caption, { color: colors.inkSecondary, marginTop: 4 }]} numberOfLines={2}>
        {context}
      </Text>
      <View style={[styles.chipRow, { marginTop: spacing.sm }]}>
        {chips.map((chip, i) => (
          <Chip key={i} label={chip.label} tint={chip.tint} icon={chip.icon} size="sm" />
        ))}
      </View>
      {actionable && (onApprove || onReject) ? (
        <View style={[styles.actions, { marginTop: spacing.md, gap: spacing.xs }]}>
          {onReject && (
            <Button
              label="Reject"
              variant="danger"
              size="sm"
              icon={X}
              onPress={decide(onReject)}
              disabled={isDeciding}
              style={styles.actionButton}
            />
          )}
          {onApprove && (
            <Button
              label="Approve"
              variant="primary"
              size="sm"
              icon={Check}
              onPress={decide(onApprove)}
              isLoading={isDeciding}
              style={styles.actionButton}
            />
          )}
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  actions: { flexDirection: 'row' },
  actionButton: { flex: 1 },
});
