import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, SafeAreaView,
  TouchableOpacity, ActivityIndicator, TextInput, Alert,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { supabase } from '../../../../lib/supabase';
import { colors } from '../../../../constants/Colors';
import {
  Calendar, MapPin, Phone, UserCheck, CheckCircle2, XCircle, Clock, Footprints,
} from 'lucide-react-native';

interface VisitDetail {
  id: string;
  lead_id: string;
  visit_date: string;
  status: string;
  visit_type: string | null;
  checked_in_at: string | null;
  purpose: string | null;
  outcome: string | null;
  feedback: string | null;
  lead_name: string;
  lead_phone: string;
  campus_name: string;
}

const OUTCOMES = [
  { value: 'interested', label: 'Interested' },
  { value: 'token_collected', label: 'Token collected' },
  { value: 'offer_discussed', label: 'Offer discussed' },
  { value: 'needs_followup', label: 'Needs follow-up' },
  { value: 'not_interested', label: 'Not interested' },
  { value: 'other', label: 'Other' },
];

function fmtTime(iso: string) {
  return new Date(iso).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true,
  });
}

export default function VisitDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [visit, setVisit] = useState<VisitDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState('interested');
  const [feedback, setFeedback] = useState('');
  const [wantFollowup, setWantFollowup] = useState(false);

  const fetchVisit = useCallback(async () => {
    if (!id) return;
    const { data } = await supabase
      .from('campus_visits')
      .select(`id, lead_id, visit_date, status, visit_type, checked_in_at, purpose, outcome, feedback,
        leads!inner(name, phone), campuses(name)`)
      .eq('id', id)
      .maybeSingle();
    if (data) {
      const r: any = data;
      setVisit({
        id: r.id, lead_id: r.lead_id, visit_date: r.visit_date, status: r.status,
        visit_type: r.visit_type, checked_in_at: r.checked_in_at, purpose: r.purpose,
        outcome: r.outcome, feedback: r.feedback,
        lead_name: r.leads?.name ?? '—', lead_phone: r.leads?.phone ?? '',
        campus_name: r.campuses?.name ?? '—',
      });
      if (r.outcome) setOutcome(r.outcome);
      if (r.feedback) setFeedback(r.feedback);
    }
    setLoading(false);
  }, [id]);

  useEffect(() => { fetchVisit(); }, [fetchVisit]);

  const checkIn = async () => {
    if (!visit) return;
    setBusy(true);
    const { error } = await (supabase as any).rpc('visit_check_in', { _visit_id: visit.id });
    setBusy(false);
    if (error) { Alert.alert('Check-in failed', error.message); return; }
    fetchVisit();
  };

  const markNoShow = async () => {
    if (!visit) return;
    setBusy(true);
    const { error } = await (supabase.from('campus_visits') as any)
      .update({ status: 'no_show' }).eq('id', visit.id);
    setBusy(false);
    if (error) { Alert.alert('Update failed', error.message); return; }
    Alert.alert('Marked no-show', 'Follow-up auto-scheduled.');
    router.back();
  };

  const complete = async () => {
    if (!visit) return;
    setBusy(true);
    const followupAt = wantFollowup
      ? (() => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(11, 0, 0, 0); return d.toISOString(); })()
      : null;
    const { error } = await (supabase as any).rpc('visit_complete', {
      _visit_id: visit.id,
      _outcome: outcome,
      _feedback: feedback.trim() || null,
      _followup_at: followupAt,
      _followup_type: 'call',
    });
    setBusy(false);
    if (error) { Alert.alert('Could not complete', error.message); return; }
    Alert.alert('Visit completed', wantFollowup ? 'Follow-up scheduled.' : undefined);
    router.back();
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View>
      </SafeAreaView>
    );
  }
  if (!visit) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}><Text style={styles.metaText}>Visit not found.</Text></View>
      </SafeAreaView>
    );
  }

  const isDone = visit.status === 'completed';

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.headCard}>
          <View style={styles.headRow}>
            <Text style={styles.leadName}>{visit.lead_name}</Text>
            {visit.visit_type === 'walk_in' && (
              <View style={styles.walkTag}>
                <Footprints size={10} color="#7c3aed" />
                <Text style={styles.walkTagText}>Walk-in</Text>
              </View>
            )}
          </View>
          <View style={styles.metaRow}><Calendar size={13} color={colors.textMuted} /><Text style={styles.metaText}>{fmtTime(visit.visit_date)}</Text></View>
          <View style={styles.metaRow}><MapPin size={13} color={colors.textMuted} /><Text style={styles.metaText}>{visit.campus_name}</Text></View>
          {!!visit.lead_phone && <View style={styles.metaRow}><Phone size={13} color={colors.textMuted} /><Text style={styles.metaText}>{visit.lead_phone}</Text></View>}
          {!!visit.purpose && <Text style={styles.purpose}>{visit.purpose}</Text>}
          {visit.checked_in_at && <Text style={styles.checkedIn}>Checked in {fmtTime(visit.checked_in_at)}</Text>}
        </View>

        {!isDone && (
          <>
            {!visit.checked_in_at && (
              <TouchableOpacity style={[styles.btn, styles.btnOutline]} onPress={checkIn} disabled={busy}>
                <UserCheck size={18} color={colors.primary} />
                <Text style={[styles.btnText, { color: colors.primary }]}>Check in</Text>
              </TouchableOpacity>
            )}

            <Text style={styles.sectionTitle}>Complete visit</Text>
            <View style={styles.outcomeGrid}>
              {OUTCOMES.map((o) => (
                <TouchableOpacity
                  key={o.value}
                  style={[styles.outcomeChip, outcome === o.value && styles.outcomeChipActive]}
                  onPress={() => setOutcome(o.value)}
                >
                  <Text style={[styles.outcomeChipText, outcome === o.value && styles.outcomeChipTextActive]}>{o.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <TextInput
              style={styles.feedbackInput}
              placeholder="Feedback (optional)"
              placeholderTextColor={colors.textMuted}
              value={feedback}
              onChangeText={setFeedback}
              multiline
            />

            <TouchableOpacity style={styles.followupToggle} onPress={() => setWantFollowup((v) => !v)}>
              <View style={[styles.checkbox, wantFollowup && styles.checkboxOn]}>
                {wantFollowup && <CheckCircle2 size={14} color="#fff" />}
              </View>
              <Clock size={14} color={colors.textSecondary} />
              <Text style={styles.followupText}>Schedule a follow-up (tomorrow 11 AM)</Text>
            </TouchableOpacity>

            <TouchableOpacity style={[styles.btn, styles.btnPrimary]} onPress={complete} disabled={busy}>
              {busy ? <ActivityIndicator color="#fff" /> : <CheckCircle2 size={18} color="#fff" />}
              <Text style={[styles.btnText, { color: '#fff' }]}>Complete Visit</Text>
            </TouchableOpacity>

            <TouchableOpacity style={[styles.btn, styles.btnGhost]} onPress={markNoShow} disabled={busy}>
              <XCircle size={18} color="#b91c1c" />
              <Text style={[styles.btnText, { color: '#b91c1c' }]}>Mark No-show</Text>
            </TouchableOpacity>
          </>
        )}

        {isDone && (
          <View style={styles.doneCard}>
            <CheckCircle2 size={22} color={colors.success} />
            <Text style={styles.doneText}>Visit completed{visit.outcome ? ` — ${visit.outcome}` : ''}</Text>
            {!!visit.feedback && <Text style={styles.metaText}>{visit.feedback}</Text>}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  scroll: { padding: 16, paddingBottom: 100 },

  headCard: {
    backgroundColor: colors.card, borderRadius: 16, padding: 16,
    borderWidth: 1, borderColor: colors.cardBorder, marginBottom: 16, gap: 4,
  },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  leadName: { fontSize: 18, fontWeight: '700', color: colors.text },
  walkTag: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: '#f5f3ff', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2,
  },
  walkTagText: { fontSize: 10, fontWeight: '700', color: '#7c3aed' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  metaText: { fontSize: 13, color: colors.textSecondary },
  purpose: { fontSize: 13, color: colors.textSecondary, fontStyle: 'italic', marginTop: 4 },
  checkedIn: { fontSize: 12, fontWeight: '600', color: colors.success, marginTop: 4 },

  sectionTitle: { fontSize: 15, fontWeight: '700', color: colors.text, marginTop: 8, marginBottom: 10 },

  outcomeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  outcomeChip: {
    borderRadius: 20, paddingHorizontal: 12, paddingVertical: 8,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card,
  },
  outcomeChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  outcomeChipText: { fontSize: 12, fontWeight: '600', color: colors.textSecondary },
  outcomeChipTextActive: { color: '#fff' },

  feedbackInput: {
    backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border,
    padding: 12, minHeight: 80, textAlignVertical: 'top', color: colors.text, fontSize: 14, marginBottom: 12,
  },

  followupToggle: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 },
  checkbox: {
    width: 22, height: 22, borderRadius: 6, borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  followupText: { fontSize: 13, color: colors.textSecondary },

  btn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderRadius: 12, height: 50, marginBottom: 10,
  },
  btnPrimary: { backgroundColor: colors.primary },
  btnOutline: { borderWidth: 1, borderColor: colors.primary, backgroundColor: colors.card },
  btnGhost: { backgroundColor: '#fef2f2' },
  btnText: { fontSize: 15, fontWeight: '700' },

  doneCard: {
    backgroundColor: colors.card, borderRadius: 16, padding: 20,
    alignItems: 'center', gap: 8, borderWidth: 1, borderColor: colors.cardBorder,
  },
  doneText: { fontSize: 15, fontWeight: '700', color: colors.text, textTransform: 'capitalize' as any },
});
