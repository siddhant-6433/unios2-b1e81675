import { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView,
  TouchableOpacity, TextInput, ActivityIndicator, Alert, Modal,
} from 'react-native';
import { supabase } from '../../lib/supabase';
import { colors, radius } from '../../constants/Colors';
import { X } from 'lucide-react-native';

const LEAVE_TYPES = ['casual', 'sick', 'earned'];

/**
 * Shared leave-application bottom sheet.
 *
 * Used by the HR screen (Time tab) and the standalone Leave screen. Submits a
 * row into `employee_leave_requests` for the signed-in user.
 */
export function ApplyLeaveModal({ visible, onClose, onSuccess, userId }: {
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
      user_id: userId,
      leave_type: leaveType,
      start_date: startDate,
      end_date: endDate || startDate,
      days,
      reason: reason || null,
    });

    if (error) {
      Alert.alert('Error', error.message);
    } else {
      Alert.alert('Success', 'Leave request submitted');
      onSuccess();
    }
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

          <ScrollView style={{ gap: 16 }} contentContainerStyle={{ gap: 16, paddingBottom: 24 }}>
            <View>
              <Text style={modalStyles.label}>Leave Type</Text>
              <View style={modalStyles.typeRow}>
                {LEAVE_TYPES.map((t) => (
                  <TouchableOpacity
                    key={t}
                    style={[modalStyles.typeChip, leaveType === t && modalStyles.typeChipActive]}
                    onPress={() => setLeaveType(t)}
                  >
                    <Text style={[modalStyles.typeChipText, leaveType === t && { color: '#fff' }]}>
                      {t.charAt(0).toUpperCase() + t.slice(1)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <View>
              <Text style={modalStyles.label}>Start Date</Text>
              <TextInput
                style={modalStyles.input}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={colors.textMuted}
                value={startDate}
                onChangeText={setStartDate}
              />
            </View>

            <View>
              <Text style={modalStyles.label}>End Date (optional for single day)</Text>
              <TextInput
                style={modalStyles.input}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={colors.textMuted}
                value={endDate}
                onChangeText={setEndDate}
              />
            </View>

            <View>
              <Text style={modalStyles.label}>Reason</Text>
              <TextInput
                style={[modalStyles.input, { height: 80, textAlignVertical: 'top' }]}
                placeholder="Optional"
                placeholderTextColor={colors.textMuted}
                value={reason}
                onChangeText={setReason}
                multiline
              />
            </View>

            <TouchableOpacity
              style={[modalStyles.submitBtn, submitting && { opacity: 0.5 }]}
              onPress={submit}
              disabled={submitting}
            >
              {submitting ? <ActivityIndicator color="#fff" size="small" /> : <Text style={modalStyles.submitText}>Submit Request</Text>}
            </TouchableOpacity>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const modalStyles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    backgroundColor: colors.card, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
    paddingHorizontal: 24, paddingTop: 20, maxHeight: '85%',
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  title: { fontSize: 18, fontWeight: '700', color: colors.text },
  label: { fontSize: 14, fontWeight: '600', color: colors.text, marginBottom: 8 },
  input: {
    backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, paddingHorizontal: 16, paddingVertical: 12,
    fontSize: 15, color: colors.text,
  },
  typeRow: { flexDirection: 'row', gap: 8 },
  typeChip: {
    flex: 1, paddingVertical: 10, borderRadius: radius.sm,
    borderWidth: 1, borderColor: colors.border, alignItems: 'center',
  },
  typeChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  typeChipText: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
  submitBtn: {
    backgroundColor: colors.primary, borderRadius: radius.md,
    height: 52, alignItems: 'center', justifyContent: 'center',
  },
  submitText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
