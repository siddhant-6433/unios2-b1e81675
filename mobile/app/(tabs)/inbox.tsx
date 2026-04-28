import { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, SafeAreaView,
  TouchableOpacity, ActivityIndicator, Alert, Image,
} from 'react-native';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { colors, radius } from '../../constants/Colors';
import {
  Clock, UserCheck, CalendarOff, MapPin, Briefcase,
  Check, X, ChevronRight, Inbox as InboxIcon,
} from 'lucide-react-native';

interface ApprovalItem {
  id: string;
  type: 'leave' | 'face' | 'attendance_reg';
  user_name: string;
  user_phone: string;
  date: string;
  detail: string;
  image_url?: string;
}

export default function InboxScreen() {
  const { user } = useAuth();
  const [items, setItems] = useState<ApprovalItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState<string | null>(null);

  useEffect(() => { fetchApprovals(); }, []);

  const fetchApprovals = async () => {
    setLoading(true);
    const allItems: ApprovalItem[] = [];

    // Leave requests
    const { data: leaves } = await supabase
      .from('employee_leave_requests')
      .select('id, leave_type, start_date, end_date, days, reason, created_at, user_id')
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    if (leaves) {
      const userIds = leaves.map(l => l.user_id);
      const { data: profiles } = await supabase
        .from('profiles')
        .select('user_id, display_name, phone')
        .in('user_id', userIds);
      const profileMap = new Map((profiles || []).map(p => [p.user_id, p]));

      for (const l of leaves) {
        const p = profileMap.get(l.user_id);
        allItems.push({
          id: l.id,
          type: 'leave',
          user_name: p?.display_name || 'Unknown',
          user_phone: p?.phone || '',
          date: l.start_date,
          detail: `${l.leave_type} leave — ${l.days} day${l.days > 1 ? 's' : ''} (${new Date(l.start_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}${l.start_date !== l.end_date ? ` - ${new Date(l.end_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}` : ''})`,
        });
      }
    }

    // Face registrations
    const { data: faces } = await supabase
      .from('employee_face_registrations')
      .select('id, user_id, image_url, created_at')
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    if (faces) {
      const userIds = faces.map(f => f.user_id);
      const { data: profiles } = await supabase
        .from('profiles')
        .select('user_id, display_name, phone')
        .in('user_id', userIds);
      const profileMap = new Map((profiles || []).map(p => [p.user_id, p]));

      for (const f of faces) {
        const p = profileMap.get(f.user_id);
        allItems.push({
          id: f.id,
          type: 'face',
          user_name: p?.display_name || 'Unknown',
          user_phone: p?.phone || '',
          date: f.created_at,
          detail: 'Face Registration',
          image_url: f.image_url,
        });
      }
    }

    setItems(allItems);
    setLoading(false);
  };

  const handleApprove = async (item: ApprovalItem) => {
    setProcessing(item.id);
    if (item.type === 'leave') {
      await supabase.from('employee_leave_requests')
        .update({ status: 'approved', approved_by: user?.id, approved_at: new Date().toISOString() })
        .eq('id', item.id);
    } else if (item.type === 'face') {
      await supabase.from('employee_face_registrations')
        .update({ status: 'approved', approved_by: user?.id, approved_at: new Date().toISOString() })
        .eq('id', item.id);
    }
    setProcessing(null);
    fetchApprovals();
  };

  const handleReject = async (item: ApprovalItem) => {
    Alert.alert('Reject', `Reject ${item.user_name}'s request?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Reject', style: 'destructive',
        onPress: async () => {
          setProcessing(item.id);
          if (item.type === 'leave') {
            await supabase.from('employee_leave_requests')
              .update({ status: 'rejected' }).eq('id', item.id);
          } else if (item.type === 'face') {
            await supabase.from('employee_face_registrations')
              .update({ status: 'rejected', rejected_reason: 'Rejected by admin' }).eq('id', item.id);
          }
          setProcessing(null);
          fetchApprovals();
        },
      },
    ]);
  };

  const typeIcon = (type: string) => {
    if (type === 'leave') return <CalendarOff size={20} color="#7c3aed" />;
    if (type === 'face') return <UserCheck size={20} color="#0284c7" />;
    return <Clock size={20} color={colors.textMuted} />;
  };

  const typeBg = (type: string) => {
    if (type === 'leave') return '#f5f3ff';
    if (type === 'face') return '#f0f9ff';
    return colors.background;
  };

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
        <Text style={styles.title}>Inbox</Text>
        <Text style={styles.subtitle}>{items.length} pending approval{items.length !== 1 ? 's' : ''}</Text>

        {items.length === 0 ? (
          <View style={styles.emptyCard}>
            <InboxIcon size={32} color={colors.textMuted} />
            <Text style={styles.emptyTitle}>All caught up!</Text>
            <Text style={styles.emptyText}>No pending approvals</Text>
          </View>
        ) : (
          <View style={styles.list}>
            {items.map((item) => (
              <View key={`${item.type}-${item.id}`} style={styles.card}>
                {/* Face registration: show selfie prominently */}
                {item.type === 'face' && item.image_url ? (
                  <>
                    <Image source={{ uri: item.image_url }} style={styles.faceImage} />
                    <View style={styles.faceInfo}>
                      <Text style={styles.userName}>{item.user_name}</Text>
                      <Text style={styles.detail}>Face Registration</Text>
                      <Text style={styles.detailMono}>ID: {item.id.slice(0, 8).toUpperCase()}</Text>
                      <Text style={styles.detailDate}>
                        {new Date(item.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </Text>
                    </View>
                  </>
                ) : (
                  <View style={styles.cardHeader}>
                    <View style={[styles.typeIcon, { backgroundColor: typeBg(item.type) }]}>
                      {typeIcon(item.type)}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.userName}>{item.user_name}</Text>
                      <Text style={styles.detail}>{item.detail}</Text>
                    </View>
                  </View>
                )}
                <View style={styles.cardActions}>
                  <TouchableOpacity
                    style={styles.approveBtn}
                    onPress={() => handleApprove(item)}
                    disabled={processing === item.id}
                    activeOpacity={0.7}
                  >
                    <Check size={16} color="#fff" />
                    <Text style={styles.approveBtnText}>Approve</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.rejectBtn}
                    onPress={() => handleReject(item)}
                    disabled={processing === item.id}
                    activeOpacity={0.7}
                  >
                    <X size={16} color={colors.textSecondary} />
                    <Text style={styles.rejectBtnText}>Reject</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: 16, paddingBottom: 100 },
  title: { fontSize: 24, fontWeight: '700', color: colors.text, paddingTop: 8 },
  subtitle: { fontSize: 13, color: colors.textSecondary, marginTop: 2, marginBottom: 16 },
  list: { gap: 12 },
  card: {
    backgroundColor: colors.card, borderRadius: 16, padding: 16,
    borderWidth: 1, borderColor: colors.cardBorder, gap: 14,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  typeIcon: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  userName: { fontSize: 15, fontWeight: '600', color: colors.text },
  detail: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  faceImage: {
    width: '100%' as any, height: 200, borderRadius: 12,
    backgroundColor: colors.border,
  },
  faceInfo: { gap: 2 },
  detailMono: { fontSize: 11, color: colors.textMuted, fontFamily: 'monospace' as any },
  detailDate: { fontSize: 11, color: colors.textMuted },
  cardActions: { flexDirection: 'row', gap: 10 },
  approveBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: colors.primary, borderRadius: 10, paddingVertical: 10,
  },
  approveBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  rejectBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: colors.background, borderRadius: 10, paddingVertical: 10,
    borderWidth: 1, borderColor: colors.border,
  },
  rejectBtnText: { color: colors.textSecondary, fontSize: 14, fontWeight: '500' },
  emptyCard: {
    backgroundColor: colors.card, borderRadius: 16, padding: 40,
    alignItems: 'center', gap: 8, borderWidth: 1, borderColor: colors.cardBorder,
  },
  emptyTitle: { fontSize: 16, fontWeight: '600', color: colors.text },
  emptyText: { fontSize: 13, color: colors.textMuted },
});
