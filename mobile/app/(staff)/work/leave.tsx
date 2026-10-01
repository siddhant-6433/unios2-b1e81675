import { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, SafeAreaView,
  TouchableOpacity, ActivityIndicator,
} from 'react-native';
import { useAuth } from '../../../contexts/AuthContext';
import { supabase } from '../../../lib/supabase';
import { colors, spacing, radius, typography } from '../../../constants/Colors';
import { ApplyLeaveModal } from '../../../components/hr/ApplyLeaveModal';
import {
  Plus, Clock, CheckCircle, XCircle, CalendarOff, ChevronDown,
} from 'lucide-react-native';

interface LeaveBalance {
  leave_type: string;
  entitled: number;
  available: number;
}

const labelColor = (label?: string) => {
  const l = (label || '').toLowerCase();
  if (l.includes('casual')) return colors.primary;
  if (l.includes('sick')) return colors.warning;
  if (l.includes('earned')) return colors.success;
  if (l.includes('comp')) return '#0284c7';
  return colors.primary;
};

const fmtDays = (n: any) => {
  const v = Number(n || 0);
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
};

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

export default function LeaveScreen() {
  const { user } = useAuth();
  const [balances, setBalances] = useState<LeaveBalance[]>([]);
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [showApply, setShowApply] = useState(false);

  useEffect(() => { fetchData(); }, []);

  const fetchData = async () => {
    if (!user) return;
    setLoading(true);
    const year = new Date().getFullYear();

    const [balRes, reqRes] = await Promise.all([
      (supabase as any).rpc('my_leave_balances'),
      supabase.from('employee_leave_requests')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(20),
    ]);

    let balRows: any[] = balRes.data ?? [];
    if (balRes.error || balRows.length === 0) {
      // Tolerant fallback to the legacy table so the screen never blanks.
      const fallback = await supabase.from('employee_leave_balances')
        .select('leave_type, total_days, used_days')
        .eq('user_id', user.id)
        .eq('year', year);
      balRows = (fallback.data ?? []).map((b: any) => ({
        leave_type: b.leave_type,
        entitled: b.total_days || 0,
        available: (b.total_days || 0) - (b.used_days || 0),
      }));
    } else {
      // Prefer the current leave year; else show whatever the RPC returned.
      const currentYear = balRows.filter((b: any) => b.leave_year === year);
      if (currentYear.length > 0) balRows = currentYear;
    }
    setBalances(balRows as LeaveBalance[]);
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
          {balances.length === 0 ? (
            <Text style={styles.emptyText}>No leave balances yet</Text>
          ) : balances.map((bal, idx) => (
            <View key={(bal as any).leave_type_id ?? bal.leave_type ?? idx} style={styles.balanceCard}>
              <Text style={styles.balanceLabel}>{bal.leave_type}</Text>
              <Text style={[styles.balanceValue, { color: labelColor(bal.leave_type) }]}>
                {fmtDays(bal.available)}
              </Text>
              <Text style={styles.balanceSub}>of {fmtDays(bal.entitled)}</Text>
            </View>
          ))}
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
  balanceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 24 },
  balanceCard: {
    flexGrow: 1, flexBasis: '30%', minWidth: 96,
    backgroundColor: colors.card, borderRadius: 16,
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
