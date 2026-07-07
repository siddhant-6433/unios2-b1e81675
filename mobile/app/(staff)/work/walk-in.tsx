import { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, SafeAreaView,
  TouchableOpacity, TextInput, ActivityIndicator, Alert, Share,
} from 'react-native';
import { router } from 'expo-router';
import { supabase } from '../../../lib/supabase';
import { colors } from '../../../constants/Colors';
import { Footprints, IndianRupee, ArrowRight, Link2 } from 'lucide-react-native';

export default function WalkInScreen() {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [purpose, setPurpose] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ lead_id: string; name: string } | null>(null);

  // Token-link state.
  const [tokenAmount, setTokenAmount] = useState('');
  const [sendingLink, setSendingLink] = useState(false);

  const submit = async () => {
    if (!name.trim()) { Alert.alert('Name required'); return; }
    if (!phone.trim()) { Alert.alert('Phone required'); return; }
    setSubmitting(true);
    const { data, error } = await (supabase as any).rpc('create_walk_in_visit', {
      _name: name.trim(),
      _phone: phone.trim(),
      _email: email.trim() || null,
      _course_id: null,
      _campus_id: null,
      _purpose: purpose.trim() || null,
      _notes: notes.trim() || null,
    });
    setSubmitting(false);
    if (error) { Alert.alert('Could not record walk-in', error.message); return; }
    setResult({ lead_id: (data as any).lead_id, name: name.trim() });
  };

  const sendTokenLink = async () => {
    if (!result) return;
    const amt = parseFloat(tokenAmount);
    if (!amt || amt <= 0) { Alert.alert('Enter a valid amount'); return; }
    setSendingLink(true);
    const { data, error } = await supabase.functions.invoke('create-payment-link', {
      body: {
        purpose: 'pre_admission_token',
        lead_id: result.lead_id,
        amount: amt,
        send_channel: 'whatsapp',
      },
    });
    setSendingLink(false);
    if (error || (data as any)?.error) {
      Alert.alert('Payment link failed', (data as any)?.error || error?.message || 'Please try again.');
      return;
    }
    const url = (data as any).pay_url;
    Alert.alert('Payment link created', 'Sent to the candidate on WhatsApp.', [
      { text: 'Share link', onPress: () => Share.share({ message: url }).catch(() => {}) },
      { text: 'Done' },
    ]);
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {result ? (
          <View style={{ gap: 16 }}>
            <View style={styles.headCard}>
              <Footprints size={28} color={colors.primary} />
              <Text style={styles.doneTitle}>{result.name} checked in</Text>
              <Text style={styles.doneSub}>Collect the token fee now to lock the candidate in.</Text>
            </View>

            <View style={styles.card}>
              <Text style={styles.label}>Token amount (₹)</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. 5000"
                placeholderTextColor={colors.textMuted}
                keyboardType="numeric"
                value={tokenAmount}
                onChangeText={setTokenAmount}
              />
              <TouchableOpacity style={[styles.btn, styles.btnPrimary]} onPress={sendTokenLink} disabled={sendingLink}>
                {sendingLink ? <ActivityIndicator color="#fff" /> : <IndianRupee size={18} color="#fff" />}
                <Text style={[styles.btnText, { color: '#fff' }]}>Send token payment link</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={[styles.btn, styles.btnOutline]}
              onPress={() => router.replace(`/(staff)/work/visits` as any)}
            >
              <ArrowRight size={18} color={colors.primary} />
              <Text style={[styles.btnText, { color: colors.primary }]}>Back to visits</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={{ gap: 12 }}>
            <Text style={styles.title}>Record Walk-in</Text>
            <Text style={styles.subtitle}>Instantly register a candidate who walked in</Text>

            <Field label="Name" value={name} onChange={setName} placeholder="Candidate name" />
            <Field label="Phone" value={phone} onChange={setPhone} placeholder="Mobile number" keyboardType="phone-pad" />
            <Field label="Email (optional)" value={email} onChange={setEmail} placeholder="Email" keyboardType="email-address" />
            <Field label="Purpose (optional)" value={purpose} onChange={setPurpose} placeholder="e.g. Campus tour" />
            <Field label="Notes (optional)" value={notes} onChange={setNotes} placeholder="Anything worth capturing" multiline />

            <TouchableOpacity style={[styles.btn, styles.btnPrimary]} onPress={submit} disabled={submitting}>
              {submitting ? <ActivityIndicator color="#fff" /> : <Link2 size={18} color="#fff" />}
              <Text style={[styles.btnText, { color: '#fff' }]}>Check in</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Field({ label, value, onChange, placeholder, keyboardType, multiline }: {
  label: string; value: string; onChange: (v: string) => void; placeholder: string;
  keyboardType?: any; multiline?: boolean;
}) {
  return (
    <View>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={[styles.input, multiline && { minHeight: 72, textAlignVertical: 'top' }]}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        value={value}
        onChangeText={onChange}
        keyboardType={keyboardType}
        multiline={multiline}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: 16, paddingBottom: 100 },
  title: { fontSize: 24, fontWeight: '700', color: colors.text, paddingTop: 8 },
  subtitle: { fontSize: 14, color: colors.textSecondary, marginTop: 2, marginBottom: 8 },

  label: { fontSize: 12, fontWeight: '600', color: colors.textSecondary, marginBottom: 6 },
  input: {
    backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: 14, height: 48, color: colors.text, fontSize: 15,
  },

  headCard: {
    backgroundColor: colors.card, borderRadius: 16, padding: 20, alignItems: 'center', gap: 8,
    borderWidth: 1, borderColor: colors.cardBorder,
  },
  doneTitle: { fontSize: 18, fontWeight: '700', color: colors.text },
  doneSub: { fontSize: 13, color: colors.textSecondary, textAlign: 'center' },

  card: {
    backgroundColor: colors.card, borderRadius: 16, padding: 16, gap: 10,
    borderWidth: 1, borderColor: colors.cardBorder,
  },

  btn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderRadius: 12, height: 50,
  },
  btnPrimary: { backgroundColor: colors.primary },
  btnOutline: { borderWidth: 1, borderColor: colors.primary, backgroundColor: colors.card },
  btnText: { fontSize: 15, fontWeight: '700' },
});
