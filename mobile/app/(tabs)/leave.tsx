import { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, SafeAreaView,
  TouchableOpacity, TextInput, ActivityIndicator, Alert,
  Modal, Platform,
} from 'react-native';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { colors, spacing, radius, typography } from '../../constants/Colors';
import {
  Plus, Clock, CheckCircle, XCircle, CalendarOff, X, ChevronDown,
} from 'lucide-react-native';

interface LeaveBalance {
  leave_type: string;
  total_days: number;
  used_days: number;
}

interface LeaveRequest {
  id: string;
  leave_type: string;
  start_date: string;
  end_date: string;
  days: number;
  reason: string | null;
  status: string;
  created_at: string;
}

const LEAVE_TYPES = ['casual', 'sick', 'earned'];
const LEAVE_COLORS: Record<string, string> = {
  casual: colors.primary,
  sick: colors.warning,
  earned: colors.success,
};

export default function LeaveScreen() {
  const { user } = useAuth();
  const [balances, setBalances] = useState<LeaveBalance[]>([]);
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [showApply, setShowApply] = useState(false);

  useEffect(() => { fetchData(); }, []);

  const fetchData = async () => {
    setLoading(true);
    const year = new Date().getFullYear();

    const [balRes, reqRes] = await Promise.all([
      supabase.from('employee_leave_balances')
        .select('leave_type, total_days, used_days')
        .eq('user_id', user?.id)
        .eq('year', year),
      supabase.from('employee_leave_requests')
        .select('*')
        .eq('user_id', user?.id)
        .order('created_at', { ascending: false })
        .limit(20),
    ]);

    if (balRes.data) setBalances(balRes.data);
    if (reqRes.data) setRequests(reqRes.data as LeaveRequest[]);
    setLoading(false);
  };

  const StatusIcon = ({ status }: { status: string }) => {
    if (status === 'approved') return <CheckCircle size={16} color={colors.success} />;
    if (status === 'rejected') return <XCircle size={16} color={colors.destructive} />;
    return <Clock size={16} color={colors.warning} />;
  };

  const statusColor = (s: string) =>
    s === 'approved' ? colors.success : s === 'rejected' ? colors.destructive : colors.warning;

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={styles.title}>Leave</Text>
          <TouchableOpacity style={styles.applyBtn} onPress={() => setShowApply(true)} activeOpacity={0.8}>
            <Plus size={16} color="#fff" />
            <Text style={styles.applyBtnText}>Apply</Text>
          </TouchableOpacity>
        </View>

        {/* Balance cards */}
        <View style={styles.balanceRow}>
          {LEAVE_TYPES.map((type) => {
            const bal = balances.find(b => b.leave_type === type);
            const remaining = (bal?.total_days || 0) - (bal?.used_days || 0);
            return (
              <View key={type} style={styles.balanceCard}>
                <Text style={styles.balanceLabel}>{type.charAt(0).toUpperCase() + type.slice(1)}</Text>
                <Text style={[styles.balanceValue, { color: LEAVE_COLORS[type] || colors.primary }]}>
                  {remaining}
                </Text>
                <Text style={styles.balanceSub}>of {bal?.total_days || 0}</Text>
              </View>
            );
          })}
        </View>

        {/* Requests */}
        <Text style={styles.sectionTitle}>Recent Requests</Text>
        {requests.length === 0 ? (
          <View style={styles.emptyCard}>
            <CalendarOff size={32} color={colors.textMuted} />
            <Text style={styles.emptyText}>No leave requests yet</Text>
          </View>
        ) : (
          <View style={styles.requestList}>
            {requests.map((req) => (
              <View key={req.id} style={styles.requestItem}>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <Text style={styles.requestType}>{req.leave_type.charAt(0).toUpperCase() + req.leave_type.slice(1)}</Text>
                    <View style={[styles.statusBadge, { backgroundColor: statusColor(req.status) + '20' }]}>
                      <StatusIcon status={req.status} />
                      <Text style={[styles.statusText, { color: statusColor(req.status) }]}>{req.status}</Text>
                    </View>
                  </View>
                  <Text style={styles.requestDates}>
                    {new Date(req.start_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                    {req.start_date !== req.end_date && ` — ${new Date(req.end_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`}
                    {' '}({req.days} day{req.days > 1 ? 's' : ''})
                  </Text>
                  {req.reason && <Text style={styles.requestReason}>{req.reason}</Text>}
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      {/* Apply Leave Modal */}
      <ApplyLeaveModal
        visible={showApply}
        onClose={() => setShowApply(false)}
        onSuccess={() => { setShowApply(false); fetchData(); }}
        userId={user?.id || ''}
      />
    </SafeAreaView>
  );
}

function ApplyLeaveModal({ visible, onClose, onSuccess, userId }: {
  visible: boolean; onClose: () => void; onSuccess: () => void; userId: string;
}) {
  const [leaveType, setLeaveType] = useState('casual');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!startDate) { Alert.alert('Error', 'Enter start date (YYYY-MM-DD)'); return; }
    const start = new Date(startDate);
    const end = endDate ? new Date(endDate) : start;
    const days = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1);

    setSubmitting(true);
    const { error } = await supabase.from('employee_leave_requests').insert({
      user_id: userId,
      leave_type: leaveType,
      start_date: startDate,
      end_date: endDate || startDate,
      days,
      reason: reason || null,
    });

    if (error) {
      Alert.alert('Error', error.message);
    } else {
      Alert.alert('Success', 'Leave request submitted');
      onSuccess();
    }
    setSubmitting(false);
  };

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={modalStyles.overlay}>
        <View style={modalStyles.sheet}>
          <View style={modalStyles.header}>
            <Text style={modalStyles.title}>Apply for Leave</Text>
            <TouchableOpacity onPress={onClose}><X size={24} color={colors.textSecondary} /></TouchableOpacity>
          </View>

          <ScrollView style={{ gap: 16 }} contentContainerStyle={{ gap: 16, paddingBottom: 24 }}>
            <View>
              <Text style={modalStyles.label}>Leave Type</Text>
              <View style={modalStyles.typeRow}>
                {LEAVE_TYPES.map((t) => (
                  <TouchableOpacity
                    key={t}
                    style={[modalStyles.typeChip, leaveType === t && modalStyles.typeChipActive]}
                    onPress={() => setLeaveType(t)}
                  >
                    <Text style={[modalStyles.typeChipText, leaveType === t && { color: '#fff' }]}>
                      {t.charAt(0).toUpperCase() + t.slice(1)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <View>
              <Text style={modalStyles.label}>Start Date</Text>
              <TextInput
                style={modalStyles.input}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={colors.textMuted}
                value={startDate}
                onChangeText={setStartDate}
              />
            </View>

            <View>
              <Text style={modalStyles.label}>End Date (optional for single day)</Text>
              <TextInput
                style={modalStyles.input}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={colors.textMuted}
                value={endDate}
                onChangeText={setEndDate}
              />
            </View>

            <View>
              <Text style={modalStyles.label}>Reason</Text>
              <TextInput
                style={[modalStyles.input, { height: 80, textAlignVertical: 'top' }]}
                placeholder="Optional"
                placeholderTextColor={colors.textMuted}
                value={reason}
                onChangeText={setReason}
                multiline
              />
            </View>

            <TouchableOpacity
              style={[modalStyles.submitBtn, submitting && { opacity: 0.5 }]}
              onPress={submit}
              disabled={submitting}
            >
              {submitting ? <ActivityIndicator color="#fff" size="small" /> : <Text style={modalStyles.submitText}>Submit Request</Text>}
            </TouchableOpacity>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: 16, paddingBottom: 100 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, paddingTop: 8 },
  title: { fontSize: 24, fontWeight: '700', color: colors.text, letterSpacing: -0.5 },
  applyBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: colors.primary, borderRadius: 12,
    paddingHorizontal: 16, paddingVertical: 10,
  },
  applyBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  balanceRow: { flexDirection: 'row', gap: 10, marginBottom: 24 },
  balanceCard: {
    flex: 1, backgroundColor: colors.card, borderRadius: 16,
    padding: 16, alignItems: 'center',
    borderWidth: 1, borderColor: colors.cardBorder,
  },
  balanceLabel: { fontSize: 12, fontWeight: '500', color: colors.textSecondary },
  balanceValue: { fontSize: 28, fontWeight: '700', marginTop: 4 },
  balanceSub: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  sectionTitle: { fontSize: 16, fontWeight: '600', color: colors.text, marginBottom: 12 },
  emptyCard: {
    backgroundColor: colors.card, borderRadius: 16,
    padding: 32, alignItems: 'center', gap: 12,
    borderWidth: 1, borderColor: colors.cardBorder,
  },
  emptyText: { fontSize: 14, color: colors.textMuted },
  requestList: {
    backgroundColor: colors.card, borderRadius: 16,
    borderWidth: 1, borderColor: colors.cardBorder, overflow: 'hidden',
  },
  requestItem: {
    flexDirection: 'row', alignItems: 'center', padding: 16,
    borderBottomWidth: 1, borderBottomColor: colors.cardBorder,
  },
  requestType: { fontSize: 14, fontWeight: '600', color: colors.text },
  statusBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  statusText: { fontSize: 11, fontWeight: '600', textTransform: 'capitalize' },
  requestDates: { fontSize: 13, color: colors.textSecondary },
  requestReason: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
});

const modalStyles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    backgroundColor: colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 24, paddingTop: 20, maxHeight: '85%',
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  title: { fontSize: 18, fontWeight: '700', color: colors.text },
  label: { fontSize: 14, fontWeight: '600', color: colors.text, marginBottom: 8 },
  input: {
    backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border,
    borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12,
    fontSize: 15, color: colors.text,
  },
  typeRow: { flexDirection: 'row', gap: 8 },
  typeChip: {
    flex: 1, paddingVertical: 10, borderRadius: 10,
    borderWidth: 1, borderColor: colors.border, alignItems: 'center',
  },
  typeChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  typeChipText: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
  submitBtn: {
    backgroundColor: colors.primary, borderRadius: 12,
    height: 52, alignItems: 'center', justifyContent: 'center',
  },
  submitText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
