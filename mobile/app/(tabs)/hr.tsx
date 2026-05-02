import { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, SafeAreaView,
  TouchableOpacity, ActivityIndicator, Modal, TextInput, Alert, FlatList,
} from 'react-native';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { colors, radius } from '../../constants/Colors';
import {
  Clock, CalendarOff, FileText, IndianRupee, Briefcase,
  ClipboardCheck, History, Plus, Check, X, ChevronRight,
  Calendar, Download, AlertCircle,
} from 'lucide-react-native';

type HrTab = 'time' | 'finances' | 'documents';

const LEAVE_TYPES = ['casual', 'sick', 'earned'];

export default function HrScreen() {
  const { user } = useAuth();
  const [tab, setTab] = useState<HrTab>('time');

  return (
    <SafeAreaView style={styles.container}>
      {/* Tab bar */}
      <View style={styles.tabBar}>
        {(['time', 'finances', 'documents'] as HrTab[]).map((t) => (
          <TouchableOpacity
            key={t}
            style={[styles.tab, tab === t && styles.tabActive]}
            onPress={() => setTab(t)}
          >
            <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>
              {t === 'time' ? 'Time' : t === 'finances' ? 'Finances' : 'Documents'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {tab === 'time' && <TimeSection userId={user?.id || ''} />}
        {tab === 'finances' && <FinancesSection />}
        {tab === 'documents' && <DocumentsSection />}
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Time Section ──
function TimeSection({ userId }: { userId: string }) {
  const [balances, setBalances] = useState<any[]>([]);
  const [requests, setRequests] = useState<any[]>([]);
  const [attendance, setAttendance] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showApply, setShowApply] = useState(false);

  useEffect(() => { fetchData(); }, []);

  const fetchData = async () => {
    setLoading(true);
    const year = new Date().getFullYear();
    const month = new Date().getMonth();
    const startOfMonth = `${year}-${String(month + 1).padStart(2, '0')}-01`;
    const endOfMonth = `${year}-${String(month + 1).padStart(2, '0')}-${new Date(year, month + 1, 0).getDate()}`;

    const [balRes, reqRes, attRes] = await Promise.all([
      supabase.from('employee_leave_balances')
        .select('leave_type, total_days, used_days')
        .eq('user_id', userId).eq('year', year),
      supabase.from('employee_leave_requests')
        .select('*').eq('user_id', userId)
        .order('created_at', { ascending: false }).limit(10),
      supabase.from('employee_attendance')
        .select('date, punch_in, punch_out')
        .eq('user_id', userId)
        .gte('date', startOfMonth).lte('date', endOfMonth)
        .order('date', { ascending: false }),
    ]);

    if (balRes.data) setBalances(balRes.data);
    if (reqRes.data) setRequests(reqRes.data);
    if (attRes.data) setAttendance(attRes.data);
    setLoading(false);
  };

  if (loading) return <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 40 }} />;

  const leaveColors: Record<string, string> = { casual: '#7c3aed', sick: '#d97706', earned: '#059669' };

  return (
    <View style={styles.section}>
      {/* Attendance section */}
      <Text style={styles.sectionTitle}>Attendance</Text>
      <View style={styles.cardGrid}>
        <MenuCard icon={Clock} title="Logs & Shifts" sub="View attendance logs" color="#0284c7" bg="#f0f9ff" />
        <MenuCard icon={History} title="Request History" sub="Attendance requests" color="#7c3aed" bg="#f5f3ff" />
      </View>

      {/* Recent punches */}
      {attendance.length > 0 && (
        <View style={styles.listCard}>
          {attendance.slice(0, 5).map((a: any) => (
            <View key={a.id ?? `${a.date}-${a.punch_in ?? ''}`} style={styles.logRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.logDate}>
                  {new Date(a.date).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}
                </Text>
              </View>
              <Text style={styles.logTime}>
                {a.punch_in ? new Date(a.punch_in).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }) : '—'}
              </Text>
              <Text style={styles.logDash}>→</Text>
              <Text style={styles.logTime}>
                {a.punch_out ? new Date(a.punch_out).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }) : '—'}
              </Text>
            </View>
          ))}
        </View>
      )}

      {/* Leave section */}
      <View style={styles.leaveHeader}>
        <Text style={styles.sectionTitle}>Leave</Text>
        <TouchableOpacity style={styles.applyBtn} onPress={() => setShowApply(true)}>
          <Plus size={14} color="#fff" />
          <Text style={styles.applyBtnText}>Apply</Text>
        </TouchableOpacity>
      </View>

      {/* Leave balances */}
      <View style={styles.balanceRow}>
        {LEAVE_TYPES.map((type) => {
          const bal = balances.find((b: any) => b.leave_type === type);
          const remaining = (bal?.total_days || 0) - (bal?.used_days || 0);
          return (
            <View key={type} style={styles.balanceCard}>
              <Text style={[styles.balanceValue, { color: leaveColors[type] || colors.primary }]}>
                {remaining}
              </Text>
              <Text style={styles.balanceLabel}>{type.charAt(0).toUpperCase() + type.slice(1)}</Text>
              <Text style={styles.balanceSub}>of {bal?.total_days || 0}</Text>
            </View>
          );
        })}
      </View>

      {/* Recent leave requests */}
      {requests.length > 0 && (
        <View style={styles.listCard}>
          {requests.slice(0, 5).map((r: any) => (
            <View key={r.id} style={styles.logRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.logDate}>
                  {r.leave_type} — {r.days} day{r.days > 1 ? 's' : ''}
                </Text>
                <Text style={styles.logSub}>
                  {new Date(r.start_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                </Text>
              </View>
              <View style={[styles.statusBadge, {
                backgroundColor: r.status === 'approved' ? '#dcfce7' : r.status === 'rejected' ? '#fef2f2' : '#fefce8',
              }]}>
                <Text style={[styles.statusText, {
                  color: r.status === 'approved' ? '#16a34a' : r.status === 'rejected' ? '#dc2626' : '#ca8a04',
                }]}>{r.status}</Text>
              </View>
            </View>
          ))}
        </View>
      )}

      {/* Apply leave modal */}
      <ApplyLeaveModal
        visible={showApply}
        onClose={() => setShowApply(false)}
        onSuccess={() => { setShowApply(false); fetchData(); }}
        userId={userId}
      />
    </View>
  );
}

// ── Finances Section ──
function FinancesSection() {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Salary</Text>
      <View style={styles.cardGrid}>
        <MenuCard icon={IndianRupee} title="My Pay" sub="View salary details" color="#059669" bg="#ecfdf5" />
        <MenuCard icon={FileText} title="Pay Slips" sub="Download payslips" color="#0284c7" bg="#f0f9ff" />
      </View>

      <Text style={styles.sectionTitle}>Expenses</Text>
      <View style={styles.cardGrid}>
        <MenuCard icon={Briefcase} title="Add Expense" sub="Create and claim" color="#d97706" bg="#fffbeb" />
        <MenuCard icon={History} title="Expense History" sub="Track your claims" color="#7c3aed" bg="#f5f3ff" />
      </View>
    </View>
  );
}

// ── Documents Section ──
function DocumentsSection() {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Documents</Text>
      <View style={styles.cardGrid}>
        <MenuCard icon={FileText} title="Org Documents" sub="Policies and forms" color="#d97706" bg="#fffbeb" />
        <MenuCard icon={Download} title="My Documents" sub="Your uploaded files" color="#7c3aed" bg="#f5f3ff" />
      </View>
    </View>
  );
}

// ── Menu Card ──
function MenuCard({ icon: Icon, title, sub, color, bg }: { icon: any; title: string; sub: string; color: string; bg: string }) {
  return (
    <TouchableOpacity style={[styles.menuCard, { backgroundColor: bg }]} activeOpacity={0.7}>
      <Icon size={24} color={color} />
      <Text style={styles.menuTitle}>{title}</Text>
      <Text style={styles.menuSub}>{sub}</Text>
    </TouchableOpacity>
  );
}

// ── Apply Leave Modal ──
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
      user_id: userId, leave_type: leaveType,
      start_date: startDate, end_date: endDate || startDate,
      days, reason: reason || null,
    });
    if (error) Alert.alert('Error', error.message);
    else { Alert.alert('Success', 'Leave request submitted'); onSuccess(); }
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
          <ScrollView contentContainerStyle={{ gap: 16, paddingBottom: 24 }}>
            <View>
              <Text style={modalStyles.label}>Leave Type</Text>
              <View style={modalStyles.typeRow}>
                {LEAVE_TYPES.map((t) => (
                  <TouchableOpacity key={t}
                    style={[modalStyles.typeChip, leaveType === t && modalStyles.typeChipActive]}
                    onPress={() => setLeaveType(t)}>
                    <Text style={[modalStyles.typeText, leaveType === t && { color: '#fff' }]}>
                      {t.charAt(0).toUpperCase() + t.slice(1)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
            <View>
              <Text style={modalStyles.label}>Start Date</Text>
              <TextInput style={modalStyles.input} placeholder="YYYY-MM-DD" placeholderTextColor={colors.textMuted} value={startDate} onChangeText={setStartDate} />
            </View>
            <View>
              <Text style={modalStyles.label}>End Date (optional)</Text>
              <TextInput style={modalStyles.input} placeholder="YYYY-MM-DD" placeholderTextColor={colors.textMuted} value={endDate} onChangeText={setEndDate} />
            </View>
            <View>
              <Text style={modalStyles.label}>Reason</Text>
              <TextInput style={[modalStyles.input, { height: 80, textAlignVertical: 'top' }]} placeholder="Optional" placeholderTextColor={colors.textMuted} value={reason} onChangeText={setReason} multiline />
            </View>
            <TouchableOpacity style={[modalStyles.submitBtn, submitting && { opacity: 0.5 }]} onPress={submit} disabled={submitting}>
              {submitting ? <ActivityIndicator color="#fff" /> : <Text style={modalStyles.submitText}>Submit Request</Text>}
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
  tabBar: {
    flexDirection: 'row', backgroundColor: colors.card,
    borderBottomWidth: 1, borderBottomColor: colors.border,
    paddingTop: 50, // safe area
  },
  tab: { flex: 1, paddingVertical: 14, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabActive: { borderBottomColor: colors.primary },
  tabText: { fontSize: 14, fontWeight: '500', color: colors.textMuted },
  tabTextActive: { color: colors.primary, fontWeight: '700' },
  section: { gap: 16 },
  sectionTitle: { fontSize: 18, fontWeight: '700', color: colors.text, marginTop: 8 },
  leaveHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 },
  applyBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: colors.primary, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8,
  },
  applyBtnText: { color: '#fff', fontSize: 13, fontWeight: '600' },

  // Card grid
  cardGrid: { flexDirection: 'row', gap: 10 },
  menuCard: {
    flex: 1, borderRadius: 14, padding: 16, gap: 8,
  },
  menuTitle: { fontSize: 14, fontWeight: '600', color: colors.text },
  menuSub: { fontSize: 11, color: colors.textSecondary },

  // Balance
  balanceRow: { flexDirection: 'row', gap: 10 },
  balanceCard: {
    flex: 1, backgroundColor: colors.card, borderRadius: 14, padding: 14,
    alignItems: 'center', borderWidth: 1, borderColor: colors.cardBorder,
  },
  balanceValue: { fontSize: 26, fontWeight: '700' },
  balanceLabel: { fontSize: 11, fontWeight: '500', color: colors.textSecondary, marginTop: 2 },
  balanceSub: { fontSize: 10, color: colors.textMuted },

  // List card
  listCard: {
    backgroundColor: colors.card, borderRadius: 14,
    borderWidth: 1, borderColor: colors.cardBorder, overflow: 'hidden',
  },
  logRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    padding: 14, borderBottomWidth: 1, borderBottomColor: colors.cardBorder,
  },
  logDate: { fontSize: 13, fontWeight: '500', color: colors.text },
  logSub: { fontSize: 11, color: colors.textMuted, marginTop: 1 },
  logTime: { fontSize: 12, fontWeight: '500', color: colors.textSecondary, fontFamily: 'monospace' as any },
  logDash: { fontSize: 12, color: colors.textMuted },
  statusBadge: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  statusText: { fontSize: 11, fontWeight: '600', textTransform: 'capitalize' as any },
});

const modalStyles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: { backgroundColor: colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 24, paddingTop: 20, maxHeight: '85%' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  title: { fontSize: 18, fontWeight: '700', color: colors.text },
  label: { fontSize: 14, fontWeight: '600', color: colors.text, marginBottom: 8 },
  input: {
    backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border,
    borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12, fontSize: 15, color: colors.text,
  },
  typeRow: { flexDirection: 'row', gap: 8 },
  typeChip: { flex: 1, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: colors.border, alignItems: 'center' },
  typeChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  typeText: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
  submitBtn: { backgroundColor: colors.primary, borderRadius: 12, height: 52, alignItems: 'center', justifyContent: 'center' },
  submitText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
