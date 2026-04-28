import { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, SafeAreaView,
  TouchableOpacity, ActivityIndicator, Linking,
} from 'react-native';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { colors, spacing, radius, typography } from '../../constants/Colors';
import {
  CheckCircle, AlertCircle, Clock, CreditCard,
} from 'lucide-react-native';

interface FeeItem {
  id: string;
  fee_head: string;
  total_amount: number;
  paid_amount: number;
  balance: number;
  status: string;
  due_date: string;
}

export default function FeesScreen() {
  const { user, role } = useAuth();
  const [fees, setFees] = useState<FeeItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchFees();
  }, []);

  const fetchFees = async () => {
    setLoading(true);

    // For parents, find the linked student; for students, use their own ID
    let studentId = user?.id;

    if (role === 'parent') {
      const { data: studentData } = await supabase
        .from('students')
        .select('id')
        .eq('parent_user_id', user?.id)
        .limit(1)
        .single();
      if (studentData) studentId = studentData.id;
    } else {
      const { data: studentData } = await supabase
        .from('students')
        .select('id')
        .eq('user_id', user?.id)
        .limit(1)
        .single();
      if (studentData) studentId = studentData.id;
    }

    const { data } = await supabase
      .from('fee_ledger')
      .select('id, total_amount, paid_amount, balance, status, due_date, term, fee_codes:fee_code_id(name)')
      .eq('student_id', studentId)
      .order('due_date', { ascending: true });

    if (data) {
      setFees(data.map((f: any) => ({
        id: f.id,
        fee_head: f.fee_codes?.name || f.term || 'Fee',
        total_amount: Number(f.total_amount),
        paid_amount: Number(f.paid_amount),
        balance: Number(f.balance || 0),
        status: f.status,
        due_date: f.due_date,
      })));
    }
    setLoading(false);
  };

  const totalDue = fees.reduce((s, f) => s + f.balance, 0);
  const totalPaid = fees.reduce((s, f) => s + f.paid_amount, 0);

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Fees</Text>

        {/* Summary */}
        <View style={styles.summaryRow}>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Amount Due</Text>
            <Text style={[styles.summaryValue, totalDue > 0 ? { color: colors.destructive } : { color: colors.success }]}>
              ₹{totalDue.toLocaleString('en-IN')}
            </Text>
          </View>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Total Paid</Text>
            <Text style={[styles.summaryValue, { color: colors.success }]}>
              ₹{totalPaid.toLocaleString('en-IN')}
            </Text>
          </View>
        </View>

        {/* Pay Now */}
        {totalDue > 0 && (
          <TouchableOpacity style={styles.payButton} activeOpacity={0.8}>
            <CreditCard size={18} color="#fff" />
            <Text style={styles.payButtonText}>Pay Now — ₹{totalDue.toLocaleString('en-IN')}</Text>
          </TouchableOpacity>
        )}

        {/* Fee items */}
        <View style={styles.feeList}>
          {fees.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>No fees due right now</Text>
            </View>
          ) : (
            fees.map((fee) => (
              <View key={fee.id} style={styles.feeItem}>
                <View style={[styles.feeIcon, {
                  backgroundColor: fee.status === 'paid' ? colors.successLight :
                    fee.status === 'overdue' ? colors.destructiveLight : colors.warningLight,
                }]}>
                  {fee.status === 'paid' ? <CheckCircle size={18} color={colors.success} /> :
                   fee.status === 'overdue' ? <AlertCircle size={18} color={colors.destructive} /> :
                   <Clock size={18} color={colors.warning} />}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.feeHead}>{fee.fee_head}</Text>
                  <Text style={styles.feeDue}>
                    Due {new Date(fee.due_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={[styles.feeAmount, fee.status === 'paid' && { color: colors.success }]}>
                    ₹{(fee.status === 'paid' ? fee.paid_amount : fee.balance).toLocaleString('en-IN')}
                  </Text>
                  <Text style={[styles.feeStatus, {
                    color: fee.status === 'paid' ? colors.success :
                      fee.status === 'overdue' ? colors.destructive : colors.warning,
                  }]}>
                    {fee.status}
                  </Text>
                </View>
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  scroll: { padding: spacing.lg, paddingBottom: 100 },
  title: { ...typography.h1, color: colors.text, marginBottom: spacing.lg, paddingTop: spacing.sm },
  summaryRow: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.lg },
  summaryCard: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: radius.xl,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  summaryLabel: { ...typography.small, color: colors.textSecondary },
  summaryValue: { fontSize: 22, fontWeight: '700', marginTop: spacing.xs },
  payButton: {
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    marginBottom: spacing.lg,
    minHeight: 48,
  },
  payButtonText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  feeList: {
    backgroundColor: colors.card,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    overflow: 'hidden',
  },
  feeItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.lg,
    gap: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.cardBorder,
  },
  feeIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  feeHead: { ...typography.bodyMedium, color: colors.text },
  feeDue: { ...typography.caption, color: colors.textMuted, marginTop: 1 },
  feeAmount: { ...typography.bodyMedium, color: colors.text },
  feeStatus: { ...typography.small, textTransform: 'capitalize', marginTop: 1 },
  empty: { padding: spacing.xxl, alignItems: 'center' },
  emptyText: { ...typography.body, color: colors.textMuted },
});
