import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, SafeAreaView,
  TouchableOpacity, ActivityIndicator, RefreshControl, Modal, Alert,
} from 'react-native';
import { supabase } from '../../../lib/supabase';
import { colors, radius } from '../../../constants/Colors';
import {
  FileText, ChevronRight, X, Wallet,
} from 'lucide-react-native';

const money = (n: any) =>
  `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

const fmtDate = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

export default function PayslipsScreen() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [selected, setSelected] = useState<any>(null);
  const [lines, setLines] = useState<any[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [showDetail, setShowDetail] = useState(false);

  const fetchPayslips = useCallback(async () => {
    const { data, error } = await (supabase as any).rpc('my_payslips');
    if (error) {
      Alert.alert('Could not load payslips', error.message);
      setRows([]);
    } else {
      setRows(data ?? []);
    }
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => { fetchPayslips(); }, [fetchPayslips]);

  const onRefresh = () => { setRefreshing(true); fetchPayslips(); };

  const openDetail = async (row: any) => {
    setSelected(row);
    setLines([]);
    setShowDetail(true);
    setDetailLoading(true);
    const { data, error } = await (supabase as any).rpc('payslip_detail', { _line_id: row.line_id });
    if (error) Alert.alert('Could not load payslip', error.message);
    setLines(data ?? []);
    setDetailLoading(false);
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        {rows.length === 0 ? (
          <View style={styles.emptyCard}>
            <FileText size={32} color={colors.textMuted} />
            <Text style={styles.emptyText}>No payslips yet</Text>
            <Text style={styles.emptyHint}>Released payroll cycles will appear here</Text>
          </View>
        ) : (
          <View style={{ gap: 10 }}>
            {rows.map((row: any) => (
              <TouchableOpacity key={row.line_id} style={styles.card} onPress={() => openDetail(row)} activeOpacity={0.8}>
                <View style={styles.cardIcon}>
                  <Wallet size={20} color={colors.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>{row.cycle_name || 'Payroll'}</Text>
                  <Text style={styles.cardSub}>
                    {fmtDate(row.period_start)} — {fmtDate(row.period_end)}
                  </Text>
                  <View style={styles.metaRow}>
                    <Text style={styles.metaText}>Gross {money(row.gross_earnings)}</Text>
                    <Text style={styles.metaText}>Ded. {money(row.total_deductions)}</Text>
                  </View>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={styles.net}>{money(row.net_pay)}</Text>
                  <ChevronRight size={16} color={colors.textMuted} />
                </View>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </ScrollView>

      <Modal visible={showDetail} animationType="slide" transparent onRequestClose={() => setShowDetail(false)}>
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <View>
                <Text style={styles.sheetTitle}>{selected?.cycle_name || 'Payslip'}</Text>
                <Text style={styles.sheetSub}>
                  {fmtDate(selected?.period_start)} — {fmtDate(selected?.period_end)}
                </Text>
              </View>
              <TouchableOpacity onPress={() => setShowDetail(false)}><X size={24} color={colors.textSecondary} /></TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
              <View style={styles.summaryRow}>
                <View style={styles.summaryCell}>
                  <Text style={styles.summaryLabel}>Gross</Text>
                  <Text style={styles.summaryValue}>{money(selected?.gross_earnings)}</Text>
                </View>
                <View style={styles.summaryCell}>
                  <Text style={styles.summaryLabel}>Deductions</Text>
                  <Text style={styles.summaryValue}>{money(selected?.total_deductions)}</Text>
                </View>
                <View style={styles.summaryCell}>
                  <Text style={styles.summaryLabel}>Net Pay</Text>
                  <Text style={[styles.summaryValue, { color: colors.success }]}>{money(selected?.net_pay)}</Text>
                </View>
              </View>

              {detailLoading ? (
                <ActivityIndicator style={{ marginTop: 24 }} color={colors.primary} />
              ) : lines.length === 0 ? (
                <Text style={styles.noLines}>No component breakdown for this payslip.</Text>
              ) : (
                <View style={styles.linesCard}>
                  {lines.map((l: any, idx: number) => {
                    const isDeduction = String(l.kind || '').toLowerCase().includes('deduction');
                    return (
                      <View key={`${l.component_code}-${idx}`} style={styles.lineRow}>
                        <Text style={styles.lineName}>{l.component_name || l.component_code}</Text>
                        <Text style={[styles.lineAmount, { color: isDeduction ? colors.destructive : colors.success }]}>
                          {isDeduction ? '-' : '+'}{money(l.amount)}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  scroll: { padding: 16, paddingBottom: 100 },

  emptyCard: {
    backgroundColor: colors.card, borderRadius: radius.lg, padding: 32,
    alignItems: 'center', gap: 10, borderWidth: 1, borderColor: colors.cardBorder,
  },
  emptyText: { fontSize: 14, fontWeight: '600', color: colors.textSecondary },
  emptyHint: { fontSize: 12, color: colors.textMuted },

  card: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: colors.card, borderRadius: radius.lg, padding: 14,
    borderWidth: 1, borderColor: colors.cardBorder,
  },
  cardIcon: {
    width: 40, height: 40, borderRadius: radius.full,
    backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center',
  },
  cardTitle: { fontSize: 15, fontWeight: '700', color: colors.text },
  cardSub: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  metaRow: { flexDirection: 'row', gap: 12, marginTop: 4 },
  metaText: { fontSize: 11, color: colors.textMuted },
  net: { fontSize: 15, fontWeight: '700', color: colors.text },

  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    backgroundColor: colors.card, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
    paddingHorizontal: 24, paddingTop: 20, maxHeight: '85%',
  },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  sheetTitle: { fontSize: 18, fontWeight: '700', color: colors.text },
  sheetSub: { fontSize: 13, color: colors.textSecondary, marginTop: 2 },

  summaryRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  summaryCell: {
    flex: 1, backgroundColor: colors.background, borderRadius: radius.md,
    padding: 12, alignItems: 'center', borderWidth: 1, borderColor: colors.border,
  },
  summaryLabel: { fontSize: 11, color: colors.textMuted },
  summaryValue: { fontSize: 14, fontWeight: '700', color: colors.text, marginTop: 4 },

  noLines: { fontSize: 13, color: colors.textMuted, textAlign: 'center', marginTop: 24 },
  linesCard: {
    backgroundColor: colors.card, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.cardBorder, overflow: 'hidden',
  },
  lineRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 14, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: colors.cardBorder,
  },
  lineName: { flex: 1, fontSize: 13, color: colors.textSecondary, marginRight: 12 },
  lineAmount: { fontSize: 13, fontWeight: '700' },
});
