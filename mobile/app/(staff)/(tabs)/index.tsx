/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, SafeAreaView,
  TouchableOpacity,
} from 'react-native';
import { useAuth } from '../../../contexts/AuthContext';
import { supabase } from '../../../lib/supabase';
import { colors, spacing, radius, typography } from '../../../constants/Colors';
import { router } from 'expo-router';
import {
  Fingerprint, IndianRupee, ChevronRight, CheckCircle,
  CalendarOff, Clock, Bell, Search, Megaphone, Gift, AlertCircle,
  ClipboardCheck, Users, FileText, Briefcase, Cake, BadgeCheck,
} from 'lucide-react-native';
import {
  ActionTile,
  MetricCard,
  ScreenHeader,
  SectionTitle,
  StatusCard,
} from '../../../components/ui/DashboardPrimitives';

export default function HomeScreen() {
  const { profile, role, user } = useAuth();
  const displayName = profile?.display_name?.split(' ')[0] || 'User';

  const isAdmin = ['super_admin', 'campus_admin', 'principal', 'admission_head'].includes(role || '');
  const isEmployee = ['counsellor', 'accountant', 'data_entry', 'office_admin', 'office_assistant', 'hostel_warden'].includes(role || '');
  const isFaculty = ['faculty', 'teacher', 'ib_coordinator'].includes(role || '');
  const isStudent = role === 'student';
  const isParent = role === 'parent';
  const isStaff = isAdmin || isEmployee || isFaculty;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <ScreenHeader
          title={isStaff ? `Hello, ${displayName}` : `Hello, ${displayName}`}
          subtitle={new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}
          avatar={(
            <TouchableOpacity style={styles.avatar} onPress={() => router.push('/(staff)/(tabs)/profile' as any)}>
            <Text style={styles.avatarText}>
              {(profile?.display_name || 'U').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
            </Text>
            </TouchableOpacity>
          )}
        />

        {/* Staff views */}
        {isStaff && <StaffHome isAdmin={isAdmin} userId={user?.id || ''} role={role || ''} />}

        {/* Student view */}
        {isStudent && <StudentHome userId={user?.id || ''} />}

        {/* Parent view */}
        {isParent && <ParentHome userId={user?.id || ''} />}
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Staff/Admin Home ──
function StaffHome({ isAdmin, userId, role }: { isAdmin: boolean; userId: string; role: string }) {
  const [punchStatus, setPunchStatus] = useState<'in' | 'out' | 'none'>('none');
  const [punchTime, setPunchTime] = useState<string | null>(null);
  const [pendingApprovals, setPendingApprovals] = useState(0);
  const [newLeads, setNewLeads] = useState(0);
  const [totalStudents, setTotalStudents] = useState(0);
  const [pendingFollowups, setPendingFollowups] = useState(0);

  const fetchStatus = useCallback(async () => {
    const today = new Date().toISOString().slice(0, 10);

    // Punch status
    const { data } = await supabase
      .from('employee_attendance')
      .select('punch_in, punch_out')
      .eq('user_id', userId)
      .eq('date', today)
      .maybeSingle();

    if (data) {
      if (data.punch_out) { setPunchStatus('out'); setPunchTime(data.punch_out); }
      else { setPunchStatus('in'); setPunchTime(data.punch_in); }
    }

    if (isAdmin) {
      // Platform stats
      const [faceRes, leaveRes, leadsRes, studentsRes, followupsRes] = await Promise.all([
        supabase.from('employee_face_registrations').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
        supabase.from('employee_leave_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
        supabase.from('leads').select('id', { count: 'exact', head: true }).eq('stage', 'new_lead'),
        supabase.from('students').select('id', { count: 'exact', head: true }).in('status', ['active', 'pre_admitted']),
        supabase.from('lead_followups').select('id', { count: 'exact', head: true })
          .eq('status', 'pending').lte('scheduled_at', `${today}T23:59:59`),
      ]);
      setPendingApprovals((faceRes.count || 0) + (leaveRes.count || 0));
      setNewLeads(leadsRes.count || 0);
      setTotalStudents(studentsRes.count || 0);
      setPendingFollowups(followupsRes.count || 0);
    }
  }, [isAdmin, userId]);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  return (
    <View style={styles.section}>
      <StatusCard
        icon={punchStatus === 'in' ? CheckCircle : Fingerprint}
        tone={punchStatus === 'in' ? 'green' : punchStatus === 'out' ? 'neutral' : 'blue'}
        title={punchStatus === 'none' ? 'Mark attendance' : punchStatus === 'in' ? 'You are punched in' : 'Day complete'}
        subtitle={
          punchStatus === 'none'
            ? 'Start your day with a secure campus punch.'
            : punchTime
              ? `Last update ${new Date(punchTime).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })}`
              : 'Attendance is up to date.'
        }
        value={punchStatus === 'in' ? 'Active' : punchStatus === 'out' ? 'Done' : 'Ready'}
        onPress={() => router.push('/(staff)/work/punch' as any)}
      />

      {isAdmin && (
        <View style={styles.metricRow}>
          <MetricCard icon={Users} label="New leads" value={String(newLeads)} tone="purple" />
          <MetricCard icon={Users} label="Students" value={String(totalStudents)} tone="green" />
          <MetricCard icon={Clock} label="Follow-ups" value={String(pendingFollowups)} tone="yellow" />
        </View>
      )}

      {(pendingApprovals > 0 || pendingFollowups > 0 || newLeads > 0) && (
        <TouchableOpacity style={styles.priorityCard} onPress={() => router.push('/(staff)/(tabs)/inbox' as any)} activeOpacity={0.75}>
          <View style={styles.priorityIcon}>
            <AlertCircle size={20} color="#BE123C" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.priorityTitle}>Needs attention</Text>
            <Text style={styles.prioritySub}>
              {pendingApprovals} approvals · {pendingFollowups} follow-ups · {newLeads} new leads
            </Text>
          </View>
          <ChevronRight size={18} color={colors.textMuted} />
        </TouchableOpacity>
      )}

      <SectionTitle title="Quick actions" />
      <View style={styles.actionGrid}>
        <ActionTile icon={CalendarOff} label="Apply leave" subtitle="Request time off" tone="purple" onPress={() => router.push('/(staff)/work/hr' as any)} />
        <ActionTile icon={ClipboardCheck} label="Attendance" subtitle="Logs and shifts" tone="green" onPress={() => router.push('/(staff)/work/hr' as any)} />
        <ActionTile icon={FileText} label="Pay slips" subtitle="Salary documents" tone="blue" onPress={() => router.push('/(staff)/work/hr' as any)} />
        <ActionTile icon={Bell} label="Notices" subtitle="Announcements" tone="yellow" onPress={() => router.push('/(staff)/(tabs)/inbox' as any)} />
        <ActionTile icon={Search} label="Directory" subtitle="Find people" tone="pink" onPress={() => router.push('/(staff)/work/team' as any)} />
        <ActionTile icon={Briefcase} label="My work" subtitle={role === 'librarian' ? 'Library desk' : 'Role workspace'} tone="orange" onPress={() => router.push('/(staff)/(tabs)/work' as any)} />
      </View>

      <SectionTitle title="People moments" />
      <View style={styles.momentRow}>
        <View style={styles.momentCard}>
          <Cake size={18} color="#BE185D" />
          <Text style={styles.momentTitle}>Birthdays</Text>
          <Text style={styles.momentSub}>No birthdays today</Text>
        </View>
        <View style={styles.momentCard}>
          <BadgeCheck size={18} color="#15803D" />
          <Text style={styles.momentTitle}>Anniversaries</Text>
          <Text style={styles.momentSub}>No work anniversaries today</Text>
        </View>
      </View>

      <SectionTitle title="Announcements" />
      <View style={styles.emptyCard}>
        <Megaphone size={24} color={colors.textMuted} />
        <Text style={styles.emptyText}>No announcements</Text>
      </View>
    </View>
  );
}

// ── Student Home ──
function StudentHome({ userId }: { userId: string }) {
  const [attendance, setAttendance] = useState<number | null>(null);
  const [feeDue, setFeeDue] = useState(0);

  const fetchData = useCallback(async () => {
    const { data: attData } = await supabase
      .from('daily_attendance').select('status').eq('student_id', userId);
    if (attData && attData.length > 0) {
      const present = attData.filter((a: any) => a.status === 'present').length;
      setAttendance(Math.round((present / attData.length) * 100));
    }
    const { data: feeData } = await supabase
      .from('fee_ledger').select('balance').in('status', ['due', 'overdue']);
    if (feeData) setFeeDue(feeData.reduce((s: number, f: any) => s + Number(f.balance || 0), 0));
  }, [userId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return (
    <View style={styles.section}>
      <View style={styles.statRow}>
        <StatCard
          label="Attendance" value={attendance !== null ? `${attendance}%` : '—'}
          color={attendance !== null && attendance >= 75 ? colors.success : colors.destructive}
          icon={ClipboardCheck}
        />
        <StatCard
          label="Fee Due" value={feeDue > 0 ? `₹${(feeDue / 1000).toFixed(0)}K` : '₹0'}
          color={feeDue > 0 ? colors.destructive : colors.success}
          icon={IndianRupee}
        />
      </View>

      <Text style={styles.sectionTitle}>Notices</Text>
      <View style={styles.emptyCard}>
        <Bell size={24} color={colors.textMuted} />
        <Text style={styles.emptyText}>No new notices</Text>
      </View>
    </View>
  );
}

// ── Parent Home ──
function ParentHome({ userId }: { userId: string }) {
  return (
    <View style={styles.section}>
      <TouchableOpacity style={styles.infoCard} onPress={() => router.push('/(staff)/(tabs)/inbox' as any)} activeOpacity={0.7}>
        <View style={[styles.infoIcon, { backgroundColor: '#f0f9ff' }]}>
          <IndianRupee size={22} color="#0284c7" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.infoTitle}>Fee Status</Text>
          <Text style={styles.infoSub}>View fees and make payments</Text>
        </View>
        <ChevronRight size={18} color={colors.textMuted} />
      </TouchableOpacity>

      <TouchableOpacity style={styles.infoCard} onPress={() => router.push('/(staff)/(tabs)/inbox' as any)} activeOpacity={0.7}>
        <View style={[styles.infoIcon, { backgroundColor: '#fefce8' }]}>
          <Bell size={22} color="#ca8a04" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.infoTitle}>Notices</Text>
          <Text style={styles.infoSub}>School announcements and updates</Text>
        </View>
        <ChevronRight size={18} color={colors.textMuted} />
      </TouchableOpacity>
    </View>
  );
}

function StatCard({ label, value, color, icon: Icon }: { label: string; value: string; color: string; icon: any }) {
  return (
    <View style={styles.statCard}>
      <Icon size={20} color={color} style={{ marginBottom: 8 }} />
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: 16, paddingBottom: 100 },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 20, paddingTop: 8,
  },
  greeting: { fontSize: 24, fontWeight: '700', color: colors.text, letterSpacing: -0.5 },
  dateText: { fontSize: 13, color: colors.textSecondary, marginTop: 2 },
  avatar: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { fontSize: 14, fontWeight: '600', color: colors.primary },
  section: { gap: 16 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: colors.text, marginTop: 8 },
  metricRow: { flexDirection: 'row', gap: spacing.sm },
  priorityCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: '#FFE4E6',
    borderRadius: 22,
    padding: spacing.md,
  },
  priorityIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  priorityTitle: { ...typography.bodyMedium, color: colors.text },
  prioritySub: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  momentRow: { flexDirection: 'row', gap: spacing.sm },
  momentCard: {
    flex: 1,
    minHeight: 108,
    borderRadius: 22,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    padding: spacing.md,
    justifyContent: 'space-between',
  },
  momentTitle: { ...typography.bodyMedium, color: colors.text },
  momentSub: { ...typography.caption, color: colors.textSecondary, lineHeight: 17 },

  // Punch card
  punchCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: colors.card, borderRadius: 16, padding: 16,
    borderWidth: 1, borderColor: colors.cardBorder,
  },
  punchCardActive: { borderColor: colors.success, backgroundColor: '#f0fdf4' },
  punchIcon: {
    width: 48, height: 48, borderRadius: 12,
    backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center',
  },
  punchTitle: { fontSize: 16, fontWeight: '600', color: colors.text },
  punchSub: { fontSize: 13, color: colors.textSecondary, marginTop: 2 },

  // Quick actions grid
  actionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  actionCard: {
    width: '48%' as any, borderRadius: 14, padding: 16, gap: 10,
    flexGrow: 1, flexBasis: '45%',
  },
  actionLabel: { fontSize: 13, fontWeight: '600' },

  // Alert card
  alertCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#fef2f2', borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: '#fecaca',
  },
  alertIcon: { width: 40, height: 40, borderRadius: 10, backgroundColor: '#fee2e2', alignItems: 'center', justifyContent: 'center' },
  alertTitle: { fontSize: 14, fontWeight: '600', color: '#dc2626' },
  alertSub: { fontSize: 12, color: '#991b1b', marginTop: 1 },

  // Info card (parent)
  infoCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: colors.card, borderRadius: 16, padding: 16,
    borderWidth: 1, borderColor: colors.cardBorder,
  },
  infoIcon: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  infoTitle: { fontSize: 15, fontWeight: '600', color: colors.text },
  infoSub: { fontSize: 12, color: colors.textSecondary, marginTop: 1 },

  // Stats
  statRow: { flexDirection: 'row', gap: 10 },
  statCard: {
    flex: 1, backgroundColor: colors.card, borderRadius: 16, padding: 16,
    alignItems: 'center', borderWidth: 1, borderColor: colors.cardBorder,
  },
  statValue: { fontSize: 28, fontWeight: '700' },
  statLabel: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },

  // Empty
  emptyCard: {
    backgroundColor: colors.card, borderRadius: 14, padding: 24,
    alignItems: 'center', gap: 8, borderWidth: 1, borderColor: colors.cardBorder,
  },
  emptyText: { fontSize: 13, color: colors.textMuted },
});
