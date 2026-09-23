import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, SafeAreaView,
  TouchableOpacity, TextInput, ActivityIndicator, RefreshControl, Alert,
} from 'react-native';
import { useAuth } from '../../../contexts/AuthContext';
import { supabase } from '../../../lib/supabase';
import { colors, radius } from '../../../constants/Colors';
import {
  IndianRupee, Wallet, CalendarClock,
} from 'lucide-react-native';

const fmtDays = (n: any) => {
  const v = Number(n || 0);
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
};

const money = (n: any) =>
  `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

const fmtDate = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

const STATUS_TONE: Record<string, { bg: string; fg: string }> = {
  requested: { bg: '#fefce8', fg: '#ca8a04' },
  approved: { bg: '#ecfdf5', fg: '#16a34a' },
  rejected: { bg: '#fef2f2', fg: '#dc2626' },
  paid: { bg: '#eff6ff', fg: '#1d4ed8' },
  cancelled: { bg: '#f4f4f5', fg: '#71717a' },
};

export default function EncashmentScreen() {
  const { user } = useAuth();
  const [profileId, setProfileId] = useState<string | null>(null);
  const [balances, setBalances] = useState<any[]>([]);
  const [encashments, setEncashments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [selectedTypeId, setSelectedTypeId] = useState<string | null>(null);
  const [days, setDays] = useState('');
  const [note, setNote] = useState('');

  const fetchAll = useCallback(async (pid: string) => {
    const [balRes, encRes] = await Promise.all([
      (supabase as any).rpc('my_leave_balances'),
      (supabase as any)
        .from('leave_encashments')
        .select('id, leave_type_id, leave_year, days, amount, status, requested_at, decision_note')
        .eq('employee_profile_id', pid)
        .order('requested_at', { ascending: false }),
    ]);
    if (balRes.error) Alert.alert('Could not load balances', balRes.error.message);
    if (encRes.error) Alert.alert('Could not load encashments', encRes.error.message);
    setBalances(balRes.data ?? []);
    setEncashments(encRes.data ?? []);
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

  const encashable = balances.filter((b: any) => Number(b.available) > 0);
  const selected = encashable.find((b: any) => b.leave_type_id === selectedTypeId) ?? encashable[0] ?? null;
  const labelFor = (typeId: string) =>
    (balances.find((b: any) => b.leave_type_id === typeId)?.leave_type) || 'Leave';

  const submit = async () => {
    if (!selected) { Alert.alert('Error', 'No leave type available to encash'); return; }
    const d = parseFloat(days);
    if (!d || d <= 0) { Alert.alert('Error', 'Enter number of days'); return; }
    if (d > Number(selected.available)) {
      Alert.alert('Error', `Only ${fmtDays(selected.available)} day(s) available`);
      return;
    }
    setSubmitting(true);
    const { error } = await (supabase as any).rpc('request_leave_encashment', {
      _leave_type_id: selected.leave_type_id,
      _days: d,
      _leave_year: selected.leave_year ?? new Date().getFullYear(),
      _note: note.trim() || null,
    });
    setSubmitting(false);
    if (error) { Alert.alert('Error', error.message); return; }
    Alert.alert('Success', 'Encashment request submitted');
    setDays('');
    setNote('');
    if (profileId) fetchAll(profileId);
  };

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
        <Text style={styles.title}>Encash unused leave</Text>
        <Text style={styles.subtitle}>Request a payout against your available balance</Text>

        <View style={styles.formCard}>
          {encashable.length === 0 ? (
            <Text style={styles.emptyInline}>No leave types with available balance.</Text>
          ) : (
            <>
              <Text style={styles.label}>Leave Type</Text>
              <View style={styles.typeRow}>
                {encashable.map((b: any) => {
                  const active = selected?.leave_type_id === b.leave_type_id;
                  return (
                    <TouchableOpacity
                      key={b.leave_type_id}
                      style={[styles.typeChip, active && styles.typeChipActive]}
                      onPress={() => setSelectedTypeId(b.leave_type_id)}
                    >
                      <Text style={[styles.typeChipText, active && { color: '#fff' }]}>
                        {b.leave_type}
                      </Text>
                      <Text style={[styles.typeChipSub, active && { color: '#fff' }]}>
                        {fmtDays(b.available)} left
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={styles.label}>Days</Text>
              <TextInput
                style={styles.input}
                placeholder="0"
                placeholderTextColor={colors.textMuted}
                keyboardType="numeric"
                value={days}
                onChangeText={setDays}
              />

              <Text style={styles.label}>Note (optional)</Text>
              <TextInput
                style={[styles.input, { height: 72, textAlignVertical: 'top' }]}
                placeholder="Reason or comment"
                placeholderTextColor={colors.textMuted}
                value={note}
                onChangeText={setNote}
                multiline
              />

              <TouchableOpacity
                style={[styles.submitBtn, submitting && { opacity: 0.5 }]}
                onPress={submit}
                disabled={submitting}
              >
                {submitting ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <>
                    <IndianRupee size={16} color="#fff" />
                    <Text style={styles.submitText}>Request Encashment</Text>
                  </>
                )}
              </TouchableOpacity>
            </>
          )}
        </View>

        <Text style={styles.sectionTitle}>Your Requests</Text>
        {encashments.length === 0 ? (
          <View style={styles.emptyCard}>
            <Wallet size={32} color={colors.textMuted} />
            <Text style={styles.emptyText}>No encashment requests yet</Text>
          </View>
        ) : (
          <View style={styles.listCard}>
            {encashments.map((e: any) => {
              const tone = STATUS_TONE[e.status] ?? STATUS_TONE.requested;
              return (
                <View key={e.id} style={styles.encRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.encTitle}>
                      {labelFor(e.leave_type_id)} · {fmtDays(e.days)} day{e.days > 1 ? 's' : ''}
                    </Text>
                    <View style={styles.encMeta}>
                      <CalendarClock size={11} color={colors.textMuted} />
                      <Text style={styles.encMetaText}>{fmtDate(e.requested_at)}</Text>
                    </View>
                    {!!e.decision_note && <Text style={styles.encNote}>{e.decision_note}</Text>}
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={styles.encAmount}>{money(e.amount)}</Text>
                    <View style={[styles.statusTag, { backgroundColor: tone.bg }]}>
                      <Text style={[styles.statusTagText, { color: tone.fg }]}>{e.status}</Text>
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

  title: { fontSize: 20, fontWeight: '700', color: colors.text, paddingTop: 8 },
  subtitle: { fontSize: 13, color: colors.textSecondary, marginTop: 2, marginBottom: 16 },

  formCard: {
    backgroundColor: colors.card, borderRadius: radius.lg, padding: 16, gap: 10,
    borderWidth: 1, borderColor: colors.cardBorder,
  },
  emptyInline: { fontSize: 13, color: colors.textMuted },
  label: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
  input: {
    backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, paddingHorizontal: 16, paddingVertical: 12,
    fontSize: 15, color: colors.text,
  },
  typeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  typeChip: {
    paddingVertical: 8, paddingHorizontal: 12, borderRadius: radius.sm,
    borderWidth: 1, borderColor: colors.border, alignItems: 'center',
  },
  typeChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  typeChipText: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
  typeChipSub: { fontSize: 10, color: colors.textMuted, marginTop: 1 },
  submitBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: colors.primary, borderRadius: radius.md, height: 50, marginTop: 4,
  },
  submitText: { color: '#fff', fontSize: 15, fontWeight: '700' },

  sectionTitle: { fontSize: 16, fontWeight: '700', color: colors.text, marginTop: 20, marginBottom: 12 },

  emptyCard: {
    backgroundColor: colors.card, borderRadius: radius.lg, padding: 32,
    alignItems: 'center', gap: 10, borderWidth: 1, borderColor: colors.cardBorder,
  },
  emptyText: { fontSize: 14, fontWeight: '600', color: colors.textSecondary },

  listCard: {
    backgroundColor: colors.card, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.cardBorder, overflow: 'hidden',
  },
  encRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: 14, borderBottomWidth: 1, borderBottomColor: colors.cardBorder,
  },
  encTitle: { fontSize: 13, fontWeight: '600', color: colors.text },
  encMeta: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  encMetaText: { fontSize: 11, color: colors.textMuted },
  encNote: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  encAmount: { fontSize: 13, fontWeight: '700', color: colors.text },
  statusTag: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2, marginTop: 4 },
  statusTagText: { fontSize: 10, fontWeight: '700', textTransform: 'capitalize' as any },
});
