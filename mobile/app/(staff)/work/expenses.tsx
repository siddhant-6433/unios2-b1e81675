import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, SafeAreaView,
  TouchableOpacity, TextInput, ActivityIndicator, RefreshControl, Modal, Alert,
} from 'react-native';
import { useAuth } from '../../../contexts/AuthContext';
import { supabase } from '../../../lib/supabase';
import { colors, radius } from '../../../constants/Colors';
import {
  Briefcase, Plus, X, Receipt, History,
} from 'lucide-react-native';

const money = (n: any) =>
  `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

const fmtDate = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

const today = () => new Date().toISOString().slice(0, 10);

const STATUS_TONE: Record<string, { bg: string; fg: string }> = {
  draft: { bg: '#f4f4f5', fg: '#52525b' },
  submitted: { bg: '#fefce8', fg: '#ca8a04' },
  approved: { bg: '#ecfdf5', fg: '#16a34a' },
  rejected: { bg: '#fef2f2', fg: '#dc2626' },
  reimbursed: { bg: '#eff6ff', fg: '#1d4ed8' },
  cancelled: { bg: '#f4f4f5', fg: '#71717a' },
};

export default function ExpensesScreen() {
  const { user } = useAuth();
  const [profileId, setProfileId] = useState<string | null>(null);
  const [claims, setClaims] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showNew, setShowNew] = useState(false);

  const fetchClaims = useCallback(async (pid: string) => {
    const { data, error } = await (supabase as any)
      .from('expense_claims')
      .select('id, title, amount, expense_date, description, status, created_at')
      .eq('employee_profile_id', pid)
      .order('expense_date', { ascending: false });
    if (error) Alert.alert('Could not load claims', error.message);
    setClaims(data ?? []);
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
      if (pid) await fetchClaims(pid);
      else setLoading(false);
    })();
  }, [user?.id, fetchClaims]);

  const onRefresh = () => { if (profileId) { setRefreshing(true); fetchClaims(profileId); } };

  const onSuccess = () => {
    setShowNew(false);
    if (profileId) fetchClaims(profileId);
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
        <TouchableOpacity style={styles.newBtn} onPress={() => setShowNew(true)} activeOpacity={0.8}>
          <Plus size={18} color="#fff" />
          <Text style={styles.newBtnText}>New claim</Text>
        </TouchableOpacity>

        {!profileId ? (
          <View style={styles.emptyCard}>
            <Briefcase size={32} color={colors.textMuted} />
            <Text style={styles.emptyText}>No employee record</Text>
            <Text style={styles.emptyHint}>Contact HR to link your staff profile</Text>
          </View>
        ) : claims.length === 0 ? (
          <View style={styles.emptyCard}>
            <Receipt size={32} color={colors.textMuted} />
            <Text style={styles.emptyText}>No expense claims yet</Text>
            <Text style={styles.emptyHint}>Tap “New claim” to submit one</Text>
          </View>
        ) : (
          <View style={{ gap: 10 }}>
            {claims.map((c: any) => {
              const tone = STATUS_TONE[c.status] ?? STATUS_TONE.submitted;
              return (
                <View key={c.id} style={styles.card}>
                  <View style={styles.cardIcon}>
                    <History size={18} color={colors.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={styles.cardHead}>
                      <Text style={styles.cardTitle}>{c.title}</Text>
                      <View style={[styles.statusTag, { backgroundColor: tone.bg }]}>
                        <Text style={[styles.statusTagText, { color: tone.fg }]}>{c.status}</Text>
                      </View>
                    </View>
                    <Text style={styles.cardSub}>{fmtDate(c.expense_date)}</Text>
                    {!!c.description && <Text style={styles.cardDesc}>{c.description}</Text>}
                  </View>
                  <Text style={styles.amount}>{money(c.amount)}</Text>
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>

      <NewClaimModal
        visible={showNew}
        onClose={() => setShowNew(false)}
        onSuccess={onSuccess}
        profileId={profileId}
        userId={user?.id || ''}
      />
    </SafeAreaView>
  );
}

function NewClaimModal({ visible, onClose, onSuccess, profileId, userId }: {
  visible: boolean; onClose: () => void; onSuccess: () => void;
  profileId: string | null; userId: string;
}) {
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [expenseDate, setExpenseDate] = useState(today());
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!profileId) { Alert.alert('Error', 'No employee record found'); return; }
    if (!title.trim()) { Alert.alert('Error', 'Enter a title'); return; }
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { Alert.alert('Error', 'Enter a valid amount'); return; }
    if (!expenseDate) { Alert.alert('Error', 'Enter expense date (YYYY-MM-DD)'); return; }

    setSubmitting(true);
    const { error } = await (supabase as any).from('expense_claims').insert({
      employee_profile_id: profileId,
      submitted_by: userId,
      title: title.trim(),
      amount: amt,
      expense_date: expenseDate,
      description: description.trim() || null,
      status: 'submitted',
    });
    setSubmitting(false);
    if (error) { Alert.alert('Error', error.message); return; }
    Alert.alert('Success', 'Expense claim submitted');
    setTitle(''); setAmount(''); setExpenseDate(today()); setDescription('');
    onSuccess();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>New Expense Claim</Text>
            <TouchableOpacity onPress={onClose}><X size={24} color={colors.textSecondary} /></TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={{ gap: 16, paddingBottom: 24 }}>
            <View>
              <Text style={styles.label}>Title</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. Client lunch"
                placeholderTextColor={colors.textMuted}
                value={title}
                onChangeText={setTitle}
              />
            </View>
            <View>
              <Text style={styles.label}>Amount (₹)</Text>
              <TextInput
                style={styles.input}
                placeholder="0"
                placeholderTextColor={colors.textMuted}
                keyboardType="numeric"
                value={amount}
                onChangeText={setAmount}
              />
            </View>
            <View>
              <Text style={styles.label}>Expense Date</Text>
              <TextInput
                style={styles.input}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={colors.textMuted}
                value={expenseDate}
                onChangeText={setExpenseDate}
              />
            </View>
            <View>
              <Text style={styles.label}>Description</Text>
              <TextInput
                style={[styles.input, { height: 80, textAlignVertical: 'top' }]}
                placeholder="Optional"
                placeholderTextColor={colors.textMuted}
                value={description}
                onChangeText={setDescription}
                multiline
              />
            </View>

            <TouchableOpacity
              style={[styles.submitBtn, submitting && { opacity: 0.5 }]}
              onPress={submit}
              disabled={submitting}
            >
              {submitting ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.submitText}>Submit Claim</Text>}
            </TouchableOpacity>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  scroll: { padding: 16, paddingBottom: 100 },

  newBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: colors.primary, borderRadius: radius.md, height: 48, marginBottom: 16,
  },
  newBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },

  emptyCard: {
    backgroundColor: colors.card, borderRadius: radius.lg, padding: 32,
    alignItems: 'center', gap: 10, borderWidth: 1, borderColor: colors.cardBorder,
  },
  emptyText: { fontSize: 14, fontWeight: '600', color: colors.textSecondary },
  emptyHint: { fontSize: 12, color: colors.textMuted },

  card: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: colors.card, borderRadius: radius.lg, padding: 14,
    borderWidth: 1, borderColor: colors.cardBorder,
  },
  cardIcon: {
    width: 36, height: 36, borderRadius: radius.full,
    backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center',
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  cardTitle: { fontSize: 15, fontWeight: '700', color: colors.text },
  cardSub: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  cardDesc: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  statusTag: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  statusTagText: { fontSize: 10, fontWeight: '700', textTransform: 'capitalize' as any },
  amount: { fontSize: 15, fontWeight: '700', color: colors.text },

  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    backgroundColor: colors.card, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
    paddingHorizontal: 24, paddingTop: 20, maxHeight: '85%',
  },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  sheetTitle: { fontSize: 18, fontWeight: '700', color: colors.text },
  label: { fontSize: 14, fontWeight: '600', color: colors.text, marginBottom: 8 },
  input: {
    backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, paddingHorizontal: 16, paddingVertical: 12,
    fontSize: 15, color: colors.text,
  },
  submitBtn: {
    backgroundColor: colors.primary, borderRadius: radius.md,
    height: 52, alignItems: 'center', justifyContent: 'center',
  },
  submitText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
