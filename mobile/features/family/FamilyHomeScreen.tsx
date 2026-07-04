import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Bell, CalendarCheck, IndianRupee } from 'lucide-react-native';
import { useTheme } from '../../theme/ThemeContext';
import { useAuth } from '../../contexts/AuthContext';
import { useActiveChild } from './ChildContext';
import { useChildAttendance, useChildFees, useNotices } from '../../api/family';
import {
  Card,
  Chip,
  GreetingHero,
  ListRow,
  SegmentedControl,
  SkeletonCard,
  StatTile,
  TickBar,
} from '../../components/ui';

function formatInr(amount: number): string {
  return `₹${amount.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

export function FamilyHomeScreen() {
  const { colors, spacing, type } = useTheme();
  const { profile, role } = useAuth();
  const { children_, activeChild, setActiveChildId, isLoading: childrenLoading } = useActiveChild();

  const attendance = useChildAttendance(activeChild?.id);
  const fees = useChildFees(activeChild?.id);
  const notices = useNotices();

  const unreadNotices = (notices.data ?? []).filter((n) => !n.isRead);
  const firstName = (profile?.display_name || activeChild?.name || 'there').split(' ')[0];
  const attendancePct = attendance.data ? Math.round(attendance.data.ratio * 100) : null;

  const isRefreshing = attendance.isRefetching || fees.isRefetching || notices.isRefetching;
  const refreshAll = () => {
    attendance.refetch();
    fees.refetch();
    notices.refetch();
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }} edges={['top']}>
      <ScrollView
        contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing.xxl, gap: spacing.md }}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={refreshAll} />}
      >
        <GreetingHero
          eyebrow="Hello,"
          name={firstName}
          segments={
            unreadNotices.length > 0 || (fees.data?.totalBalance ?? 0) > 0
              ? [
                  { text: 'You have ' },
                  ...(unreadNotices.length > 0
                    ? [
                        { text: `${unreadNotices.length} new notice${unreadNotices.length > 1 ? 's' : ''}`, emphasis: true },
                      ]
                    : []),
                  ...(unreadNotices.length > 0 && (fees.data?.totalBalance ?? 0) > 0 ? [{ text: ' and ' }] : []),
                  ...((fees.data?.totalBalance ?? 0) > 0
                    ? [{ text: `${formatInr(fees.data!.totalBalance)} due`, emphasis: true, accent: true }]
                    : []),
                  { text: '.' },
                ]
              : [{ text: 'All caught up ', emphasis: true }, { text: 'today.' }]
          }
        />

        {/* Child switcher — parents with multiple children */}
        {children_.length > 1 && activeChild && (
          <SegmentedControl
            options={children_.map((child) => ({ value: child.id, label: child.name.split(' ')[0] }))}
            value={activeChild.id}
            onChange={setActiveChildId}
          />
        )}

        {activeChild && role === 'parent' && (
          <View style={styles.chipRow}>
            <Chip label={activeChild.courseName ?? 'Course'} tint="blue" size="sm" />
            {activeChild.batchName ? <Chip label={activeChild.batchName} tint="purple" size="sm" /> : null}
            {activeChild.campusName ? <Chip label={activeChild.campusName} tint="yellow" size="sm" /> : null}
          </View>
        )}

        {/* Bento stats */}
        {childrenLoading || attendance.isLoading || fees.isLoading ? (
          <View style={{ gap: spacing.sm }}>
            <SkeletonCard />
            <SkeletonCard />
          </View>
        ) : (
          <View style={styles.bentoRow}>
            <StatTile
              label="Attendance"
              value={attendancePct !== null && attendance.data!.totalDays > 0 ? `${attendancePct}%` : '—'}
              caption={
                attendance.data && attendance.data.totalDays > 0
                  ? `${attendance.data.presentDays}/${attendance.data.totalDays} days`
                  : 'No records yet'
              }
              icon={CalendarCheck}
              tint="green"
              onPress={() => router.push('/(family)/(tabs)/attendance')}
            >
              {attendance.data && attendance.data.totalDays > 0 ? (
                <TickBar progress={attendance.data.ratio} tint={attendance.data.ratio >= 0.75 ? 'green' : 'red'} height={14} />
              ) : undefined}
            </StatTile>
            <StatTile
              label="Fees due"
              value={fees.data ? formatInr(fees.data.totalBalance) : '—'}
              caption={
                fees.data?.overdueCount
                  ? `${fees.data.overdueCount} overdue`
                  : fees.data?.nextDueDate
                    ? `Next due ${fees.data.nextDueDate}`
                    : 'Nothing pending'
              }
              icon={IndianRupee}
              tint={(fees.data?.totalBalance ?? 0) > 0 ? 'red' : 'green'}
              onPress={() => router.push('/(family)/(tabs)/fees')}
            />
          </View>
        )}

        {/* Latest notices */}
        <View style={{ gap: spacing.xs }}>
          <Text style={[type.h3, { color: colors.ink, marginTop: spacing.xs }]}>Latest notices</Text>
          {notices.isLoading ? (
            <SkeletonCard height={72} />
          ) : (notices.data ?? []).length === 0 ? (
            <Card subtle>
              <Text style={[type.caption, { color: colors.inkSecondary }]}>No notices right now.</Text>
            </Card>
          ) : (
            <Card padded={false}>
              {(notices.data ?? []).slice(0, 3).map((notice) => (
                <ListRow
                  key={notice.id}
                  icon={Bell}
                  title={notice.title}
                  subtitle={notice.body}
                  trailing={!notice.isRead ? <View style={[styles.unreadDot, { backgroundColor: colors.accent }]} /> : undefined}
                  onPress={() => router.push('/(family)/(tabs)/notices')}
                />
              ))}
            </Card>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  bentoRow: { flexDirection: 'row', gap: 12 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  unreadDot: { width: 8, height: 8, borderRadius: 4 },
});
