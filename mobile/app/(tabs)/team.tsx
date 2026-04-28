import { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, SafeAreaView,
  TouchableOpacity, ActivityIndicator, TextInput, FlatList,
} from 'react-native';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { colors } from '../../constants/Colors';
import {
  Search, Users, Phone, Mail, ChevronRight,
  Building2, UserCheck, CalendarOff,
} from 'lucide-react-native';

interface Employee {
  user_id: string;
  display_name: string;
  phone: string;
  role: string;
  department: string | null;
  institution: string | null;
  campus: string | null;
}

export default function TeamScreen() {
  const { user } = useAuth();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [todayOff, setTodayOff] = useState<string[]>([]);
  const [todayPunched, setTodayPunched] = useState<Set<string>>(new Set());

  useEffect(() => { fetchTeam(); }, []);

  const fetchTeam = async () => {
    setLoading(true);

    // Fetch all staff profiles
    const { data: profiles } = await supabase
      .from('profiles')
      .select('user_id, display_name, phone, role, department, institution, campus')
      .order('display_name');

    if (profiles) {
      // Filter to staff only (exclude students/parents)
      setEmployees(profiles.filter((p: any) =>
        !['student', 'parent'].includes(p.role || '')
      ) as Employee[]);
    }

    // Fetch today's attendance
    const today = new Date().toISOString().slice(0, 10);
    const { data: attendance } = await supabase
      .from('employee_attendance')
      .select('user_id')
      .eq('date', today);

    if (attendance) {
      setTodayPunched(new Set(attendance.map((a: any) => a.user_id)));
    }

    // Fetch today's leave
    const { data: leaves } = await supabase
      .from('employee_leave_requests')
      .select('user_id')
      .eq('status', 'approved')
      .lte('start_date', today)
      .gte('end_date', today);

    if (leaves) {
      setTodayOff(leaves.map((l: any) => l.user_id));
    }

    setLoading(false);
  };

  const filtered = search
    ? employees.filter(e =>
        e.display_name?.toLowerCase().includes(search.toLowerCase()) ||
        e.department?.toLowerCase().includes(search.toLowerCase()) ||
        e.phone?.includes(search)
      )
    : employees;

  const notInYet = employees.filter(e => !todayPunched.has(e.user_id) && !todayOff.includes(e.user_id));
  const offTodayEmps = employees.filter(e => todayOff.includes(e.user_id));

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  const getInitials = (name: string) =>
    name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();

  const avatarColors = ['#7c3aed', '#0284c7', '#059669', '#d97706', '#dc2626'];
  const getAvatarColor = (name: string) => {
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    return avatarColors[Math.abs(hash) % avatarColors.length];
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Team</Text>

        {/* Search */}
        <View style={styles.searchRow}>
          <Search size={18} color={colors.textMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search employees..."
            placeholderTextColor={colors.textMuted}
            value={search}
            onChangeText={setSearch}
          />
        </View>

        {/* Stats chips */}
        <View style={styles.chipRow}>
          <View style={[styles.chip, styles.chipActive]}>
            <Text style={styles.chipTextActive}>All ({employees.length})</Text>
          </View>
          <View style={styles.chip}>
            <Text style={styles.chipText}>Not in yet ({notInYet.length})</Text>
          </View>
          <View style={styles.chip}>
            <Text style={styles.chipText}>Off ({offTodayEmps.length})</Text>
          </View>
        </View>

        {/* Off today */}
        {offTodayEmps.length > 0 && (
          <View style={styles.offSection}>
            <Text style={styles.sectionTitle}>Off Today</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }}>
              {offTodayEmps.map((emp) => (
                <View key={emp.user_id} style={styles.offAvatar}>
                  <View style={[styles.avatarCircle, { backgroundColor: getAvatarColor(emp.display_name) + '20' }]}>
                    <Text style={[styles.avatarInitials, { color: getAvatarColor(emp.display_name) }]}>
                      {getInitials(emp.display_name)}
                    </Text>
                  </View>
                  <Text style={styles.offName} numberOfLines={1}>{emp.display_name.split(' ')[0]}</Text>
                </View>
              ))}
            </ScrollView>
          </View>
        )}

        {/* Employee Directory */}
        <Text style={styles.sectionTitle}>Employee Directory ({filtered.length})</Text>
        <View style={styles.listCard}>
          {filtered.map((emp) => {
            const isPunchedIn = todayPunched.has(emp.user_id);
            const isOff = todayOff.includes(emp.user_id);
            return (
              <View key={emp.user_id} style={styles.empRow}>
                <View style={[styles.avatarCircle, { backgroundColor: getAvatarColor(emp.display_name) + '20' }]}>
                  <Text style={[styles.avatarInitials, { color: getAvatarColor(emp.display_name) }]}>
                    {getInitials(emp.display_name)}
                  </Text>
                  {isPunchedIn && <View style={styles.onlineDot} />}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.empName}>{emp.display_name}</Text>
                  <Text style={styles.empRole}>
                    {(emp.role || '').replace(/_/g, ' ')}
                    {emp.department ? ` · ${emp.department}` : ''}
                  </Text>
                </View>
                {isOff && (
                  <View style={styles.offBadge}>
                    <Text style={styles.offBadgeText}>OFF</Text>
                  </View>
                )}
              </View>
            );
          })}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: 16, paddingBottom: 100 },
  title: { fontSize: 24, fontWeight: '700', color: colors.text, paddingTop: 8, marginBottom: 12 },

  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: colors.card, borderRadius: 12, paddingHorizontal: 14, height: 48,
    borderWidth: 1, borderColor: colors.border, marginBottom: 12,
  },
  searchInput: { flex: 1, fontSize: 15, color: colors.text },

  chipRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  chip: {
    borderRadius: 20, paddingHorizontal: 14, paddingVertical: 7,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 12, fontWeight: '600', color: colors.textSecondary },
  chipTextActive: { fontSize: 12, fontWeight: '600', color: '#fff' },

  offSection: { marginBottom: 16 },
  offAvatar: { alignItems: 'center', marginRight: 16, width: 60 },
  offName: { fontSize: 11, color: colors.textSecondary, marginTop: 4, textAlign: 'center' },

  sectionTitle: { fontSize: 16, fontWeight: '700', color: colors.text, marginBottom: 8 },

  listCard: {
    backgroundColor: colors.card, borderRadius: 14,
    borderWidth: 1, borderColor: colors.cardBorder, overflow: 'hidden',
  },
  empRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: 14, borderBottomWidth: 1, borderBottomColor: colors.cardBorder,
  },
  avatarCircle: {
    width: 44, height: 44, borderRadius: 22,
    alignItems: 'center', justifyContent: 'center', position: 'relative',
  },
  avatarInitials: { fontSize: 14, fontWeight: '700' },
  onlineDot: {
    position: 'absolute', bottom: 0, right: 0,
    width: 12, height: 12, borderRadius: 6,
    backgroundColor: colors.success, borderWidth: 2, borderColor: colors.card,
  },
  empName: { fontSize: 14, fontWeight: '600', color: colors.text },
  empRole: { fontSize: 11, color: colors.textSecondary, marginTop: 1, textTransform: 'capitalize' as any },
  offBadge: {
    backgroundColor: '#fef2f2', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3,
  },
  offBadgeText: { fontSize: 10, fontWeight: '700', color: '#dc2626' },
});
