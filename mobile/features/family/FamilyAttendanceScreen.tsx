import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CalendarCheck } from 'lucide-react-native';
import { useTheme } from '../../theme/ThemeContext';
import { useActiveChild } from './ChildContext';
import { useChildAttendance } from '../../api/family';
import {
  Card,
  EmptyState,
  ListRow,
  SegmentedControl,
  SkeletonCard,
  StatusPill,
  TickBar,
  type StatusKind,
} from '../../components/ui';

function statusOf(status: string): { kind: StatusKind; label: string } {
  if (status === 'present') return { kind: 'approved', label: 'Present' };
  if (status === 'absent') return { kind: 'rejected', label: 'Absent' };
  if (status === 'leave') return { kind: 'review', label: 'Leave' };
  return { kind: 'neutral', label: status };
}

function formatDay(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

export function FamilyAttendanceScreen() {
  const { colors, spacing, type } = useTheme();
  const { children_, activeChild, setActiveChildId } = useActiveChild();
  const attendance = useChildAttendance(activeChild?.id);

  const pct = attendance.data && attendance.data.totalDays > 0
    ? Math.round(attendance.data.ratio * 100)
    : null;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing.xxl, gap: spacing.md }}>
        <Text style={[type.h1, { color: colors.ink }]}>Attendance</Text>

        {children_.length > 1 && activeChild && (
          <SegmentedControl
            options={children_.map((child) => ({ value: child.id, label: child.name.split(' ')[0] }))}
            value={activeChild.id}
            onChange={setActiveChildId}
          />
        )}

        {attendance.isLoading ? (
          <>
            <SkeletonCard height={120} />
            <SkeletonCard height={280} />
          </>
        ) : !attendance.data || attendance.data.totalDays === 0 ? (
          <EmptyState
            icon={CalendarCheck}
            title="No attendance yet"
            message="Records will appear here once classes are marked."
            tint="green"
          />
        ) : (
          <>
            <Card>
              <View style={styles.summaryTop}>
                <Text style={[type.captionMedium, { color: colors.inkSecondary }]}>Last 90 days</Text>
                <Text style={[type.numeralLg, { color: colors.ink }]}>{pct}%</Text>
              </View>
              <TickBar
                progress={attendance.data.ratio}
                tint={attendance.data.ratio >= 0.75 ? 'green' : 'red'}
              />
              <Text style={[type.caption, { color: colors.inkMuted, marginTop: spacing.xs }]}>
                Present {attendance.data.presentDays} of {attendance.data.totalDays} marked days
              </Text>
            </Card>

            <Card padded={false}>
              {attendance.data.recent.map((row, i) => {
                const s = statusOf(row.status);
                return (
                  <ListRow
                    key={`${row.date}-${row.subject ?? i}`}
                    title={formatDay(row.date)}
                    subtitle={row.subject ?? undefined}
                    trailing={<StatusPill status={s.kind} label={s.label} size="sm" />}
                  />
                );
              })}
            </Card>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  summaryTop: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
});
