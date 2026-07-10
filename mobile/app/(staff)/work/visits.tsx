import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, SafeAreaView,
  TouchableOpacity, ActivityIndicator, RefreshControl,
} from 'react-native';
import { router } from 'expo-router';
import { supabase } from '../../../lib/supabase';
import { colors } from '../../../constants/Colors';
import {
  Calendar, MapPin, Footprints, ChevronRight, UserPlus, DoorOpen,
} from 'lucide-react-native';

interface VisitRow {
  id: string;
  lead_id: string;
  visit_date: string;
  status: string;
  visit_type: string | null;
  checked_in_at: string | null;
  purpose: string | null;
  lead_name: string;
  lead_phone: string;
  campus_name: string;
}

const STATUS_TONE: Record<string, { bg: string; fg: string }> = {
  scheduled: { bg: '#eff6ff', fg: '#1d4ed8' },
  confirmed: { bg: '#f0fdfa', fg: '#0f766e' },
  completed: { bg: '#ecfdf5', fg: '#047857' },
  no_show: { bg: '#fef2f2', fg: '#b91c1c' },
};

function fmtTime(iso: string) {
  return new Date(iso).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true,
  });
}

export default function VisitsScreen() {
  const [visits, setVisits] = useState<VisitRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchVisits = useCallback(async () => {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const end = new Date(Date.now() + 14 * 86400000);
    const { data } = await supabase
      .from('campus_visits')
      .select(`id, lead_id, visit_date, status, visit_type, checked_in_at, purpose,
        leads!inner(name, phone), campuses(name)`)
      .gte('visit_date', start.toISOString())
      .lte('visit_date', end.toISOString())
      .in('status', ['scheduled', 'confirmed'])
      .order('visit_date', { ascending: true });
    setVisits((data ?? []).map((r: any) => ({
      id: r.id,
      lead_id: r.lead_id,
      visit_date: r.visit_date,
      status: r.status,
      visit_type: r.visit_type,
      checked_in_at: r.checked_in_at,
      purpose: r.purpose,
      lead_name: r.leads?.name ?? '—',
      lead_phone: r.leads?.phone ?? '',
      campus_name: r.campuses?.name ?? '—',
    })));
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => { fetchVisits(); }, [fetchVisits]);

  const onRefresh = () => { setRefreshing(true); fetchVisits(); };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        <Text style={styles.title}>Visits</Text>
        <Text style={styles.subtitle}>Today &amp; upcoming campus visits</Text>

        <TouchableOpacity style={styles.walkInBtn} onPress={() => router.push('/(staff)/work/walk-in' as any)}>
          <UserPlus size={18} color="#fff" />
          <Text style={styles.walkInText}>Record Walk-in</Text>
        </TouchableOpacity>

        {visits.length === 0 ? (
          <View style={styles.emptyCard}>
            <DoorOpen size={32} color={colors.textMuted} />
            <Text style={styles.emptyText}>No upcoming visits</Text>
            <Text style={styles.emptyHint}>Record a walk-in to get started</Text>
          </View>
        ) : (
          <View style={{ gap: 10 }}>
            {visits.map((v) => {
              const tone = STATUS_TONE[v.status] ?? STATUS_TONE.scheduled;
              return (
                <TouchableOpacity
                  key={v.id}
                  style={styles.card}
                  onPress={() => router.push(`/(staff)/work/visit/${v.id}` as any)}
                >
                  <View style={{ flex: 1 }}>
                    <View style={styles.cardHead}>
                      <Text style={styles.leadName}>{v.lead_name}</Text>
                      {v.visit_type === 'walk_in' && (
                        <View style={styles.walkTag}>
                          <Footprints size={10} color="#7c3aed" />
                          <Text style={styles.walkTagText}>Walk-in</Text>
                        </View>
                      )}
                      <View style={[styles.statusTag, { backgroundColor: tone.bg }]}>
                        <Text style={[styles.statusTagText, { color: tone.fg }]}>{v.status}</Text>
                      </View>
                    </View>
                    <View style={styles.metaRow}>
                      <Calendar size={12} color={colors.textMuted} />
                      <Text style={styles.metaText}>{fmtTime(v.visit_date)}</Text>
                      <MapPin size={12} color={colors.textMuted} />
                      <Text style={styles.metaText}>{v.campus_name}</Text>
                    </View>
                    {v.checked_in_at && <Text style={styles.checkedIn}>Checked in</Text>}
                  </View>
                  <ChevronRight size={18} color={colors.textMuted} />
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  scroll: { padding: 16, paddingBottom: 100 },
  title: { fontSize: 24, fontWeight: '700', color: colors.text, paddingTop: 8 },
  subtitle: { fontSize: 14, color: colors.textSecondary, marginTop: 2, marginBottom: 16 },

  walkInBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: colors.primary, borderRadius: 12, height: 48, marginBottom: 16,
  },
  walkInText: { color: '#fff', fontWeight: '700', fontSize: 15 },

  emptyCard: {
    backgroundColor: colors.card, borderRadius: 16, padding: 32,
    alignItems: 'center', gap: 10, borderWidth: 1, borderColor: colors.cardBorder,
  },
  emptyText: { fontSize: 14, fontWeight: '600', color: colors.textSecondary },
  emptyHint: { fontSize: 12, color: colors.textMuted },

  card: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: colors.card, borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: colors.cardBorder,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  leadName: { fontSize: 15, fontWeight: '700', color: colors.text },
  walkTag: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: '#f5f3ff', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2,
  },
  walkTagText: { fontSize: 10, fontWeight: '700', color: '#7c3aed' },
  statusTag: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  statusTagText: { fontSize: 10, fontWeight: '700', textTransform: 'capitalize' as any },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 6, flexWrap: 'wrap' },
  metaText: { fontSize: 12, color: colors.textSecondary, marginRight: 6 },
  checkedIn: { fontSize: 11, fontWeight: '600', color: colors.success, marginTop: 4 },
});
