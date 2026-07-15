/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../../contexts/AuthContext';
import { supabase } from '../../../lib/supabase';
import { router } from 'expo-router';
import {
  Fingerprint,
  CheckCircle,
  Calendar,
  MessageCircle,
  Users,
  MapPin,
  ChevronRight,
  AlertCircle,
} from 'lucide-react-native';
import { useTheme } from '../../../theme/ThemeContext';
import { spacing, radius } from '../../../theme/tokens';
import { formatTodaySubtitle, getGreeting } from '../../../lib/greetings';

/**
 * Super Admin–first Me cockpit (structure).
 * - Web-parity rotating greeting
 * - Punch hero
 * - Scoped pulse (not raw global dumps)
 * - Four pinned actions (no pastel wallpaper / vanity empty sections)
 */
export default function HomeScreen() {
  const { profile, role, user } = useAuth();
  const { colors } = useTheme();
  const displayName = profile?.display_name || 'there';
  const greeting = getGreeting(displayName);
  const subtitle = formatTodaySubtitle();

  const isStaff = !['student', 'parent'].includes(role || '');

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.canvas }]} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.greeting, { color: colors.ink }]} numberOfLines={2}>
              {greeting}
            </Text>
            <Text style={[styles.dateLine, { color: colors.inkSecondary }]}>{subtitle}</Text>
          </View>
          <TouchableOpacity
            style={[styles.avatar, { backgroundColor: colors.accentSoft }]}
            onPress={() => router.push('/(staff)/(tabs)/profile' as any)}
            activeOpacity={0.8}
          >
            <Text style={[styles.avatarText, { color: colors.accent }]}>
              {(profile?.display_name || 'U')
                .split(' ')
                .map((n) => n[0])
                .join('')
                .slice(0, 2)
                .toUpperCase()}
            </Text>
          </TouchableOpacity>
        </View>

        {isStaff ? (
          <StaffHome userId={user?.id || ''} isAdmin={['super_admin', 'campus_admin', 'principal', 'admission_head'].includes(role || '')} />
        ) : (
          <Text style={{ color: colors.inkSecondary, padding: spacing.md }}>
            Open the Campus app for student and parent features.
          </Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function StaffHome({ userId, isAdmin }: { userId: string; isAdmin: boolean }) {
  const { colors } = useTheme();
  const [punchStatus, setPunchStatus] = useState<'in' | 'out' | 'none'>('none');
  const [punchTime, setPunchTime] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pulse, setPulse] = useState({ present: 0, visits: 0, unreplied: 0 });
  const [attention, setAttention] = useState(0);

  const fetchStatus = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    const today = new Date().toISOString().slice(0, 10);

    const { data: attendance } = await supabase
      .from('employee_attendance')
      .select('punch_in, punch_out')
      .eq('user_id', userId)
      .eq('date', today)
      .order('punch_in', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (attendance) {
      if (attendance.punch_out) {
        setPunchStatus('out');
        setPunchTime(attendance.punch_out);
      } else {
        setPunchStatus('in');
        setPunchTime(attendance.punch_in);
      }
    } else {
      setPunchStatus('none');
      setPunchTime(null);
    }

    // Scoped "today" pulse — not global lead warehouse counts.
    const dayStart = `${today}T00:00:00`;
    const dayEnd = `${today}T23:59:59`;
    const [presentRes, visitsRes, unrepliedRes, leaveRes, faceRes] = await Promise.all([
      supabase
        .from('employee_attendance')
        .select('id', { count: 'exact', head: true })
        .eq('date', today)
        .not('punch_in', 'is', null)
        .is('punch_out', null),
      supabase
        .from('campus_visits')
        .select('id', { count: 'exact', head: true })
        .gte('visit_date', dayStart)
        .lte('visit_date', dayEnd),
      // Unreplied WA is role-sensitive; keep 0 until Chats badge RPC exists.
      Promise.resolve({ count: 0 }),
      isAdmin
        ? supabase
            .from('employee_leave_requests')
            .select('id', { count: 'exact', head: true })
            .eq('status', 'pending')
        : Promise.resolve({ count: 0 }),
      isAdmin
        ? supabase
            .from('employee_face_registrations')
            .select('id', { count: 'exact', head: true })
            .eq('status', 'pending')
        : Promise.resolve({ count: 0 }),
    ]);

    setPulse({
      present: presentRes.count || 0,
      visits: visitsRes.count || 0,
      unreplied: unrepliedRes.count || 0,
    });
    setAttention((leaveRes.count || 0) + (faceRes.count || 0));
    setLoading(false);
  }, [userId, isAdmin]);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const punchTitle =
    punchStatus === 'none'
      ? 'Mark attendance'
      : punchStatus === 'in'
        ? 'You are punched in'
        : 'Day complete';
  const punchSub =
    punchStatus === 'none'
      ? 'Start your day with a secure campus punch.'
      : punchTime
        ? `Since ${new Date(punchTime).toLocaleTimeString('en-IN', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: true,
          })}`
        : 'Attendance is up to date.';
  const punchValue = punchStatus === 'in' ? 'Active' : punchStatus === 'out' ? 'Done' : 'Ready';
  const punchTone =
    punchStatus === 'in' ? colors.tint.green : punchStatus === 'out' ? colors.tint.neutral : colors.tint.blue;

  return (
    <View style={styles.section}>
      {/* Punch hero */}
      <TouchableOpacity
        style={[styles.hero, { backgroundColor: punchTone.bg }]}
        onPress={() => router.push('/(staff)/work/punch' as any)}
        activeOpacity={0.85}
      >
        <View style={[styles.heroIcon, { backgroundColor: colors.card }]}>
          {punchStatus === 'in' ? (
            <CheckCircle size={22} color={punchTone.fg} />
          ) : (
            <Fingerprint size={22} color={punchTone.fg} />
          )}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.heroTitle, { color: colors.ink }]}>{punchTitle}</Text>
          <Text style={[styles.heroSub, { color: colors.inkSecondary }]}>{punchSub}</Text>
        </View>
        <Text style={[styles.heroValue, { color: punchTone.fg }]}>{punchValue}</Text>
      </TouchableOpacity>

      {/* Campus pulse */}
      <View style={styles.pulseHeader}>
        <Text style={[styles.sectionLabel, { color: colors.ink }]}>Today</Text>
        <Text style={[styles.scopeLabel, { color: colors.inkMuted }]}>All campuses</Text>
      </View>
      {loading ? (
        <ActivityIndicator color={colors.inkMuted} style={{ marginVertical: spacing.md }} />
      ) : (
        <View style={styles.metricRow}>
          <Metric
            colors={colors}
            label="Staff in"
            value={String(pulse.present)}
            icon={<Users size={16} color={colors.tint.green.fg} />}
          />
          <Metric
            colors={colors}
            label="Visits"
            value={String(pulse.visits)}
            icon={<Calendar size={16} color={colors.tint.yellow.fg} />}
          />
          <Metric
            colors={colors}
            label="Chats"
            value={pulse.unreplied > 0 ? String(pulse.unreplied) : '—'}
            icon={<MessageCircle size={16} color={colors.tint.blue.fg} />}
          />
        </View>
      )}

      {attention > 0 && (
        <TouchableOpacity
          style={[styles.attention, { backgroundColor: colors.tint.red.bg }]}
          onPress={() => router.push('/(staff)/(tabs)/inbox' as any)}
          activeOpacity={0.85}
        >
          <AlertCircle size={18} color={colors.tint.red.fg} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.attentionTitle, { color: colors.ink }]}>Needs attention</Text>
            <Text style={[styles.attentionSub, { color: colors.inkSecondary }]}>
              {attention} pending approval{attention === 1 ? '' : 's'}
            </Text>
          </View>
          <ChevronRight size={18} color={colors.inkMuted} />
        </TouchableOpacity>
      )}

      <Text style={[styles.sectionLabel, { color: colors.ink, marginTop: spacing.lg }]}>
        Pinned
      </Text>
      <View style={styles.pinGrid}>
        <Pin
          colors={colors}
          icon={<MapPin size={20} color={colors.ink} />}
          label="Visits"
          onPress={() => router.push('/(staff)/work/visits' as any)}
        />
        <Pin
          colors={colors}
          icon={<Users size={20} color={colors.ink} />}
          label="Directory"
          onPress={() => router.push('/(staff)/work/team' as any)}
        />
        <Pin
          colors={colors}
          icon={<MessageCircle size={20} color={colors.ink} />}
          label="Chats"
          onPress={() => router.push('/(staff)/(tabs)/inbox' as any)}
        />
        <Pin
          colors={colors}
          icon={<Fingerprint size={20} color={colors.ink} />}
          label="Punch"
          onPress={() => router.push('/(staff)/work/punch' as any)}
        />
      </View>
    </View>
  );
}

function Metric({
  colors,
  label,
  value,
  icon,
}: {
  colors: any;
  label: string;
  value: string;
  icon: ReactNode;
}) {
  return (
    <View style={[styles.metric, { backgroundColor: colors.card, borderColor: colors.line }]}>
      {icon}
      <Text style={[styles.metricValue, { color: colors.ink }]}>{value}</Text>
      <Text style={[styles.metricLabel, { color: colors.inkMuted }]}>{label}</Text>
    </View>
  );
}

function Pin({
  colors,
  icon,
  label,
  onPress,
}: {
  colors: any;
  icon: ReactNode;
  label: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.pin, { backgroundColor: colors.card, borderColor: colors.line }]}
      onPress={onPress}
      activeOpacity={0.85}
    >
      <View style={[styles.pinIcon, { backgroundColor: colors.cardSubtle }]}>{icon}</View>
      <Text style={[styles.pinLabel, { color: colors.ink }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { paddingHorizontal: spacing.md, paddingBottom: spacing.xxl },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    marginTop: spacing.sm,
    marginBottom: spacing.lg,
  },
  greeting: { fontSize: 24, fontWeight: '700', letterSpacing: -0.4, lineHeight: 30 },
  dateLine: { fontSize: 14, marginTop: 4 },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: 14, fontWeight: '700' },
  section: { gap: spacing.md },
  hero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: radius.xl,
    padding: spacing.md,
  },
  heroIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroTitle: { fontSize: 16, fontWeight: '700' },
  heroSub: { fontSize: 13, marginTop: 2 },
  heroValue: { fontSize: 14, fontWeight: '700' },
  pulseHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
  },
  sectionLabel: { fontSize: 16, fontWeight: '700' },
  scopeLabel: { fontSize: 12, fontWeight: '500' },
  metricRow: { flexDirection: 'row', gap: spacing.sm },
  metric: {
    flex: 1,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.sm,
    gap: 4,
  },
  metricValue: { fontSize: 22, fontWeight: '700', fontVariant: ['tabular-nums'] },
  metricLabel: { fontSize: 12, fontWeight: '500' },
  attention: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  attentionTitle: { fontSize: 15, fontWeight: '600' },
  attentionSub: { fontSize: 13, marginTop: 2 },
  pinGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  pin: {
    width: '48%',
    flexGrow: 1,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  pinIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinLabel: { fontSize: 15, fontWeight: '600' },
});
