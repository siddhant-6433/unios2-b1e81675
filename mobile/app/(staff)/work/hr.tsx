import { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, SafeAreaView,
  TouchableOpacity, ActivityIndicator, FlatList,
} from 'react-native';
import { router } from 'expo-router';
import { useAuth } from '../../../contexts/AuthContext';
import { supabase } from '../../../lib/supabase';
import { colors, radius } from '../../../constants/Colors';
import { ApplyLeaveModal } from '../../../components/hr/ApplyLeaveModal';
import {
  Clock, CalendarOff, FileText, IndianRupee, Briefcase,
  ClipboardCheck, History, Plus, Check, ChevronRight,
  Calendar, Download, AlertCircle,
} from 'lucide-react-native';

const labelColor = (label?: string) => {
  const l = (label || '').toLowerCase();
  if (l.includes('casual')) return '#7c3aed';
  if (l.includes('sick')) return '#d97706';
  if (l.includes('earned')) return '#059669';
  if (l.includes('comp')) return '#0284c7';
  return colors.primary;
};

const fmtDays = (n: any) => {
  const v = Number(n || 0);
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
};

type HrTab = 'time' | 'finances' | 'documents';

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
      (supabase as any).rpc('my_leave_balances'),
      supabase.from('employee_leave_requests')
        .select('*').eq('user_id', userId)
        .order('created_at', { ascending: false }).limit(10),
      supabase.from('employee_attendance')
        .select('date, punch_in, punch_out')
        .eq('user_id', userId)
        .gte('date', startOfMonth).lte('date', endOfMonth)
        .order('date', { ascending: false }),
    ]);

    let balRows: any[] = balRes.data ?? [];
    if (balRes.error || balRows.length === 0) {
      // Tolerant fallback to the legacy table so the screen never blanks.
      const fallback = await supabase.from('employee_leave_balances')
        .select('leave_type, total_days, used_days')
        .eq('user_id', userId).eq('year', year);
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
    setBalances(balRows);
    if (reqRes.data) setRequests(reqRes.data);
    if (attRes.data) setAttendance(attRes.data);
    setLoading(false);
  };

  if (loading) return <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 40 }} />;

  return (
    <View style={styles.section}>
      {/* Attendance section */}
      <Text style={styles.sectionTitle}>Attendance</Text>
      <View style={styles.cardGrid}>
        <MenuCard
          icon={Clock} title="Logs & Shifts" sub="View attendance logs"
          color="#0284c7" bg="#f0f9ff"
          onPress={() => router.push({ pathname: '/(staff)/work/attendance-logs', params: { tab: 'logs' } } as any)}
        />
        <MenuCard
          icon={History} title="Request History" sub="Attendance requests"
          color="#7c3aed" bg="#f5f3ff"
          onPress={() => router.push({ pathname: '/(staff)/work/attendance-logs', params: { tab: 'corrections' } } as any)}
        />
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
        {balances.length === 0 ? (
          <Text style={styles.balanceEmpty}>No leave balances yet</Text>
        ) : balances.map((bal: any) => (
          <View key={bal.leave_type_id ?? bal.leave_type} style={styles.balanceCard}>
            <Text style={[styles.balanceValue, { color: labelColor(bal.leave_type) }]}>
              {fmtDays(bal.available)}
            </Text>
            <Text style={styles.balanceLabel}>{bal.leave_type}</Text>
            <Text style={styles.balanceSub}>of {fmtDays(bal.entitled)}</Text>
          </View>
        ))}
      </View>

      {/* Leave tools */}
      <View style={styles.cardGrid}>
        <MenuCard
          icon={Clock} title="Comp-Off" sub="Overtime credit"
          color="#0284c7" bg="#f0f9ff"
          onPress={() => router.push('/(staff)/work/comp-off' as any)}
        />
        <MenuCard
          icon={IndianRupee} title="Encash Leave" sub="Cash out unused leave"
          color="#059669" bg="#ecfdf5"
          onPress={() => router.push('/(staff)/work/encashment' as any)}
        />
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
        <MenuCard
          icon={IndianRupee} title="My Pay" sub="View salary details"
          color="#059669" bg="#ecfdf5"
          onPress={() => router.push('/(staff)/work/payslips' as any)}
        />
        <MenuCard
          icon={FileText} title="Pay Slips" sub="Download payslips"
          color="#0284c7" bg="#f0f9ff"
          onPress={() => router.push('/(staff)/work/payslips' as any)}
        />
      </View>

      <Text style={styles.sectionTitle}>Expenses</Text>
      <View style={styles.cardGrid}>
        <MenuCard
          icon={Briefcase} title="Add Expense" sub="Create and claim"
          color="#d97706" bg="#fffbeb"
          onPress={() => router.push('/(staff)/work/expenses' as any)}
        />
        <MenuCard
          icon={History} title="Expense History" sub="Track your claims"
          color="#7c3aed" bg="#f5f3ff"
          onPress={() => router.push('/(staff)/work/expenses' as any)}
        />
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
        <MenuCard
          icon={FileText} title="Org Documents" sub="Policies and forms"
          color="#d97706" bg="#fffbeb"
          onPress={() => router.push('/(staff)/work/documents' as any)}
        />
        <MenuCard
          icon={Download} title="My Documents" sub="Your uploaded files"
          color="#7c3aed" bg="#f5f3ff"
          onPress={() => router.push('/(staff)/work/documents' as any)}
        />
      </View>
    </View>
  );
}

// ── Menu Card ──
function MenuCard({ icon: Icon, title, sub, color, bg, onPress }: {
  icon: any; title: string; sub: string; color: string; bg: string; onPress?: () => void;
}) {
  return (
    <TouchableOpacity style={[styles.menuCard, { backgroundColor: bg }]} activeOpacity={0.7} onPress={onPress}>
      <Icon size={24} color={color} />
      <Text style={styles.menuTitle}>{title}</Text>
      <Text style={styles.menuSub}>{sub}</Text>
    </TouchableOpacity>
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
  balanceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  balanceCard: {
    flexGrow: 1, flexBasis: '30%', minWidth: 96,
    backgroundColor: colors.card, borderRadius: 14, padding: 14,
    alignItems: 'center', borderWidth: 1, borderColor: colors.cardBorder,
  },
  balanceValue: { fontSize: 26, fontWeight: '700' },
  balanceLabel: { fontSize: 11, fontWeight: '500', color: colors.textSecondary, marginTop: 2 },
  balanceSub: { fontSize: 10, color: colors.textMuted },
  balanceEmpty: { fontSize: 13, color: colors.textMuted },

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
