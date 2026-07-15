import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ArrowLeft, CalendarDays } from 'lucide-react-native';
import { useTheme } from '../../theme/ThemeContext';
import { useActiveChild } from './ChildContext';
import { DAY_LABELS, formatTime, useBatchTimetable, type TimetableSlot } from '../../api/timetable';
import {
  Card,
  EmptyState,
  ListRow,
  PressableScale,
  SegmentedControl,
  SkeletonCard,
  StatusPill,
} from '../../components/ui';

// School weeks run Mon–Sat; Sunday defaults to Monday's view.
const WEEK_DAYS = [1, 2, 3, 4, 5, 6];

function slotSubtitle(slot: TimetableSlot): string {
  const parts: string[] = [];
  if (slot.startTime) parts.push(`${formatTime(slot.startTime)} – ${formatTime(slot.endTime)}`);
  const teacher = slot.substituteName ?? slot.facultyName;
  if (teacher) parts.push(slot.substituteName ? `${teacher} (substitute)` : teacher);
  if (slot.room) parts.push(`Room ${slot.room}`);
  return parts.join(' · ');
}

export function FamilyTimetableScreen() {
  const { colors, spacing, type } = useTheme();
  const { children_, activeChild, setActiveChildId } = useActiveChild();
  const today = new Date().getDay();
  const [day, setDay] = useState<number>(WEEK_DAYS.includes(today) ? today : 1);
  const timetable = useBatchTimetable(activeChild?.batchId);

  const daySlots = (timetable.data ?? []).filter((slot) => slot.dayOfWeek === day);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing.xxl, gap: spacing.md }}>
        <View style={styles.headerRow}>
          <PressableScale onPress={() => router.back()}>
            <ArrowLeft size={24} color={colors.ink} />
          </PressableScale>
          <Text style={[type.h1, { color: colors.ink }]}>Timetable</Text>
        </View>

        {children_.length > 1 && activeChild && (
          <SegmentedControl
            options={children_.map((child) => ({ value: child.id, label: child.name.split(' ')[0] }))}
            value={activeChild.id}
            onChange={setActiveChildId}
          />
        )}

        <SegmentedControl
          options={WEEK_DAYS.map((d) => ({ value: String(d), label: DAY_LABELS[d] }))}
          value={String(day)}
          onChange={(value) => setDay(Number(value))}
        />

        {timetable.isLoading ? (
          <SkeletonCard height={280} />
        ) : !activeChild?.batchId ? (
          <EmptyState
            icon={CalendarDays}
            title="No batch assigned"
            message="The timetable appears once a batch is assigned to this student."
            tint="blue"
          />
        ) : daySlots.length === 0 ? (
          <EmptyState
            icon={CalendarDays}
            title={`No classes on ${DAY_LABELS[day]}`}
            message="The school hasn't published a timetable for this day yet."
            tint="blue"
          />
        ) : (
          <Card padded={false}>
            {daySlots.map((slot) => (
              <ListRow
                key={slot.entryId}
                title={slot.subjectName ?? slot.periodLabel ?? 'Class'}
                subtitle={slotSubtitle(slot) || undefined}
                trailing={
                  slot.substituteName || slot.substituteUserId ? (
                    <StatusPill status="review" label="Substitute" size="sm" />
                  ) : slot.mode !== 'physical' ? (
                    <StatusPill status="neutral" label={slot.mode === 'online' ? 'Online' : 'Hybrid'} size="sm" />
                  ) : undefined
                }
              />
            ))}
          </Card>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
});
