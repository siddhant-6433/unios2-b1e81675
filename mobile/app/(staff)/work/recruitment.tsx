import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, SafeAreaView, TextInput,
  TouchableOpacity, ActivityIndicator, RefreshControl, Alert, Linking,
} from 'react-native';
import { supabase } from '../../../lib/supabase';
import { colors, radius } from '../../../constants/Colors';
import { Search, FileText, Sparkles, ChevronDown } from 'lucide-react-native';

type Row = {
  id: string;
  name: string | null;
  phone: string | null;
  desired_role: string | null;
  status: string;
  ai_rank_score: number | null;
  job_opening_title: string | null;
  resume_url: string | null;
  last_message_preview: string | null;
};

const STATUSES = ['new', 'reviewing', 'shortlisted', 'interview', 'offered', 'hired', 'rejected', 'withdrawn'];

const STATUS_TONE: Record<string, { bg: string; fg: string }> = {
  new: { bg: '#e0f2fe', fg: '#0369a1' },
  reviewing: { bg: '#fefce8', fg: '#ca8a04' },
  shortlisted: { bg: '#f5f3ff', fg: '#7c3aed' },
  interview: { bg: '#e0e7ff', fg: '#4338ca' },
  offered: { bg: '#fef4d5', fg: '#7a5600' },
  hired: { bg: '#dcfce7', fg: '#16a34a' },
  rejected: { bg: '#fef2f2', fg: '#dc2626' },
  withdrawn: { bg: '#eef0f4', fg: '#4b5563' },
};

export default function RecruitmentScreen() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('new');
  const [busy, setBusy] = useState<string | null>(null);

  const fetchRows = useCallback(async () => {
    const { data, error } = await (supabase as any)
      .from('job_applicants_inbox')
      .select('id, name, phone, desired_role, status, ai_rank_score, job_opening_title, resume_url, last_message_preview')
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .limit(200);
    if (error) console.warn('[recruitment]', error.message);
    setRows((data as Row[]) ?? []);
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => { fetchRows(); }, [fetchRows]);

  const onRefresh = () => { setRefreshing(true); fetchRows(); };

  async function move(row: Row, status: string) {
    setBusy(row.id);
    const { error } = await supabase.rpc('move_job_applicant' as any, {
      _applicant_id: row.id, _status: status, _note: null,
    });
    setBusy(null);
    if (error) { Alert.alert('Update failed', error.message); return; }
    fetchRows();
  }

  function pickStatus(row: Row) {
    Alert.alert(
      'Move applicant',
      row.name || 'Applicant',
      [
        ...STATUSES.filter((s) => s !== row.status).map((s) => ({
          text: s.replace(/_/g, ' '),
          onPress: () => move(row, s),
        })),
        { text: 'Cancel', style: 'cancel' as const },
      ],
    );
  }

  function openResume(row: Row) {
    if (!row.resume_url) { Alert.alert('No resume', 'This applicant has no resume on file.'); return; }
    Linking.openURL(row.resume_url).catch(() => Alert.alert('Cannot open', 'No app can open this file.'));
  }

  const filtered = rows.filter((r) => {
    if (statusFilter !== 'all' && r.status !== statusFilter) return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return [r.name, r.phone, r.desired_role, r.job_opening_title]
      .some((v) => (v || '').toLowerCase().includes(q));
  });

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.filters}>
        <View style={styles.searchBox}>
          <Search size={16} color={colors.textMuted} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search applicants…"
            placeholderTextColor={colors.textMuted}
            style={styles.searchInput}
          />
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips} contentContainerStyle={{ gap: 8, paddingHorizontal: 12 }}>
          {['all', ...STATUSES].map((s) => (
            <TouchableOpacity
              key={s}
              onPress={() => setStatusFilter(s)}
              style={[styles.chip, statusFilter === s && styles.chipActive]}
            >
              <Text style={[styles.chipText, statusFilter === s && styles.chipTextActive]}>{s.replace(/_/g, ' ')}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        {filtered.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>No applicants in this view</Text>
            <Text style={styles.emptyHint}>New job enquiries from WhatsApp and the careers portal land here.</Text>
          </View>
        ) : filtered.map((r) => {
          const tone = STATUS_TONE[r.status] ?? STATUS_TONE.withdrawn;
          return (
            <View key={r.id} style={styles.card}>
              <View style={{ flex: 1 }}>
                <View style={styles.cardHead}>
                  <Text style={styles.name}>{r.name || '—'}</Text>
                  {r.ai_rank_score != null && (
                    <View style={styles.aiBadge}>
                      <Sparkles size={10} color={colors.primary} />
                      <Text style={styles.aiText}>{Number(r.ai_rank_score).toFixed(0)}</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.sub}>
                  {r.desired_role || r.job_opening_title || '—'}
                  {r.phone ? ` · ${r.phone}` : ''}
                </Text>
                {!!r.last_message_preview && (
                  <Text style={styles.preview} numberOfLines={1}>{r.last_message_preview}</Text>
                )}
              </View>
              <View style={styles.actions}>
                <View style={[styles.statusTag, { backgroundColor: tone.bg }]}>
                  <Text style={[styles.statusText, { color: tone.fg }]}>{r.status}</Text>
                </View>
                <TouchableOpacity onPress={() => pickStatus(r)} disabled={busy === r.id} style={styles.iconBtn}>
                  {busy === r.id ? <ActivityIndicator size="small" color={colors.textMuted} /> : <ChevronDown size={16} color={colors.textSecondary} />}
                </TouchableOpacity>
                <TouchableOpacity onPress={() => openResume(r)} style={styles.iconBtn}>
                  <FileText size={16} color={colors.textSecondary} />
                </TouchableOpacity>
              </View>
            </View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  filters: { borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.card, paddingTop: 8, paddingBottom: 8, gap: 8 },
  searchBox: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 12, paddingHorizontal: 12, height: 40, borderRadius: radius.full, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border },
  searchInput: { flex: 1, marginLeft: 8, fontSize: 14, color: colors.text },
  chips: { flexGrow: 0 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.full, borderWidth: 1, borderColor: colors.border },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 12, color: colors.textSecondary, textTransform: 'capitalize' },
  chipTextActive: { color: '#fff', fontWeight: '600' },
  scroll: { padding: 16, paddingBottom: 100, gap: 10 },
  emptyCard: { backgroundColor: colors.card, borderRadius: radius.lg, padding: 32, alignItems: 'center', gap: 8, borderWidth: 1, borderColor: colors.cardBorder },
  emptyText: { fontSize: 14, fontWeight: '600', color: colors.textSecondary },
  emptyHint: { fontSize: 12, color: colors.textMuted, textAlign: 'center' },
  card: { flexDirection: 'row', gap: 12, backgroundColor: colors.card, borderRadius: radius.lg, padding: 14, borderWidth: 1, borderColor: colors.cardBorder },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { fontSize: 14, fontWeight: '700', color: colors.text },
  aiBadge: { flexDirection: 'row', alignItems: 'center', gap: 2, backgroundColor: colors.primaryLight, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1 },
  aiText: { fontSize: 10, fontWeight: '700', color: colors.primary },
  sub: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  preview: { fontSize: 11, color: colors.textMuted, marginTop: 3 },
  actions: { alignItems: 'flex-end', gap: 8 },
  statusTag: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  statusText: { fontSize: 10, fontWeight: '700', textTransform: 'capitalize' as any },
  iconBtn: { padding: 6 },
});
