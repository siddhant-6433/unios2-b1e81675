import { useState, useEffect, useCallback, type ReactNode } from 'react';
import {
  View, Text, StyleSheet, ScrollView, SafeAreaView,
  TouchableOpacity, ActivityIndicator, RefreshControl,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useAuth } from '../../../contexts/AuthContext';
import { supabase } from '../../../lib/supabase';
import { colors, radius } from '../../../constants/Colors';
import { Clock, History, CheckCircle2, XCircle, AlertCircle } from 'lucide-react-native';

type Tab = 'logs' | 'corrections';

const fmtDate = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }) : '—';

const fmtTime = (t?: string | null) =>
  t ? new Date(t).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }) : '—';

const hoursBetween = (inAt?: string | null, outAt?: string | null) => {
  if (!inAt || !outAt) return '—';
  const ms = new Date(outAt).getTime() - new Date(inAt).getTime();
  if (ms <= 0) return '—';
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return `${h}h ${m}m`;
};

const STATUS_TONE: Record<string, { bg: string; fg: string }> = {
  pending: { bg: '#fefce8', fg: '#ca8a04' },
  approved: { bg: '#ecfdf5', fg: '#16a34a' },
  rejected: { bg: '#fef2f2', fg: '#dc2626' },
};

export default function AttendanceLogsScreen() {
  const { user } = useAuth();
  const params = useLocalSearchParams<{ tab?: string }>();
  const [tab, setTab] = useState<Tab>(params.tab === 'corrections' ? 'corrections' : 'logs');
  const [logs, setLogs] = useState<any[]>([]);
  const [corrections, setCorrections] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async (uid: string) => {
    const since = new Date();
    since.setDate(since.getDate() - 45);
    const [logsRes, correctionsRes] = await Promise.all([
      supabase
        .from('employee_attendance')
        .select('id, date, punch_in, punch_out')
        .eq('user_id', uid)
        .gte('date', since.toISOString().slice(0, 10))
        .order('date', { ascending: false }),
      (supabase as any)
        .from('attendance_regularisations')
        .select('id, date, requested_punch_in, requested_punch_out, reason, status, created_at')
        .eq('user_id', uid)
        .order('created_at', { ascending: false }),
    ]);
    setLogs(logsRes.data ?? []);
    setCorrections(correctionsRes.data ?? []);
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    if (!user?.id) { setLoading(false); return; }
    fetchData(user.id);
  }, [user?.id, fetchData]);

  const onRefresh = () => { if (user?.id) { setRefreshing(true); fetchData(user.id); } };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.tabBar}>
        {([['logs', 'Logs & shifts'], ['corrections', 'Corrections']] as [Tab, string][]).map(([v, label]) => (
          <TouchableOpacity
            key={v}
            style={[styles.tab, tab === v && styles.tabActive]}
            onPress={() => setTab(v)}
          >
            <Text style={[styles.tabText, tab === v && styles.tabTextActive]}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        {tab === 'logs' ? (
          logs.length === 0 ? (
            <Empty icon={<Clock size={32} color={colors.textMuted} />} text="No attendance logs yet" hint="Your punches from the last 45 days appear here" />
          ) : (
            <View style={{ gap: 10 }}>
              {logs.map((a) => (
                <View key={a.id ?? `${a.date}-${a.punch_in ?? ''}`} style={styles.card}>
                  <View style={styles.cardIcon}><Clock size={18} color={colors.primary} /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardTitle}>{fmtDate(a.date)}</Text>
                    <Text style={styles.cardSub}>{fmtTime(a.punch_in)} → {fmtTime(a.punch_out)}</Text>
                  </View>
                  <Text style={styles.hours}>{hoursBetween(a.punch_in, a.punch_out)}</Text>
                </View>
              ))}
            </View>
          )
        ) : corrections.length === 0 ? (
          <Empty icon={<History size={32} color={colors.textMuted} />} text="No correction requests" hint="Raise a correction from My HR → Requests" />
        ) : (
          <View style={{ gap: 10 }}>
            {corrections.map((c) => {
              const tone = STATUS_TONE[c.status] ?? STATUS_TONE.pending;
              const Icon = c.status === 'approved' ? CheckCircle2 : c.status === 'rejected' ? XCircle : AlertCircle;
              return (
                <View key={c.id} style={styles.card}>
                  <View style={styles.cardIcon}><Icon size={18} color={tone.fg} /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardTitle}>{fmtDate(c.date)}</Text>
                    <Text style={styles.cardSub}>
                      {fmtTime(c.requested_punch_in)} → {fmtTime(c.requested_punch_out)}
                    </Text>
                    {!!c.reason && <Text style={styles.reason} numberOfLines={2}>{c.reason}</Text>}
                  </View>
                  <View style={[styles.statusTag, { backgroundColor: tone.bg }]}>
                    <Text style={[styles.statusTagText, { color: tone.fg }]}>{c.status}</Text>
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Empty({ icon, text, hint }: { icon: ReactNode; text: string; hint: string }) {
  return (
    <View style={styles.emptyCard}>
      {icon}
      <Text style={styles.emptyText}>{text}</Text>
      <Text style={styles.emptyHint}>{hint}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  scroll: { padding: 16, paddingBottom: 100 },
  tabBar: {
    flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 8,
    borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.card,
  },
  tab: { flex: 1, paddingVertical: 10, borderRadius: radius.md, alignItems: 'center', borderWidth: 1, borderColor: colors.border },
  tabActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  tabText: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
  tabTextActive: { color: '#fff' },

  emptyCard: {
    backgroundColor: colors.card, borderRadius: radius.lg, padding: 32,
    alignItems: 'center', gap: 10, borderWidth: 1, borderColor: colors.cardBorder,
  },
  emptyText: { fontSize: 14, fontWeight: '600', color: colors.textSecondary },
  emptyHint: { fontSize: 12, color: colors.textMuted, textAlign: 'center' },

  card: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: colors.card, borderRadius: radius.lg, padding: 14,
    borderWidth: 1, borderColor: colors.cardBorder,
  },
  cardIcon: {
    width: 40, height: 40, borderRadius: radius.full,
    backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center',
  },
  cardTitle: { fontSize: 14, fontWeight: '700', color: colors.text },
  cardSub: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  reason: { fontSize: 11, color: colors.textMuted, marginTop: 3 },
  hours: { fontSize: 13, fontWeight: '700', color: colors.text },
  statusTag: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  statusTagText: { fontSize: 10, fontWeight: '700', textTransform: 'capitalize' as any },
});
