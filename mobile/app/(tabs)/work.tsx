/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { ActivityIndicator, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import {
  Barcode,
  Bell,
  BookOpen,
  Calendar,
  CalendarOff,
  CheckCircle2,
  Clock,
  IndianRupee,
  MessageCircle,
  Phone,
  Search,
  Users,
} from 'lucide-react-native';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { colors, radius, spacing, typography } from '../../constants/Colors';
import {
  ActionTile,
  MetricCard,
  PillFilter,
  ScreenHeader,
  SectionTitle,
  SegmentedControl,
  StatusCard,
} from '../../components/ui/DashboardPrimitives';

type AdminRange = 'today' | 'yesterday' | '7d';
type WorkMetric = Record<string, number>;

export default function WorkScreen() {
  const { role, profile } = useAuth();
  const displayName = profile?.display_name?.split(' ')[0] || 'there';

  if (role === 'librarian') return <LibrarianWork displayName={displayName} />;
  if (role === 'counsellor' || role === 'admission_head') return <AdmissionsWork displayName={displayName} isHead={role === 'admission_head'} />;
  if (['super_admin', 'campus_admin', 'principal'].includes(role || '')) return <LeadershipWork displayName={displayName} role={role || ''} />;
  if (['faculty', 'teacher', 'ib_coordinator'].includes(role || '')) return <FacultyWork displayName={displayName} />;
  return <EmployeeWork displayName={displayName} />;
}

function LibrarianWork({ displayName }: { displayName: string }) {
  const [metrics, setMetrics] = useState<WorkMetric>({ items: 0, loans: 0, queue: 0, overdue: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      const [itemRes, loanRes, queueRes, overdueRes] = await Promise.all([
        (supabase as any).from('library_items').select('id', { count: 'exact', head: true }),
        (supabase as any).from('library_loans').select('id', { count: 'exact', head: true }).in('status', ['active', 'overdue']),
        (supabase as any).from('library_digitization_records').select('id', { count: 'exact', head: true }).in('status', ['captured', 'matched', 'needs_review']),
        (supabase as any).from('library_loans').select('id', { count: 'exact', head: true }).eq('status', 'overdue'),
      ]);
      setMetrics({
        items: itemRes.count || 0,
        loans: loanRes.count || 0,
        queue: queueRes.count || 0,
        overdue: overdueRes.count || 0,
      });
      setLoading(false);
    };
    fetchData();
  }, []);

  return (
    <WorkScaffold title="Library Desk" subtitle={`Good to see you, ${displayName}`}>
      {loading ? <Loader /> : (
        <>
          <StatusCard
            icon={Barcode}
            title="Scan books at the desk"
            subtitle="Digitize, issue, return, or audit accession barcodes from one scanner."
            value={`${metrics.queue} queued`}
            tone="blue"
            onPress={() => router.push('/(tabs)/library' as any)}
          />
          <View style={styles.metricRow}>
            <MetricCard icon={BookOpen} label="Copies" value={String(metrics.items)} tone="blue" />
            <MetricCard icon={CheckCircle2} label="Active loans" value={String(metrics.loans)} tone="green" />
            <MetricCard icon={Clock} label="Overdue" value={String(metrics.overdue)} tone="yellow" />
          </View>
          <SectionTitle title="Library actions" />
          <View style={styles.actionGrid}>
            <ActionTile icon={Barcode} label="Scan / digitize" subtitle="ISBN to review queue" tone="blue" onPress={() => router.push('/(tabs)/library' as any)} />
            <ActionTile icon={BookOpen} label="Issue book" subtitle="Admission number + accession" tone="green" onPress={() => router.push('/(tabs)/library' as any)} />
            <ActionTile icon={CheckCircle2} label="Return book" subtitle="Assess fines if overdue" tone="yellow" onPress={() => router.push('/(tabs)/library' as any)} />
            <ActionTile icon={Search} label="Catalog search" subtitle="Find copy availability" tone="purple" onPress={() => router.push('/(tabs)/library' as any)} />
          </View>
        </>
      )}
    </WorkScaffold>
  );
}

function AdmissionsWork({ displayName, isHead }: { displayName: string; isHead: boolean }) {
  const [metrics, setMetrics] = useState<WorkMetric>({ leads: 0, followups: 0, visits: 0, applications: 0 });
  const [filter, setFilter] = useState<'mine' | 'team'>(isHead ? 'team' : 'mine');

  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);
    const fetchData = async () => {
      const [leadsRes, followupsRes, visitsRes, appsRes] = await Promise.all([
        supabase.from('leads').select('id', { count: 'exact', head: true }).eq('stage', 'new_lead'),
        supabase.from('lead_followups').select('id', { count: 'exact', head: true }).eq('status', 'pending').lte('scheduled_at', `${today}T23:59:59`),
        supabase.from('campus_visits').select('id', { count: 'exact', head: true }).gte('scheduled_at', `${today}T00:00:00`).lte('scheduled_at', `${today}T23:59:59`),
        supabase.from('applications').select('id', { count: 'exact', head: true }),
      ]);
      setMetrics({
        leads: leadsRes.count || 0,
        followups: followupsRes.count || 0,
        visits: visitsRes.count || 0,
        applications: appsRes.count || 0,
      });
    };
    fetchData();
  }, []);

  return (
    <WorkScaffold title="Admissions Work" subtitle={`${displayName}, manage today’s pipeline`}>
      <SegmentedControl
        value={filter}
        onChange={setFilter}
        options={[{ value: 'mine', label: 'Mine' }, { value: 'team', label: 'Team' }]}
      />
      <StatusCard
        icon={Phone}
        title="Follow-ups due now"
        subtitle="Prioritize calls and WhatsApp replies before they age."
        value={String(metrics.followups)}
        tone="purple"
      />
      <View style={styles.metricRow}>
        <MetricCard icon={Users} label="New leads" value={String(metrics.leads)} tone="purple" />
        <MetricCard icon={Calendar} label="Visits today" value={String(metrics.visits)} tone="yellow" />
        <MetricCard icon={BookOpen} label="Applications" value={String(metrics.applications)} tone="green" />
      </View>
      <SectionTitle title="Admission actions" />
      <View style={styles.actionGrid}>
        <ActionTile icon={Phone} label="Call queue" subtitle="Due and overdue" tone="purple" />
        <ActionTile icon={MessageCircle} label="WhatsApp replies" subtitle="Pending responses" tone="green" />
        <ActionTile icon={Users} label="Lead list" subtitle="New and active leads" tone="blue" />
        <ActionTile icon={Calendar} label="Visits" subtitle="Today’s campus visits" tone="yellow" />
      </View>
    </WorkScaffold>
  );
}

function LeadershipWork({ displayName, role }: { displayName: string; role: string }) {
  const [range, setRange] = useState<AdminRange>('today');
  const [metrics, setMetrics] = useState<WorkMetric>({ staffPresent: 0, leaveToday: 0, feeStudents: 0, feeDue: 0 });
  const [studentQuery, setStudentQuery] = useState('');

  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);
    const fetchData = async () => {
      const [staffRes, leaveRes, feeRes] = await Promise.all([
        supabase.from('employee_attendance').select('id', { count: 'exact', head: true }).eq('date', today).not('punch_in', 'is', null),
        supabase.from('employee_leave_requests').select('id', { count: 'exact', head: true }).eq('status', 'approved').lte('start_date', today).gte('end_date', today),
        supabase.from('fee_ledger').select('student_id, balance').in('status', ['due', 'overdue']).gt('balance', 0),
      ]);
      const feeRows = feeRes.data || [];
      setMetrics({
        staffPresent: staffRes.count || 0,
        leaveToday: leaveRes.count || 0,
        feeStudents: new Set(feeRows.map((row: any) => row.student_id)).size,
        feeDue: feeRows.reduce((sum: number, row: any) => sum + Number(row.balance || 0), 0),
      });
    };
    fetchData();
  }, [range]);

  return (
    <WorkScaffold title={role === 'principal' ? 'Principal Desk' : 'Admin Command'} subtitle={`${displayName}, today’s operating view`}>
      <PillFilter
        value={range}
        onChange={setRange}
        options={[{ value: 'today', label: 'Today' }, { value: 'yesterday', label: 'Yesterday' }, { value: '7d', label: 'Last 7 days' }]}
      />
      <StatusCard
        icon={IndianRupee}
        title="Fee dues need follow-up"
        subtitle={`${metrics.feeStudents} students have unpaid balances.`}
        value={`₹${Math.round(metrics.feeDue / 1000)}K`}
        tone="yellow"
      />
      <View style={styles.metricRow}>
        <MetricCard icon={CheckCircle2} label="Staff present" value={String(metrics.staffPresent)} tone="green" />
        <MetricCard icon={CalendarOff} label="On leave" value={String(metrics.leaveToday)} tone="pink" />
        <MetricCard icon={Users} label="Due students" value={String(metrics.feeStudents)} tone="yellow" />
      </View>
      <SectionTitle title="Student search" />
      <View style={styles.searchBox}>
        <Search size={16} color={colors.textMuted} />
        <TextInput
          value={studentQuery}
          onChangeText={setStudentQuery}
          placeholder="Search admission no, student name..."
          placeholderTextColor={colors.textMuted}
          style={styles.searchInput}
        />
      </View>
      <SectionTitle title="Leadership actions" />
      <View style={styles.actionGrid}>
        <ActionTile icon={Users} label="Staff attendance" subtitle="Today and trends" tone="green" />
        <ActionTile icon={BookOpen} label="Student attendance" subtitle="Course and class view" tone="blue" />
        <ActionTile icon={Calendar} label="Timetable" subtitle="Substitution planning" tone="purple" />
        <ActionTile icon={IndianRupee} label="Fee due" subtitle="Students and overdue amount" tone="yellow" />
      </View>
    </WorkScaffold>
  );
}

function FacultyWork({ displayName }: { displayName: string }) {
  return (
    <WorkScaffold title="Teaching Work" subtitle={`${displayName}, your classes and students`}>
      <StatusCard
        icon={BookOpen}
        title="Today’s classes"
        subtitle="Open class attendance, timetable, and student lists from here."
        value="0"
        tone="blue"
        onPress={() => router.push('/(tabs)/classes' as any)}
      />
      <SectionTitle title="Faculty actions" />
      <View style={styles.actionGrid}>
        <ActionTile icon={BookOpen} label="Classes" subtitle="Today’s schedule" tone="blue" onPress={() => router.push('/(tabs)/classes' as any)} />
        <ActionTile icon={CheckCircle2} label="Attendance" subtitle="Mark class attendance" tone="green" onPress={() => router.push('/(tabs)/classes' as any)} />
        <ActionTile icon={Users} label="Students" subtitle="Student records" tone="purple" />
        <ActionTile icon={Calendar} label="Timetable" subtitle="Upcoming sessions" tone="yellow" />
      </View>
    </WorkScaffold>
  );
}

function EmployeeWork({ displayName }: { displayName: string }) {
  return (
    <WorkScaffold title="My Work" subtitle={`${displayName}, quick access to work tools`}>
      <StatusCard
        icon={Bell}
        title="No role-specific workspace yet"
        subtitle="Use HR, attendance, notices, and inbox while your role module is configured."
        tone="neutral"
      />
      <SectionTitle title="Work actions" />
      <View style={styles.actionGrid}>
        <ActionTile icon={CalendarOff} label="Leave" subtitle="Apply or view history" tone="purple" onPress={() => router.push('/(tabs)/hr' as any)} />
        <ActionTile icon={Clock} label="Attendance" subtitle="Logs and shifts" tone="green" onPress={() => router.push('/(tabs)/hr' as any)} />
        <ActionTile icon={Bell} label="Inbox" subtitle="Approvals and alerts" tone="yellow" onPress={() => router.push('/(tabs)/inbox' as any)} />
        <ActionTile icon={Users} label="Directory" subtitle="Find colleagues" tone="blue" onPress={() => router.push('/(tabs)/team' as any)} />
      </View>
    </WorkScaffold>
  );
}

function WorkScaffold({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <ScreenHeader title={title} subtitle={subtitle} />
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

function Loader() {
  return (
    <View style={styles.loader}>
      <ActivityIndicator size="large" color={colors.primary} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: spacing.lg, paddingBottom: 110, gap: spacing.lg },
  loader: {
    minHeight: 240,
    alignItems: 'center',
    justifyContent: 'center',
  },
  metricRow: { flexDirection: 'row', gap: spacing.sm },
  actionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  searchBox: {
    minHeight: 48,
    borderRadius: radius.full,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  searchInput: { flex: 1, ...typography.body, color: colors.text },
});
