import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, SafeAreaView,
  TouchableOpacity, TextInput, ActivityIndicator, RefreshControl, Modal, Alert, Image,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useAuth } from '../../../contexts/AuthContext';
import { supabase } from '../../../lib/supabase';
import { colors, radius } from '../../../constants/Colors';
import {
  Briefcase, Plus, X, Receipt, History,
  Camera, Upload, FileText, Paperclip,
} from 'lucide-react-native';

const money = (n: any) =>
  `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

const fmtDate = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

const today = () => new Date().toISOString().slice(0, 10);

const STATUS_META: Record<string, { bg: string; fg: string; label: string }> = {
  draft: { bg: '#f4f4f5', fg: '#52525b', label: 'Draft' },
  submitted: { bg: '#fefce8', fg: '#ca8a04', label: 'Submitted' },
  pending_superadmin: { bg: '#fff7ed', fg: '#c2410c', label: 'Pending final approval' },
  changes_requested: { bg: '#fff7ed', fg: '#b45309', label: 'Changes requested' },
  approved: { bg: '#ecfdf5', fg: '#16a34a', label: 'Approved' },
  synced_to_zoho: { bg: '#eff6ff', fg: '#1d4ed8', label: 'Synced to Zoho' },
  reimbursed: { bg: '#eff6ff', fg: '#1d4ed8', label: 'Reimbursed' },
  rejected: { bg: '#fef2f2', fg: '#dc2626', label: 'Rejected' },
  cancelled: { bg: '#f4f4f5', fg: '#71717a', label: 'Cancelled' },
};

type Attachment = {
  id?: string;
  file_url: string;
  file_path?: string | null;
  file_name?: string | null;
  mime_type?: string | null;
  file_size?: number | null;
};

type Category = { id: string; name: string; code?: string; requires_receipt?: boolean };

/** Upload an expense proof (image) to S3 via the shared `s3-upload` edge function. */
async function uploadProof(
  userId: string,
  uri: string,
  fileName: string,
  mimeType: string,
): Promise<Attachment | null> {
  try {
    const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
    const session = (await supabase.auth.getSession()).data.session;
    const token = session?.access_token || supabaseKey;

    const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const key = `${userId}/expense-proofs/${Date.now()}-${safeName}`;

    // Step 1: presigned URL from our edge function
    const presignRes = await fetch(`${supabaseUrl}/functions/v1/s3-upload`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ key, bucket: 'unios-selfies', content_type: mimeType }),
    });
    if (!presignRes.ok) {
      console.error('[Expenses] Presign error:', presignRes.status);
      return null;
    }
    const { presigned_url, url: publicUrl } = await presignRes.json();
    if (!presigned_url || !publicUrl) return null;

    // Step 2: upload the bytes straight to S3
    const fileRes = await fetch(uri);
    const blob = await fileRes.blob();
    const uploadRes = await fetch(presigned_url, {
      method: 'PUT',
      headers: { 'Content-Type': mimeType },
      body: blob,
    });
    if (!uploadRes.ok) {
      console.error('[Expenses] S3 PUT error:', uploadRes.status);
      return null;
    }

    return { file_url: publicUrl, file_path: key, file_name: fileName, mime_type: mimeType };
  } catch (err) {
    console.error('[Expenses] Upload exception:', err);
    return null;
  }
}

export default function ExpensesScreen() {
  const { user } = useAuth();
  const [profileId, setProfileId] = useState<string | null>(null);
  const [claims, setClaims] = useState<any[]>([]);
  const [attachments, setAttachments] = useState<Record<string, Attachment[]>>({});
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [showModal, setShowModal] = useState(false);
  const [editingClaim, setEditingClaim] = useState<any | null>(null);

  const fetchClaims = useCallback(async (pid: string) => {
    const [claimsRes, catRes] = await Promise.all([
      (supabase as any)
        .from('expense_claims')
        .select('id, title, amount, expense_date, description, status, category_id, receipt_url, correction_note, rejection_reason, zoho_bill_number, zoho_sync_error, created_at')
        .eq('employee_profile_id', pid)
        .order('created_at', { ascending: false }),
      (supabase as any)
        .from('expense_categories')
        .select('id, name, code, requires_receipt, is_active')
        .eq('is_active', true)
        .order('display_order', { ascending: true }),
    ]);

    if (claimsRes.error) Alert.alert('Could not load claims', claimsRes.error.message);
    const list: any[] = claimsRes.data ?? [];
    setClaims(list);
    setCategories(catRes.data ?? []);

    if (list.length) {
      const { data: atts } = await (supabase as any)
        .from('expense_claim_attachments')
        .select('id, claim_id, file_url, file_path, file_name, mime_type, file_size')
        .in('claim_id', list.map((c) => c.id))
        .order('uploaded_at', { ascending: true });
      const map: Record<string, Attachment[]> = {};
      for (const a of (atts ?? []) as any[]) {
        if (!map[a.claim_id]) map[a.claim_id] = [];
        map[a.claim_id].push(a);
      }
      setAttachments(map);
    } else {
      setAttachments({});
    }

    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    (async () => {
      if (!user?.id) { setLoading(false); return; }
      const { data } = await supabase
        .from('employee_profiles')
        .select('id')
        .eq('user_id', user.id)
        .maybeSingle();
      const pid = (data as any)?.id ?? null;
      setProfileId(pid);
      if (pid) await fetchClaims(pid);
      else setLoading(false);
    })();
  }, [user?.id, fetchClaims]);

  const onRefresh = () => { if (profileId) { setRefreshing(true); fetchClaims(profileId); } };

  const closeModal = () => {
    setShowModal(false);
    setEditingClaim(null);
    if (profileId) fetchClaims(profileId);
  };

  const openNew = () => { setEditingClaim(null); setShowModal(true); };
  const openExisting = (claim: any) => { setEditingClaim(claim); setShowModal(true); };

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
        <TouchableOpacity style={styles.newBtn} onPress={openNew} activeOpacity={0.8}>
          <Plus size={18} color="#fff" />
          <Text style={styles.newBtnText}>New claim</Text>
        </TouchableOpacity>

        {!profileId ? (
          <View style={styles.emptyCard}>
            <Briefcase size={32} color={colors.textMuted} />
            <Text style={styles.emptyText}>No employee record</Text>
            <Text style={styles.emptyHint}>Contact HR to link your staff profile</Text>
          </View>
        ) : claims.length === 0 ? (
          <View style={styles.emptyCard}>
            <Receipt size={32} color={colors.textMuted} />
            <Text style={styles.emptyText}>No expense claims yet</Text>
            <Text style={styles.emptyHint}>Tap “New claim” to submit one</Text>
          </View>
        ) : (
          <View style={{ gap: 10 }}>
            {claims.map((c: any) => {
              const meta = STATUS_META[c.status] ?? STATUS_META.submitted;
              const proofs = attachments[c.id]?.length ?? 0;
              const canEdit = c.status === 'draft' || c.status === 'changes_requested';
              return (
                <View key={c.id} style={styles.card}>
                  <View style={styles.cardIcon}>
                    <History size={18} color={colors.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={styles.cardHead}>
                      <Text style={styles.cardTitle}>{c.title}</Text>
                      <View style={[styles.statusTag, { backgroundColor: meta.bg }]}>
                        <Text style={[styles.statusTagText, { color: meta.fg }]}>{meta.label}</Text>
                      </View>
                    </View>
                    <Text style={styles.cardSub}>{fmtDate(c.expense_date)} · {money(c.amount)}</Text>
                    {!!c.description && <Text style={styles.cardDesc}>{c.description}</Text>}

                    {proofs > 0 ? (
                      <View style={styles.proofOkRow}>
                        <Paperclip size={11} color={colors.success} />
                        <Text style={styles.proofOk}>{proofs} proof{proofs > 1 ? 's' : ''} attached</Text>
                      </View>
                    ) : canEdit ? (
                      <Text style={styles.proofWarn}>Proof required — attach a receipt or invoice</Text>
                    ) : null}

                    {c.status === 'changes_requested' && !!c.correction_note && (
                      <View style={styles.noteBox}>
                        <Text style={styles.noteLabel}>Correction requested</Text>
                        <Text style={styles.noteText}>{c.correction_note}</Text>
                      </View>
                    )}

                    {c.status === 'rejected' && !!c.rejection_reason && (
                      <View style={[styles.noteBox, styles.noteBoxDanger]}>
                        <Text style={[styles.noteLabel, { color: colors.destructive }]}>Rejected</Text>
                        <Text style={styles.noteText}>{c.rejection_reason}</Text>
                      </View>
                    )}

                    {(c.status === 'synced_to_zoho' || c.status === 'reimbursed') && !!c.zoho_bill_number && (
                      <Text style={styles.zohoText}>Zoho bill: {c.zoho_bill_number}</Text>
                    )}

                    {!!c.zoho_sync_error && (
                      <Text style={styles.syncError}>Sync issue: {c.zoho_sync_error}</Text>
                    )}

                    {canEdit && (
                      <TouchableOpacity style={styles.actionBtn} onPress={() => openExisting(c)} activeOpacity={0.8}>
                        <Paperclip size={14} color="#fff" />
                        <Text style={styles.actionBtnText}>
                          {c.status === 'draft' ? 'Add proof & submit' : 'Resubmit'}
                        </Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>

      <ClaimModal
        visible={showModal}
        claim={editingClaim}
        categories={categories}
        profileId={profileId}
        userId={user?.id || ''}
        onClose={closeModal}
        onSaved={closeModal}
      />
    </SafeAreaView>
  );
}

function ClaimModal({
  visible, claim, categories, profileId, userId, onClose, onSaved,
}: {
  visible: boolean;
  claim: any | null;
  categories: Category[];
  profileId: string | null;
  userId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [step, setStep] = useState<'details' | 'proof'>('details');
  const [claimId, setClaimId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [expenseDate, setExpenseDate] = useState(today());
  const [description, setDescription] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [receiptUrl, setReceiptUrl] = useState<string | null>(null);
  const [proofs, setProofs] = useState<Attachment[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [picking, setPicking] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const loadAttachments = useCallback(async (id: string) => {
    const { data } = await (supabase as any)
      .from('expense_claim_attachments')
      .select('id, file_url, file_path, file_name, mime_type, file_size')
      .eq('claim_id', id)
      .order('uploaded_at', { ascending: true });
    setProofs(data ?? []);
  }, []);

  useEffect(() => {
    if (!visible) return;
    setErrorMsg(null);
    setSaving(false);
    setPicking(false);
    setSubmitting(false);
    if (claim) {
      setStep('proof');
      setClaimId(claim.id);
      setTitle(claim.title || '');
      setAmount(claim.amount != null ? String(claim.amount) : '');
      setExpenseDate(claim.expense_date || today());
      setDescription(claim.description || '');
      setCategoryId(claim.category_id || null);
      setReceiptUrl(claim.receipt_url || null);
      setProofs([]);
      loadAttachments(claim.id);
    } else {
      setStep('details');
      setClaimId(null);
      setTitle('');
      setAmount('');
      setExpenseDate(today());
      setDescription('');
      setCategoryId(null);
      setReceiptUrl(null);
      setProofs([]);
    }
  }, [visible, claim, loadAttachments]);

  // Default to the first active category for a brand-new claim.
  useEffect(() => {
    if (visible && step === 'details' && !categoryId && categories.length) {
      setCategoryId(categories[0].id);
    }
  }, [visible, step, categoryId, categories]);

  const createDraft = async () => {
    if (!profileId) { Alert.alert('Error', 'No employee record found'); return; }
    if (!title.trim()) { Alert.alert('Error', 'Enter a title'); return; }
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { Alert.alert('Error', 'Enter a valid amount'); return; }
    if (!expenseDate) { Alert.alert('Error', 'Enter expense date (YYYY-MM-DD)'); return; }

    setSaving(true);
    setErrorMsg(null);
    try {
      const { data, error } = await (supabase as any)
        .from('expense_claims')
        .insert({
          employee_profile_id: profileId,
          submitted_by: userId,
          category_id: categoryId,
          title: title.trim(),
          amount: amt,
          currency: 'INR',
          expense_date: expenseDate,
          description: description.trim() || null,
          status: 'draft',
        })
        .select('id')
        .single();
      if (error) throw error;
      setClaimId(data.id);
      setStep('proof');
      setProofs([]);
      setReceiptUrl(null);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Could not save the draft.');
    } finally {
      setSaving(false);
    }
  };

  const pickProof = async (fromCamera: boolean) => {
    if (!claimId) return;
    try {
      if (fromCamera) {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) {
          Alert.alert('Camera permission needed', 'Allow camera access to photograph your receipt.');
          return;
        }
      }
      const opts: ImagePicker.ImagePickerOptions = { quality: 0.7, mediaTypes: ['images'] };
      const result = fromCamera
        ? await ImagePicker.launchCameraAsync(opts)
        : await ImagePicker.launchImageLibraryAsync(opts);
      if (result.canceled) return;
      const asset = result.assets?.[0];
      if (!asset?.uri) return;

      setPicking(true);
      setErrorMsg(null);
      const fileName = asset.fileName || `proof-${Date.now()}.jpg`;
      const mimeType = asset.mimeType || 'image/jpeg';
      const uploaded = await uploadProof(userId, asset.uri, fileName, mimeType);
      if (!uploaded) {
        setErrorMsg('Upload failed. Check your connection and try again.');
        return;
      }
      const { error } = await (supabase as any).from('expense_claim_attachments').insert({
        claim_id: claimId,
        file_url: uploaded.file_url,
        file_path: uploaded.file_path,
        file_name: uploaded.file_name,
        mime_type: uploaded.mime_type,
        file_size: asset.fileSize ?? null,
        uploaded_by: userId,
      });
      if (error) { setErrorMsg(error.message); return; }
      await loadAttachments(claimId);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Could not attach proof.');
    } finally {
      setPicking(false);
    }
  };

  const hasProof = proofs.length > 0 || !!receiptUrl;

  const submitClaim = async () => {
    if (!claimId) return;
    if (!hasProof) {
      Alert.alert('Proof required', 'Attach at least one receipt or invoice before submitting.');
      return;
    }
    setSubmitting(true);
    setErrorMsg(null);
    try {
      // Keep the legacy receipt_url in sync with the first proof for backward compatibility.
      if (!receiptUrl && proofs[0]?.file_url) {
        await (supabase as any)
          .from('expense_claims')
          .update({ receipt_url: proofs[0].file_url })
          .eq('id', claimId);
      }
      const { error } = await (supabase as any).rpc('submit_expense_claim', { _claim_id: claimId });
      if (error) throw error;
      Alert.alert('Submitted', 'Your claim was sent to your reporting manager for approval.');
      onSaved();
    } catch (err: any) {
      const msg = err?.message || 'Could not submit the claim.';
      setErrorMsg(msg);
      Alert.alert('Could not submit', msg);
    } finally {
      setSubmitting(false);
    }
  };

  const heading = claim
    ? (claim.status === 'changes_requested' ? 'Resubmit claim' : 'Add proof & submit')
    : (step === 'details' ? 'New Expense Claim' : 'Attach proof');

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>{heading}</Text>
            <TouchableOpacity onPress={onClose}><X size={24} color={colors.textSecondary} /></TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={{ gap: 16, paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
            {step === 'details' ? (
              <>
                <View>
                  <Text style={styles.label}>Category</Text>
                  <View style={styles.chipWrap}>
                    {categories.map((cat) => {
                      const active = cat.id === categoryId;
                      return (
                        <TouchableOpacity
                          key={cat.id}
                          style={[styles.chip, active && styles.chipActive]}
                          onPress={() => setCategoryId(cat.id)}
                          activeOpacity={0.8}
                        >
                          <Text style={[styles.chipText, active && styles.chipTextActive]}>{cat.name}</Text>
                        </TouchableOpacity>
                      );
                    })}
                    {categories.length === 0 && (
                      <Text style={styles.emptyHint}>No categories configured</Text>
                    )}
                  </View>
                </View>

                <View>
                  <Text style={styles.label}>Title</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="e.g. Client lunch"
                    placeholderTextColor={colors.textMuted}
                    value={title}
                    onChangeText={setTitle}
                  />
                </View>
                <View>
                  <Text style={styles.label}>Amount (₹)</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="0"
                    placeholderTextColor={colors.textMuted}
                    keyboardType="numeric"
                    value={amount}
                    onChangeText={setAmount}
                  />
                </View>
                <View>
                  <Text style={styles.label}>Expense Date</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor={colors.textMuted}
                    value={expenseDate}
                    onChangeText={setExpenseDate}
                  />
                </View>
                <View>
                  <Text style={styles.label}>Description</Text>
                  <TextInput
                    style={[styles.input, { height: 80, textAlignVertical: 'top' }]}
                    placeholder="Optional"
                    placeholderTextColor={colors.textMuted}
                    value={description}
                    onChangeText={setDescription}
                    multiline
                  />
                </View>

                <View style={styles.mandatoryBox}>
                  <Paperclip size={14} color={colors.warning} />
                  <Text style={styles.mandatoryText}>
                    Proof required · you'll attach a receipt or invoice on the next step.
                  </Text>
                </View>

                {!!errorMsg && <Text style={styles.errorText}>{errorMsg}</Text>}

                <TouchableOpacity
                  style={[styles.submitBtn, saving && { opacity: 0.5 }]}
                  onPress={createDraft}
                  disabled={saving}
                >
                  {saving
                    ? <ActivityIndicator color="#fff" size="small" />
                    : <Text style={styles.submitText}>Save draft & attach proof</Text>}
                </TouchableOpacity>
              </>
            ) : (
              <>
                <View>
                  <Text style={styles.label}>
                    Proof <Text style={styles.requiredStar}>* required</Text>
                  </Text>
                  <Text style={styles.proofHint}>
                    Attach a clear photo of the receipt or invoice. Approval can't proceed without it —
                    it's shared with your reporting manager and the super admin, and sent to Zoho with the bill.
                  </Text>
                </View>

                {proofs.length === 0 && !receiptUrl ? (
                  <View style={styles.noProofBox}>
                    <Paperclip size={20} color={colors.warning} />
                    <Text style={styles.noProofText}>No proof attached yet</Text>
                  </View>
                ) : (
                  <View style={{ gap: 8 }}>
                    {proofs.map((p, i) => (
                      <View key={p.id || `${p.file_url}-${i}`} style={styles.proofRow}>
                        {p.mime_type?.startsWith('image/') ? (
                          <Image source={{ uri: p.file_url }} style={styles.proofThumb} />
                        ) : (
                          <View style={styles.proofThumbFallback}>
                            <FileText size={18} color={colors.primary} />
                          </View>
                        )}
                        <Text style={styles.proofName} numberOfLines={1}>
                          {p.file_name || `Proof ${i + 1}`}
                        </Text>
                      </View>
                    ))}
                    {proofs.length === 0 && !!receiptUrl && (
                      <View style={styles.proofRow}>
                        <View style={styles.proofThumbFallback}>
                          <FileText size={18} color={colors.primary} />
                        </View>
                        <Text style={styles.proofName} numberOfLines={1}>Receipt on file</Text>
                      </View>
                    )}
                  </View>
                )}

                <View style={styles.attachRow}>
                  <TouchableOpacity
                    style={[styles.attachBtn, picking && { opacity: 0.5 }]}
                    onPress={() => pickProof(true)}
                    disabled={picking}
                    activeOpacity={0.8}
                  >
                    <Camera size={16} color={colors.primary} />
                    <Text style={styles.attachBtnText}>Take photo</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.attachBtn, picking && { opacity: 0.5 }]}
                    onPress={() => pickProof(false)}
                    disabled={picking}
                    activeOpacity={0.8}
                  >
                    <Upload size={16} color={colors.primary} />
                    <Text style={styles.attachBtnText}>Choose file</Text>
                  </TouchableOpacity>
                </View>

                {picking && (
                  <View style={styles.uploadingRow}>
                    <ActivityIndicator size="small" color={colors.primary} />
                    <Text style={styles.emptyHint}>Uploading proof…</Text>
                  </View>
                )}

                {!!errorMsg && <Text style={styles.errorText}>{errorMsg}</Text>}

                <TouchableOpacity
                  style={[styles.submitBtn, (submitting || !hasProof) && { opacity: 0.5 }]}
                  onPress={submitClaim}
                  disabled={submitting || !hasProof}
                >
                  {submitting
                    ? <ActivityIndicator color="#fff" size="small" />
                    : <Text style={styles.submitText}>Submit for approval</Text>}
                </TouchableOpacity>
                {!hasProof && (
                  <Text style={styles.proofWarnCenter}>Attach at least one proof to submit.</Text>
                )}
              </>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  scroll: { padding: 16, paddingBottom: 100 },

  newBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: colors.primary, borderRadius: radius.md, height: 48, marginBottom: 16,
  },
  newBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },

  emptyCard: {
    backgroundColor: colors.card, borderRadius: radius.lg, padding: 32,
    alignItems: 'center', gap: 10, borderWidth: 1, borderColor: colors.cardBorder,
  },
  emptyText: { fontSize: 14, fontWeight: '600', color: colors.textSecondary },
  emptyHint: { fontSize: 12, color: colors.textMuted },

  card: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    backgroundColor: colors.card, borderRadius: radius.lg, padding: 14,
    borderWidth: 1, borderColor: colors.cardBorder,
  },
  cardIcon: {
    width: 36, height: 36, borderRadius: radius.full,
    backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center',
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  cardTitle: { fontSize: 15, fontWeight: '700', color: colors.text },
  cardSub: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  cardDesc: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  statusTag: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  statusTagText: { fontSize: 10, fontWeight: '700' },

  proofOkRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  proofOk: { fontSize: 11, color: colors.success, fontWeight: '600' },
  proofWarn: { fontSize: 11, color: colors.warning, marginTop: 4, fontWeight: '600' },
  proofWarnCenter: { fontSize: 11, color: colors.warning, textAlign: 'center' },

  noteBox: {
    marginTop: 8, borderRadius: radius.md, padding: 10,
    backgroundColor: '#fff7ed', borderWidth: 1, borderColor: '#fed7aa',
  },
  noteBoxDanger: { backgroundColor: '#fef2f2', borderColor: '#fecaca' },
  noteLabel: { fontSize: 11, fontWeight: '700', color: '#b45309', marginBottom: 2 },
  noteText: { fontSize: 12, color: colors.textSecondary, lineHeight: 16 },
  zohoText: { fontSize: 11, color: colors.primary, marginTop: 4, fontWeight: '600' },
  syncError: { fontSize: 11, color: colors.destructive, marginTop: 4 },

  actionBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: colors.primary, borderRadius: radius.md,
    paddingVertical: 9, marginTop: 10, alignSelf: 'flex-start', paddingHorizontal: 14,
  },
  actionBtnText: { color: '#fff', fontSize: 12, fontWeight: '700' },

  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    backgroundColor: colors.card, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
    paddingHorizontal: 24, paddingTop: 20, maxHeight: '88%',
  },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  sheetTitle: { fontSize: 18, fontWeight: '700', color: colors.text },
  label: { fontSize: 14, fontWeight: '600', color: colors.text, marginBottom: 8 },
  requiredStar: { color: colors.destructive, fontWeight: '700' },
  input: {
    backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, paddingHorizontal: 16, paddingVertical: 12,
    fontSize: 15, color: colors.text,
  },

  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.full,
    paddingHorizontal: 12, paddingVertical: 7, backgroundColor: colors.background,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 12, color: colors.textSecondary, fontWeight: '600' },
  chipTextActive: { color: '#fff' },

  mandatoryBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#fff7ed', borderRadius: radius.md, padding: 12,
    borderWidth: 1, borderColor: '#fed7aa',
  },
  mandatoryText: { flex: 1, fontSize: 12, color: '#b45309', lineHeight: 16 },

  proofHint: { fontSize: 12, color: colors.textSecondary, lineHeight: 17 },
  noProofBox: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderWidth: 1, borderColor: colors.border, borderStyle: 'dashed',
    borderRadius: radius.md, padding: 16, justifyContent: 'center',
  },
  noProofText: { fontSize: 13, color: colors.textMuted, fontWeight: '600' },
  proofRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderWidth: 1, borderColor: colors.cardBorder, borderRadius: radius.md, padding: 8,
    backgroundColor: colors.background,
  },
  proofThumb: { width: 40, height: 40, borderRadius: radius.sm },
  proofThumbFallback: {
    width: 40, height: 40, borderRadius: radius.sm, backgroundColor: colors.primaryLight,
    alignItems: 'center', justifyContent: 'center',
  },
  proofName: { flex: 1, fontSize: 12, color: colors.text, fontWeight: '500' },

  attachRow: { flexDirection: 'row', gap: 10 },
  attachBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderWidth: 1, borderColor: colors.primary, borderRadius: radius.md,
    paddingVertical: 12, backgroundColor: colors.primaryLight,
  },
  attachBtnText: { fontSize: 13, fontWeight: '700', color: colors.primary },
  uploadingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },

  errorText: { fontSize: 12, color: colors.destructive, lineHeight: 16 },

  submitBtn: {
    backgroundColor: colors.primary, borderRadius: radius.md,
    height: 52, alignItems: 'center', justifyContent: 'center',
  },
  submitText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
