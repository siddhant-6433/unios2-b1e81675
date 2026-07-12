import { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, SafeAreaView,
  TouchableOpacity, ActivityIndicator, Linking,
} from 'react-native';
import { useAuth } from '../../../contexts/AuthContext';
import { colors, spacing, radius, typography } from '../../../constants/Colors';
import { BookOpen, MapPin, Video, UserCheck, ChevronLeft, ChevronRight } from 'lucide-react-native';
import { formatTime, useFacultySchedule, type TimetableSlot } from '../../../api/timetable';

function addDays(base: Date, days: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
}

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function dayTitle(offset: number, d: Date): string {
  if (offset === 0) return 'Today';
  if (offset === 1) return 'Tomorrow';
  if (offset === -1) return 'Yesterday';
  return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
}

function SlotCard({ slot, covering }: { slot: TimetableSlot; covering?: boolean }) {
  const coveredByOther = !covering && !!slot.substituteUserId;
  return (
    <View style={[styles.slotCard, coveredByOther && styles.slotCardMuted]}>
      <View style={styles.slotTime}>
        <Text style={styles.slotTimeText}>{formatTime(slot.startTime)}</Text>
        <Text style={styles.slotTimeSub}>{formatTime(slot.endTime)}</Text>
      </View>
      <View style={styles.slotBody}>
        <Text style={styles.slotSubject}>
          {slot.subjectName ?? slot.periodLabel ?? 'Class'}
          {slot.subjectCode ? `  ·  ${slot.subjectCode}` : ''}
        </Text>
        {slot.batchName ? <Text style={styles.slotMeta}>{slot.batchName}</Text> : null}
        <View style={styles.slotTags}>
          {slot.room ? (
            <View style={styles.tag}>
              <MapPin size={12} color={colors.textSecondary} />
              <Text style={styles.tagText}>{slot.room}</Text>
            </View>
          ) : null}
          {slot.mode !== 'physical' ? (
            <TouchableOpacity
              style={[styles.tag, styles.tagOnline]}
              disabled={!slot.onlineMeetingUrl}
              onPress={() => slot.onlineMeetingUrl && Linking.openURL(slot.onlineMeetingUrl)}
            >
              <Video size={12} color={colors.primary} />
              <Text style={[styles.tagText, { color: colors.primary }]}>
                {slot.onlineMeetingUrl ? 'Join online' : 'Online'}
              </Text>
            </TouchableOpacity>
          ) : null}
          {covering ? (
            <View style={[styles.tag, styles.tagCover]}>
              <UserCheck size={12} color={colors.warning} />
              <Text style={[styles.tagText, { color: colors.warning }]}>
                Covering{slot.facultyName ? ` for ${slot.facultyName}` : ''}
              </Text>
            </View>
          ) : null}
          {coveredByOther ? (
            <View style={[styles.tag, styles.tagCover]}>
              <UserCheck size={12} color={colors.warning} />
              <Text style={[styles.tagText, { color: colors.warning }]}>
                Covered{slot.substituteName ? ` by ${slot.substituteName}` : ''}
              </Text>
            </View>
          ) : null}
        </View>
      </View>
    </View>
  );
}

export default function ClassesScreen() {
  const { user } = useAuth();
  const [offset, setOffset] = useState(0);
  const date = addDays(new Date(), offset);
  const schedule = useFacultySchedule(user?.id, toIsoDate(date));

  const teaching = schedule.data?.teaching ?? [];
  const covering = schedule.data?.covering ?? [];
  const isEmpty = teaching.length === 0 && covering.length === 0;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Classes</Text>
        <Text style={styles.subtitle}>Your teaching schedule</Text>

        <View style={styles.dayNav}>
          <TouchableOpacity style={styles.dayNavBtn} onPress={() => setOffset((o) => o - 1)}>
            <ChevronLeft size={20} color={colors.text} />
          </TouchableOpacity>
          <View style={styles.dayNavCenter}>
            <Text style={styles.dayNavTitle}>{dayTitle(offset, date)}</Text>
            <Text style={styles.dayNavSub}>
              {date.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}
            </Text>
          </View>
          <TouchableOpacity style={styles.dayNavBtn} onPress={() => setOffset((o) => o + 1)}>
            <ChevronRight size={20} color={colors.text} />
          </TouchableOpacity>
        </View>

        {schedule.isLoading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : isEmpty ? (
          <View style={styles.emptyCard}>
            <BookOpen size={32} color={colors.textMuted} />
            <Text style={styles.emptyText}>No classes {offset === 0 ? 'today' : 'this day'}</Text>
            <Text style={styles.emptyHint}>
              Classes appear here once the timetable is published for your subjects.
            </Text>
          </View>
        ) : (
          <View style={{ gap: spacing.sm }}>
            {covering.length > 0 && (
              <>
                <Text style={styles.sectionLabel}>Covering</Text>
                {covering.map((slot) => (
                  <SlotCard key={`cover-${slot.entryId}`} slot={slot} covering />
                ))}
              </>
            )}
            {teaching.length > 0 && (
              <>
                {covering.length > 0 && <Text style={styles.sectionLabel}>Your classes</Text>}
                {teaching.map((slot) => (
                  <SlotCard key={slot.entryId} slot={slot} />
                ))}
              </>
            )}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: spacing.lg, paddingBottom: 100 },
  title: { ...typography.h1, color: colors.text, paddingTop: spacing.sm },
  subtitle: { ...typography.body, color: colors.textSecondary, marginTop: 2, marginBottom: spacing.lg },
  center: { paddingVertical: spacing.xxl, alignItems: 'center' },
  dayNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    padding: spacing.sm,
    marginBottom: spacing.md,
  },
  dayNavBtn: { padding: spacing.sm },
  dayNavCenter: { alignItems: 'center' },
  dayNavTitle: { ...typography.bodyMedium, color: colors.text },
  dayNavSub: { ...typography.caption, color: colors.textMuted },
  sectionLabel: {
    ...typography.caption,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginTop: spacing.sm,
  },
  slotCard: {
    flexDirection: 'row',
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    padding: spacing.md,
    gap: spacing.md,
  },
  slotCardMuted: { opacity: 0.6 },
  slotTime: { width: 64 },
  slotTimeText: { ...typography.bodyMedium, color: colors.text },
  slotTimeSub: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  slotBody: { flex: 1 },
  slotSubject: { ...typography.bodyMedium, color: colors.text },
  slotMeta: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  slotTags: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm },
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.background,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  tagOnline: { backgroundColor: `${colors.primary}14` },
  tagCover: { backgroundColor: `${colors.warning}14` },
  tagText: { ...typography.caption, color: colors.textSecondary },
  emptyCard: {
    backgroundColor: colors.card,
    borderRadius: radius.xl,
    padding: spacing.xxl,
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  emptyText: { ...typography.bodyMedium, color: colors.textSecondary },
  emptyHint: { ...typography.caption, color: colors.textMuted, textAlign: 'center' },
});
