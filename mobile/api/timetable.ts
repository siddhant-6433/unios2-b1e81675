import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

// timetable_entries.day_of_week: 0 = Sunday … 6 = Saturday (matches JS Date.getDay()).
export const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export interface TimetableSlot {
  entryId: string;
  dayOfWeek: number;
  periodNo: number | null;
  periodLabel: string | null;
  startTime: string | null; // "HH:MM:SS"
  endTime: string | null;
  subjectName: string | null;
  subjectCode: string | null;
  facultyUserId: string | null;
  facultyName: string | null;
  room: string | null;
  mode: string; // physical | online | hybrid
  onlineMeetingUrl: string | null;
  batchName: string | null;
  // Set when a substitution applies on the selected date.
  substituteUserId: string | null;
  substituteName: string | null;
  substitutionReason: string | null;
}

interface EntryRow {
  id: string;
  day_of_week: number;
  faculty_user_id: string | null;
  room: string | null;
  mode: string | null;
  online_meeting_url: string | null;
  class_periods: {
    period_no: number | null;
    label: string | null;
    start_time: string | null;
    end_time: string | null;
  } | null;
  subjects: { name: string; code: string | null } | null;
  batches: { name: string } | null;
}

const ENTRY_SELECT =
  'id, day_of_week, faculty_user_id, room, mode, online_meeting_url, ' +
  'class_periods:period_id(period_no, label, start_time, end_time), ' +
  'subjects:subject_id(name, code), batches:batch_id(name)';

/**
 * Resolve display names for a set of user ids (FK points at auth.users, so no embed).
 * Profiles RLS is staff-only for other users' rows, so family users simply get an
 * empty map back — screens must render fine without names.
 */
async function fetchDisplayNames(userIds: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (ids.length === 0) return new Map();
  const { data, error } = await supabase
    .from('profiles')
    .select('user_id, display_name')
    .in('user_id', ids);
  if (error) return new Map();
  return new Map((data ?? []).map((p) => [p.user_id as string, (p.display_name as string) ?? '']));
}

function toSlot(row: EntryRow, names: Map<string, string>): TimetableSlot {
  return {
    entryId: row.id,
    dayOfWeek: row.day_of_week,
    periodNo: row.class_periods?.period_no ?? null,
    periodLabel: row.class_periods?.label ?? null,
    startTime: row.class_periods?.start_time ?? null,
    endTime: row.class_periods?.end_time ?? null,
    subjectName: row.subjects?.name ?? null,
    subjectCode: row.subjects?.code ?? null,
    facultyUserId: row.faculty_user_id,
    facultyName: row.faculty_user_id ? (names.get(row.faculty_user_id) ?? null) : null,
    room: row.room,
    mode: row.mode ?? 'physical',
    onlineMeetingUrl: row.online_meeting_url,
    batchName: row.batches?.name ?? null,
    substituteUserId: null,
    substituteName: null,
    substitutionReason: null,
  };
}

function bySlotTime(a: TimetableSlot, b: TimetableSlot): number {
  return (a.startTime ?? '99').localeCompare(b.startTime ?? '99') || (a.periodNo ?? 99) - (b.periodNo ?? 99);
}

interface SubRow {
  timetable_entry_id: string;
  on_date: string;
  substitute_user_id: string | null;
  reason: string | null;
}

async function fetchSubsForDate(entryIds: string[], date: string): Promise<SubRow[]> {
  if (entryIds.length === 0) return [];
  const { data, error } = await supabase
    .from('timetable_substitutions')
    .select('timetable_entry_id, on_date, substitute_user_id, reason')
    .in('timetable_entry_id', entryIds)
    .eq('on_date', date);
  if (error) throw error;
  return (data ?? []) as SubRow[];
}

/** Apply substitutions for one date onto that day's slots (mutates copies, returns new array). */
async function applySubs(slots: TimetableSlot[], date: string): Promise<TimetableSlot[]> {
  const dow = new Date(`${date}T00:00:00`).getDay();
  const dayIds = slots.filter((s) => s.dayOfWeek === dow).map((s) => s.entryId);
  const subs = await fetchSubsForDate(dayIds, date);
  if (subs.length === 0) return slots;
  const names = await fetchDisplayNames(subs.map((s) => s.substitute_user_id ?? ''));
  const byEntry = new Map(subs.map((s) => [s.timetable_entry_id, s]));
  return slots.map((slot) => {
    const sub = slot.dayOfWeek === dow ? byEntry.get(slot.entryId) : undefined;
    if (!sub) return slot;
    return {
      ...slot,
      substituteUserId: sub.substitute_user_id,
      substituteName: sub.substitute_user_id ? (names.get(sub.substitute_user_id) ?? null) : null,
      substitutionReason: sub.reason,
    };
  });
}

/**
 * Weekly timetable for a batch: direct entries plus entries of any merge group
 * the batch belongs to. Substitutions are applied for `subDate` (today by default),
 * so "today" views show who is actually taking the class.
 */
export function useBatchTimetable(batchId: string | null | undefined, subDate?: string) {
  const date = subDate ?? new Date().toISOString().slice(0, 10);
  return useQuery({
    queryKey: ['timetable-batch', batchId, date],
    enabled: !!batchId,
    queryFn: async (): Promise<TimetableSlot[]> => {
      const groupsRes = await supabase
        .from('class_merge_members')
        .select('group_id')
        .eq('batch_id', batchId!);
      if (groupsRes.error) throw groupsRes.error;
      const groupIds = (groupsRes.data ?? []).map((g) => g.group_id as string);

      const orFilter =
        groupIds.length > 0
          ? `batch_id.eq.${batchId},merge_group_id.in.(${groupIds.join(',')})`
          : `batch_id.eq.${batchId}`;
      const { data, error } = await supabase.from('timetable_entries').select(ENTRY_SELECT).or(orFilter);
      if (error) throw error;

      const rows = (data ?? []) as unknown as EntryRow[];
      const names = await fetchDisplayNames(rows.map((r) => r.faculty_user_id ?? ''));
      const slots = rows.map((r) => toSlot(r, names)).sort(bySlotTime);
      return applySubs(slots, date);
    },
  });
}

export interface FacultyDay {
  /** Regular classes today, with substituteName set if someone covers it. */
  teaching: TimetableSlot[];
  /** Classes today where this user is the substitute. */
  covering: TimetableSlot[];
}

/** Today's (or `date`'s) teaching schedule for a staff member, substitution-aware. */
export function useFacultySchedule(userId: string | null | undefined, date?: string) {
  const onDate = date ?? new Date().toISOString().slice(0, 10);
  return useQuery({
    queryKey: ['timetable-faculty', userId, onDate],
    enabled: !!userId,
    queryFn: async (): Promise<FacultyDay> => {
      const dow = new Date(`${onDate}T00:00:00`).getDay();

      const [ownRes, subInRes] = await Promise.all([
        supabase
          .from('timetable_entries')
          .select(ENTRY_SELECT)
          .eq('faculty_user_id', userId!)
          .eq('day_of_week', dow),
        supabase
          .from('timetable_substitutions')
          .select('timetable_entry_id, reason')
          .eq('substitute_user_id', userId!)
          .eq('on_date', onDate),
      ]);
      if (ownRes.error) throw ownRes.error;
      if (subInRes.error) throw subInRes.error;

      const ownRows = (ownRes.data ?? []) as unknown as EntryRow[];
      const names = await fetchDisplayNames(ownRows.map((r) => r.faculty_user_id ?? ''));
      const teaching = await applySubs(ownRows.map((r) => toSlot(r, names)).sort(bySlotTime), onDate);

      // Entries this user covers for someone else today.
      let covering: TimetableSlot[] = [];
      const coverIds = (subInRes.data ?? []).map((s) => s.timetable_entry_id as string);
      if (coverIds.length > 0) {
        const coverRes = await supabase.from('timetable_entries').select(ENTRY_SELECT).in('id', coverIds);
        if (coverRes.error) throw coverRes.error;
        const coverRows = (coverRes.data ?? []) as unknown as EntryRow[];
        const reasonByEntry = new Map(
          (subInRes.data ?? []).map((s) => [s.timetable_entry_id as string, (s.reason as string | null) ?? null]),
        );
        const coverNames = await fetchDisplayNames(coverRows.map((r) => r.faculty_user_id ?? ''));
        covering = coverRows
          .map((r) => ({
            ...toSlot(r, coverNames),
            substituteUserId: userId!,
            substitutionReason: reasonByEntry.get(r.id) ?? null,
          }))
          .sort(bySlotTime);
      }

      return { teaching, covering };
    },
  });
}

/** "09:00:00" -> "9:00 AM" */
export function formatTime(time: string | null): string {
  if (!time) return '';
  const [h, m] = time.split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, '0')} ${suffix}`;
}
