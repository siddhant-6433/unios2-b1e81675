import { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, SafeAreaView,
  TouchableOpacity, TextInput, FlatList, Image,
} from 'react-native';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { colors, spacing, radius } from '../../constants/Colors';
import { router } from 'expo-router';
import {
  Fingerprint, IndianRupee, BookOpen, ChevronRight, CheckCircle,
  CalendarOff, Clock, Bell, Search, Megaphone, Gift, AlertCircle,
  ClipboardCheck, Users, FileText, Briefcase,
} from 'lucide-react-native';

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
        {/* Header */}
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.greeting}>Hello, {displayName}</Text>
            <Text style={styles.dateText}>
              {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}
            </Text>
          </View>
          <TouchableOpacity style={styles.avatar}>
            <Text style={styles.avatarText}>
              {(profile?.display_name || 'U').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Staff views */}
        {isStaff && <StaffHome isAdmin={isAdmin} userId={user?.id || ''} />}

        {/* Student view */}
        {isStudent && <StudentHome userId={user?.id || ''} />}

        {/* Parent view */}
        {isParent && <ParentHome userId={user?.id || ''} />}
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Staff/Admin Home ──
function StaffHome({ isAdmin, userId }: { isAdmin: boolean; userId: string }) {
  const [punchStatus, setPunchStatus] = useState<'in' | 'out' | 'none'>('none');
  const [punchTime, setPunchTime] = useState<string | null>(null);
  const [pendingApprovals, setPendingApprovals] = useState(0);
  const [newLeads, setNewLeads] = useState(0);
  const [totalStudents, setTotalStudents] = useState(0);
  const [pendingFollowups, setPendingFollowups] = useState(0);
  const [todayVisits, setTodayVisits] = useState(0);

  useEffect(() => { fetchStatus(); }, []);

  const fetchStatus = async () => {
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
  };

  return (
    <View style={styles.section}>
      {/* Admin dashboard stats */}
      {isAdmin && (
        <View style={styles.statRow}>
          <StatCard label="New Leads" value={String(newLeads)} color="#7c3aed" icon={Users} />
          <StatCard label="Students" value={String(totalStudents)} color="#059669" icon={Users} />
        </View>
      )}

      {/* Pending items for admin */}
      {isAdmin && (pendingApprovals > 0 || pendingFollowups > 0) && (
        <View style={{ gap: 8 }}>
          {pendingFollowups > 0 && (
            <View style={styles.alertCard}>
              <View style={[styles.alertIcon, { backgroundColor: '#fef3c7' }]}>
                <Clock size={20} color="#d97706" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.alertTitle, { color: '#92400e' }]}>{pendingFollowups} Follow-ups Due</Text>
                <Text style={styles.alertSub}>Scheduled for today or overdue</Text>
              </View>
            </View>
          )}
          {newLeads > 0 && (
            <View style={styles.alertCard}>
              <View style={[styles.alertIcon, { backgroundColor: '#f5f3ff' }]}>
                <Users size={20} color="#7c3aed" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.alertTitle, { color: '#5b21b6' }]}>{newLeads} New Leads</Text>
                <Text style={styles.alertSub}>Uncontacted leads awaiting action</Text>
              </View>
            </View>
          )}
          {pendingApprovals > 0 && (
            <TouchableOpacity style={styles.alertCard} onPress={() => router.push('/(tabs)/inbox')} activeOpacity={0.7}>
              <View style={styles.alertIcon}>
                <AlertCircle size={20} color="#dc2626" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.alertTitle}>{pendingApprovals} HR Approvals</Text>
                <Text style={styles.alertSub}>Leave, face registrations</Text>
              </View>
              <ChevronRight size={18} color={colors.textMuted} />
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Punch status card */}
      <TouchableOpacity
        style={[styles.punchCard, punchStatus === 'in' && styles.punchCardActive]}
        onPress={() => router.push('/(tabs)/punch' as any)}
        activeOpacity={0.7}
      >
        <View style={[styles.punchIcon, punchStatus === 'in' && { backgroundColor: '#dcfce7' }]}>
          {punchStatus === 'in' ? <CheckCircle size={24} color={colors.success} /> : <Fingerprint size={24} color={colors.primary} />}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.punchTitle}>
            {punchStatus === 'none' ? 'Mark Attendance' : punchStatus === 'in' ? 'Punched In' : 'Day Complete'}
          </Text>
          <Text style={styles.punchSub}>
            {punchStatus === 'none' ? 'Tap to punch in' :
             punchTime ? new Date(punchTime).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }) : ''}
          </Text>
        </View>
        <ChevronRight size={20} color={colors.textMuted} />
      </TouchableOpacity>

      {/* Quick Actions — mixed platform + HR */}
      <Text style={styles.sectionTitle}>Quick Actions</Text>
      <View style={styles.actionGrid}>
        <ActionCard icon={CalendarOff} label="Apply Leave" color="#7c3aed" bg="#f5f3ff" onPress={() => router.push('/(tabs)/hr')} />
        <ActionCard icon={ClipboardCheck} label="Attendance" color="#059669" bg="#ecfdf5" onPress={() => router.push('/(tabs)/hr')} />
        <ActionCard icon={FileText} label="Pay Slips" color="#0284c7" bg="#f0f9ff" onPress={() => router.push('/(tabs)/hr')} />
        <ActionCard icon={Bell} label="Notices" color="#d97706" bg="#fffbeb" onPress={() => {}} />
      </View>

      {/* Announcements */}
      <Text style={styles.sectionTitle}>Announcements</Text>
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

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    const { data: attData } = await supabase
      .from('daily_attendance').select('status').eq('student_id', userId);
    if (attData && attData.length > 0) {
      const present = attData.filter((a: any) => a.status === 'present').length;
      setAttendance(Math.round((present / attData.length) * 100));
    }
    const { data: feeData } = await supabase
      .from('fee_ledger').select('balance').in('status', ['due', 'overdue']);
    if (feeData) setFeeDue(feeData.reduce((s: number, f: any) => s + Number(f.balance || 0), 0));
  };

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
      <TouchableOpacity style={styles.infoCard} onPress={() => router.push('/(tabs)/fees')} activeOpacity={0.7}>
        <View style={[styles.infoIcon, { backgroundColor: '#f0f9ff' }]}>
          <IndianRupee size={22} color="#0284c7" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.infoTitle}>Fee Status</Text>
          <Text style={styles.infoSub}>View fees and make payments</Text>
        </View>
        <ChevronRight size={18} color={colors.textMuted} />
      </TouchableOpacity>

      <TouchableOpacity style={styles.infoCard} onPress={() => router.push('/(tabs)/notices')} activeOpacity={0.7}>
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

// ── Reusable components ──
function ActionCard({ icon: Icon, label, color, bg, onPress }: { icon: any; label: string; color: string; bg: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={[styles.actionCard, { backgroundColor: bg }]} onPress={onPress} activeOpacity={0.7}>
      <Icon size={22} color={color} />
      <Text style={[styles.actionLabel, { color }]}>{label}</Text>
    </TouchableOpacity>
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
