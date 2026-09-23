import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, SafeAreaView,
  ActivityIndicator, RefreshControl, Alert,
} from 'react-native';
import { useAuth } from '../../../contexts/AuthContext';
import { supabase } from '../../../lib/supabase';
import { colors, radius } from '../../../constants/Colors';
import {
  Clock, CalendarClock, Hourglass, CheckCircle2,
} from 'lucide-react-native';

const fmtDays = (n: any) => {
  const v = Number(n || 0);
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
};

const fmtDate = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

const STATUS_TONE: Record<string, { bg: string; fg: string }> = {
  pending: { bg: '#fefce8', fg: '#ca8a04' },
  approved: { bg: '#ecfdf5', fg: '#16a34a' },
  used: { bg: '#eff6ff', fg: '#1d4ed8' },
  rejected: { bg: '#fef2f2', fg: '#dc2626' },
  expired: { bg: '#f4f4f5', fg: '#71717a' },
};

export default function CompOffScreen() {
  const { user } = useAuth();
  const [profileId, setProfileId] = useState<string | null>(null);
  const [summary, setSummary] = useState<any | null>(null);
  const [credits, setCredits] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchAll = useCallback(async (pid: string) => {
    const [sumRes, creditRes] = await Promise.all([
      (supabase as any).rpc('my_comp_off'),
      (supabase as any)
        .from('comp_off_credits')
        .select('id, earned_on, days, used_days, remaining, status, expires_on')
        .eq('employee_profile_id', pid)
        .order('earned_on', { ascending: false }),
    ]);
    if (sumRes.error) Alert.alert('Could not load comp-off', sumRes.error.message);
    if (creditRes.error) Alert.alert('Could not load credits', creditRes.error.message);
    setSummary((sumRes.data ?? [])[0] ?? null);
    setCredits(creditRes.data ?? []);
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    (async () => {
      if (!user?.id) { setLoading(false); return; }
      const { data } = await supabase
        .from('employee_profiles')
        .select('id')
        .eq('user_id', user.id)
        .maybeSingle();
      const pid = (data as any)?.id ?? null;
      setProfileId(pid);
      if (pid) await fetchAll(pid);
      else setLoading(false);
    })();
  }, [user?.id, fetchAll]);

  const onRefresh = () => { if (profileId) { setRefreshing(true); fetchAll(profileId); } };

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
        <View style={styles.balanceRow}>
          <View style={styles.balanceCard}>
            <Hourglass size={18} color={colors.primary} />
            <Text style={[styles.balanceValue, { color: colors.primary }]}>{fmtDays(summary?.available_days)}</Text>
            <Text style={styles.balanceLabel}>Available</Text>
          </View>
          <View style={styles.balanceCard}>
            <CheckCircle2 size={18} color={colors.success} />
            <Text style={[styles.balanceValue, { color: colors.success }]}>{fmtDays(summary?.approved_days)}</Text>
            <Text style={styles.balanceLabel}>Approved</Text>
          </View>
          <View style={styles.balanceCard}>
            <Clock size={18} color={colors.warning} />
            <Text style={[styles.balanceValue, { color: colors.warning }]}>{fmtDays(summary?.used_days)}</Text>
            <Text style={styles.balanceLabel}>Used</Text>
          </View>
        </View>

        <View style={styles.expiryCard}>
          <CalendarClock size={16} color={colors.textSecondary} />
          <Text style={styles.expiryText}>
            Next expiry: {summary?.next_expiry ? fmtDate(summary.next_expiry) : 'None'}
          </Text>
        </View>

        <Text style={styles.sectionTitle}>Credits</Text>
        {credits.length === 0 ? (
          <View style={styles.emptyCard}>
            <Hourglass size={32} color={colors.textMuted} />
            <Text style={styles.emptyText}>No comp-off credits yet</Text>
            <Text style={styles.emptyHint}>Approved overtime earns comp-off</Text>
          </View>
        ) : (
          <View style={styles.listCard}>
            {credits.map((c: any) => {
              const tone = STATUS_TONE[c.status] ?? STATUS_TONE.pending;
              return (
                <View key={c.id} style={styles.creditRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.creditTitle}>Earned {fmtDate(c.earned_on)}</Text>
                    <Text style={styles.creditSub}>
                      {fmtDays(c.days)} day{c.days > 1 ? 's' : ''} · {fmtDays(c.used_days)} used · expires {fmtDate(c.expires_on)}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={styles.creditRemaining}>{fmtDays(c.remaining)} left</Text>
                    <View style={[styles.statusTag, { backgroundColor: tone.bg }]}>
                      <Text style={[styles.statusTagText, { color: tone.fg }]}>{c.status}</Text>
                    </View>
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  scroll: { padding: 16, paddingBottom: 100 },

  balanceRow: { flexDirection: 'row', gap: 10 },
  balanceCard: {
    flex: 1, backgroundColor: colors.card, borderRadius: radius.lg, padding: 14,
    alignItems: 'center', gap: 4, borderWidth: 1, borderColor: colors.cardBorder,
  },
  balanceValue: { fontSize: 24, fontWeight: '700' },
  balanceLabel: { fontSize: 11, color: colors.textSecondary },

  expiryCard: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12,
    backgroundColor: colors.card, borderRadius: radius.md, padding: 14,
    borderWidth: 1, borderColor: colors.cardBorder,
  },
  expiryText: { fontSize: 13, color: colors.textSecondary },

  sectionTitle: { fontSize: 16, fontWeight: '700', color: colors.text, marginTop: 20, marginBottom: 12 },

  emptyCard: {
    backgroundColor: colors.card, borderRadius: radius.lg, padding: 32,
    alignItems: 'center', gap: 10, borderWidth: 1, borderColor: colors.cardBorder,
  },
  emptyText: { fontSize: 14, fontWeight: '600', color: colors.textSecondary },
  emptyHint: { fontSize: 12, color: colors.textMuted },

  listCard: {
    backgroundColor: colors.card, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.cardBorder, overflow: 'hidden',
  },
  creditRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: 14, borderBottomWidth: 1, borderBottomColor: colors.cardBorder,
  },
  creditTitle: { fontSize: 13, fontWeight: '600', color: colors.text },
  creditSub: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  creditRemaining: { fontSize: 13, fontWeight: '700', color: colors.text },
  statusTag: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2, marginTop: 4 },
  statusTagText: { fontSize: 10, fontWeight: '700', textTransform: 'capitalize' as any },
});
