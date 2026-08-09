/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { Barcode, BookOpen, CheckCircle2, RefreshCw, RotateCcw, Search } from 'lucide-react-native';
import { colors, radius, spacing, typography } from '../../constants/Colors';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';

type CatalogItem = {
  id: string;
  branch_id: string;
  accession_no: string;
  barcode: string | null;
  status: string;
  shelf_location: string | null;
  library_books?: {
    title: string;
    authors: string[] | null;
    isbn_13: string | null;
  } | null;
};

type Loan = {
  id: string;
  due_on: string;
  status: string;
  library_items?: {
    accession_no: string;
    library_books?: { title: string; authors: string[] | null } | null;
  } | null;
};

type LibraryBranch = {
  id: string;
  name: string;
  code: string | null;
};

type ScanAction = 'digitize' | 'add_isbn' | 'issue' | 'return' | 'audit';

type QueuedRecord = {
  id: string; title: string | null; accession_no: string | null; isbn: string | null;
  authors_text: string | null; publisher: string | null; category: string | null;
  subject: string | null; language: string | null; published_year: number | null;
  cover_image_url: string | null; suggested_metadata: any;
};

function authorLabel(authors?: string[] | null) {
  return authors?.length ? authors.join(', ') : 'Unknown author';
}

function normalizeIsbn(value: string) {
  return value.replace(/[^0-9Xx]/g, '');
}

export default function LibraryScreen() {
  const { role, user } = useAuth();
  const [permission, requestPermission] = useCameraPermissions();
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [branches, setBranches] = useState<LibraryBranch[]>([]);
  const [selectedBranchId, setSelectedBranchId] = useState('');
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [scanMode, setScanMode] = useState(false);
  const [scanAction, setScanAction] = useState<ScanAction>('digitize');
  const [scannedValue, setScannedValue] = useState('');
  const [issueAdmissionNo, setIssueAdmissionNo] = useState('');
  const [auditStatus, setAuditStatus] = useState('available');
  const [capturing, setCapturing] = useState(false);
  const [addIsbnRecord, setAddIsbnRecord] = useState<QueuedRecord | null>(null);

  const canOperate = role === 'librarian' || role === 'super_admin';

  const fetchLibrary = useCallback(async () => {
    setLoading(true);
    const [itemRes, memberRes, branchRes] = await Promise.all([
      (supabase as any)
        .from('library_items')
        .select('id, branch_id, accession_no, barcode, status, shelf_location, library_books(title, authors, isbn_13)')
        .limit(100)
        .order('created_at', { ascending: false }),
      user?.id
        ? (supabase as any).from('library_members').select('id').eq('user_id', user.id).maybeSingle()
        : Promise.resolve({ data: null }),
      role === 'super_admin'
        ? (supabase as any)
            .from('library_branches')
            .select('id, name, code')
            .eq('active', true)
            .order('name')
        : canOperate
        ? (supabase as any)
            .from('library_staff_assignments')
            .select('branch_id, library_branches(id, name, code)')
            .eq('active', true)
        : Promise.resolve({ data: [] }),
    ]);

    if (itemRes.data) setItems(itemRes.data);
    const assignedBranches = role === 'super_admin'
      ? (branchRes.data || [])
      : (branchRes.data || []).map((row: any) => row.library_branches).filter(Boolean);
    setBranches(assignedBranches);
    setSelectedBranchId((current) => current || assignedBranches[0]?.id || '');

    const memberId = memberRes.data?.id;
    if (memberId) {
      const loanRes = await (supabase as any)
        .from('library_loans')
        .select('id, due_on, status, library_items(accession_no, library_books(title, authors))')
        .eq('member_id', memberId)
        .in('status', ['active', 'overdue'])
        .order('due_on', { ascending: true });
      if (loanRes.data) setLoans(loanRes.data);
    } else {
      setLoans([]);
    }
    setLoading(false);
  }, [canOperate, role, user?.id]);

  useEffect(() => {
    fetchLibrary();
  }, [fetchLibrary]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) => [
      item.accession_no,
      item.barcode,
      item.status,
      item.shelf_location,
      item.library_books?.title,
      item.library_books?.isbn_13,
      authorLabel(item.library_books?.authors),
    ].some((value) => String(value || '').toLowerCase().includes(q)));
  }, [items, query]);

  const startScan = async () => {
    if (!permission?.granted) {
      const result = await requestPermission();
      if (!result.granted) {
        Alert.alert('Camera permission required', 'Allow camera access to scan ISBN or accession barcodes.');
        return;
      }
    }
    setScannedValue('');
    setScanMode(true);
  };

  const captureDigitizationRecord = async (value: string) => {
    if (!canOperate || !value.trim()) return;
    setCapturing(true);
    try {
      if (!selectedBranchId) throw new Error('Select or assign a library before capturing records.');
      const isbn = normalizeIsbn(value);
      let suggested = {};
      let confidence = 0.2;
      if (isbn) {
        const { data } = await supabase.functions.invoke('library-book-lookup', { body: { isbn } });
        if (data?.book) {
          suggested = data.book;
          confidence = data.confidence || 0.75;
        }
      }

      const { data: inserted, error } = await (supabase as any).from('library_digitization_records').insert({
        branch_id: selectedBranchId,
        source: 'barcode',
        scanned_barcode: value,
        isbn: isbn || null,
        suggested_metadata: suggested,
        confidence,
        status: Object.keys(suggested).length ? 'matched' : 'needs_review',
      }).select('id').single();
      if (error) throw error;
      setScannedValue('');
      fetchLibrary();
      // Offer to attach a cover photo right after capture.
      Alert.alert(
        'Captured',
        (Object.keys(suggested).length ? 'Book metadata matched for review.' : 'Record queued for manual review.') + '\n\nAdd a cover photo?',
        [
          { text: 'Take photo', onPress: () => attachCover(inserted.id, true) },
          { text: 'Choose from gallery', onPress: () => attachCover(inserted.id, false) },
          { text: 'Skip', style: 'cancel' },
        ],
      );
    } catch (err: any) {
      Alert.alert('Capture failed', err.message || 'Could not save digitization record.');
    } finally {
      setCapturing(false);
    }
  };

  // Two-step: scan a queued book's accession to select it, then scan its ISBN to attach + look up.
  const addIsbnFlow = async (value: string) => {
    if (!canOperate || !value.trim()) return;
    setCapturing(true);
    try {
      if (!selectedBranchId) throw new Error('Select or assign a library first.');
      if (!addIsbnRecord) {
        // Step 1 — find the queued record by scanned accession number.
        const { data, error } = await (supabase as any)
          .from('library_digitization_records')
          .select('id, title, accession_no, isbn, authors_text, publisher, category, subject, language, published_year, cover_image_url, suggested_metadata')
          .eq('branch_id', selectedBranchId)
          .eq('accession_no', value.trim())
          .in('status', ['captured', 'matched', 'needs_review'])
          .limit(1).maybeSingle();
        if (error) throw error;
        if (!data) throw new Error(`No queued book with accession ${value.trim()} in this library.`);
        setAddIsbnRecord(data);
        setScannedValue('');
        Alert.alert('Book selected', `${data.title || 'Untitled'} (acc ${data.accession_no}).\n\nNow scan the ISBN barcode on the book.`);
        return;
      }
      // Step 2 — treat scan as the ISBN, attach it, and enrich by ISBN.
      const isbn = normalizeIsbn(value);
      if (isbn.length !== 10 && isbn.length !== 13) throw new Error('That is not a valid ISBN barcode.');
      const rec = addIsbnRecord;
      const { data: lk } = await supabase.functions.invoke('library-book-lookup', { body: { isbn } });
      const book: any = lk?.book;
      const blank = (v: unknown) => v == null || String(v).trim() === '';
      const upd: Record<string, unknown> = { isbn, enrichment_status: book ? 'enriched' : 'no_match' };
      if (book) {
        upd.suggested_metadata = { ...(rec.suggested_metadata || {}), ...book };
        if (blank(rec.title) && book.title) upd.title = book.title;
        if (blank(rec.authors_text) && Array.isArray(book.authors) && book.authors.length) upd.authors_text = book.authors.join(', ');
        if (blank(rec.publisher) && book.publisher) upd.publisher = book.publisher;
        if (blank(rec.category) && book.category) upd.category = book.category;
        if (blank(rec.subject) && book.subject) upd.subject = book.subject;
        if (blank(rec.language) && book.language) upd.language = book.language;
        if (blank(rec.published_year) && book.published_year) upd.published_year = book.published_year;
      }
      const { error: updErr } = await (supabase as any).from('library_digitization_records').update(upd).eq('id', rec.id);
      if (updErr) throw updErr;
      if (book?.cover_url && blank(rec.cover_image_url)) {
        await supabase.functions.invoke('library-cover-capture', { body: { target: 'record', id: rec.id, source_url: book.cover_url } });
      }
      Alert.alert(book ? 'ISBN added + data fetched' : 'ISBN added', book ? `Matched "${book.title || rec.title}". Metadata + cover updated.` : 'No online match for this ISBN, but it was saved to the record.');
      setAddIsbnRecord(null);
      setScannedValue('');
      fetchLibrary();
    } catch (err: any) {
      Alert.alert('Add ISBN failed', err.message || 'Could not add the ISBN.');
    } finally {
      setCapturing(false);
    }
  };

  const attachCover = async (recordId: string, fromCamera: boolean) => {
    try {
      if (fromCamera) {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) throw new Error('Camera permission denied — choose from gallery instead.');
      }
      const opts: ImagePicker.ImagePickerOptions = { quality: 0.7, base64: true, mediaTypes: ['images'] };
      const result = fromCamera
        ? await ImagePicker.launchCameraAsync(opts)
        : await ImagePicker.launchImageLibraryAsync(opts);
      if (result.canceled) return;
      const asset = result.assets?.[0];
      if (!asset?.base64) throw new Error('Could not read the image.');
      const { data, error } = await supabase.functions.invoke('library-cover-capture', {
        body: { target: 'record', id: recordId, image_base64: `data:image/jpeg;base64,${asset.base64}` },
      });
      if (error || !data?.ok) throw new Error(data?.error || error?.message || 'Upload failed');
      Alert.alert('Cover added', 'The cover photo was attached to this record.');
      fetchLibrary();
    } catch (err: any) {
      Alert.alert('Cover failed', err.message || 'Could not attach the cover.');
    }
  };

  const issueScannedBook = async (value: string) => {
    if (!canOperate || !value.trim()) return;
    setCapturing(true);
    try {
      if (!selectedBranchId) throw new Error('Select or assign a library before issuing books.');
      if (!issueAdmissionNo.trim()) throw new Error('Enter the student admission number before scanning.');
      const { error } = await (supabase as any).rpc('library_issue_by_admission_no', {
        _branch_id: selectedBranchId,
        _accession_or_barcode: value.trim(),
        _admission_no: issueAdmissionNo.trim(),
        _due_on: null,
      });
      if (error) throw error;
      Alert.alert('Issued', `Book ${value} issued to ${issueAdmissionNo}.`);
      setScannedValue('');
      fetchLibrary();
    } catch (err: any) {
      Alert.alert('Issue failed', err.message || 'Could not issue this book.');
    } finally {
      setCapturing(false);
    }
  };

  const returnScannedBook = async (value: string) => {
    if (!canOperate || !value.trim()) return;
    setCapturing(true);
    try {
      if (!selectedBranchId) throw new Error('Select or assign a library before returning books.');
      const { data, error } = await (supabase as any).rpc('library_return_by_accession', {
        _branch_id: selectedBranchId,
        _accession_or_barcode: value.trim(),
      });
      if (error) throw error;
      const fine = Array.isArray(data) ? data[0]?.fine_amount : data?.fine_amount;
      Alert.alert('Returned', fine > 0 ? `Book returned. Fine assessed: ₹${Number(fine).toFixed(2)}.` : 'Book returned with no fine.');
      setScannedValue('');
      fetchLibrary();
    } catch (err: any) {
      Alert.alert('Return failed', err.message || 'Could not return this book.');
    } finally {
      setCapturing(false);
    }
  };

  const auditScannedBook = async (value: string) => {
    if (!canOperate || !value.trim()) return;
    setCapturing(true);
    try {
      if (!selectedBranchId) throw new Error('Select or assign a library before shelf audit.');
      const item = items.find((row) => row.branch_id === selectedBranchId && (row.accession_no === value.trim() || row.barcode === value.trim()));
      if (!item) throw new Error('No catalog copy found for this accession or barcode.');
      const { error } = await (supabase as any)
        .from('library_items')
        .update({ status: auditStatus })
        .eq('id', item.id);
      if (error) throw error;
      Alert.alert('Audit updated', `${value} marked ${auditStatus.replace(/_/g, ' ')}.`);
      setScannedValue('');
      fetchLibrary();
    } catch (err: any) {
      Alert.alert('Audit failed', err.message || 'Could not update this book.');
    } finally {
      setCapturing(false);
    }
  };

  const processScannedValue = (value: string) => {
    if (scanAction === 'issue') return issueScannedBook(value);
    if (scanAction === 'return') return returnScannedBook(value);
    if (scanAction === 'audit') return auditScannedBook(value);
    if (scanAction === 'add_isbn') return addIsbnFlow(value);
    return captureDigitizationRecord(value);
  };

  const onBarcodeScanned = (result: BarcodeScanningResult) => {
    setScannedValue(result.data);
    setScanMode(false);
    processScannedValue(result.data);
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
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>Library</Text>
            <Text style={styles.subtitle}>{canOperate ? 'Scan, digitize, and audit books' : 'Search catalog and current loans'}</Text>
          </View>
          <Pressable style={styles.iconButton} onPress={fetchLibrary}>
            <RefreshCw size={18} color={colors.text} />
          </Pressable>
        </View>

        {canOperate && (
          <View style={styles.actionCard}>
            <View style={styles.actionHeader}>
              <Barcode size={22} color={colors.primary} />
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>Digitize Offline Book</Text>
                <Text style={styles.cardHint}>
                  {branches.find((branch) => branch.id === selectedBranchId)?.name || 'No assigned library'}
                </Text>
              </View>
            </View>
            {branches.length > 1 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.branchRow}>
                {branches.map((branch) => (
                  <Pressable
                    key={branch.id}
                    style={[styles.branchChip, selectedBranchId === branch.id && styles.branchChipActive]}
                    onPress={() => setSelectedBranchId(branch.id)}
                  >
                    <Text style={[styles.branchChipText, selectedBranchId === branch.id && styles.branchChipTextActive]}>
                      {branch.name}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            )}
            <View style={styles.modeGrid}>
              {[
                ['digitize', 'Digitize'],
                ['add_isbn', 'Add ISBN'],
                ['issue', 'Issue'],
                ['return', 'Return'],
                ['audit', 'Audit'],
              ].map(([mode, label]) => (
                <Pressable
                  key={mode}
                  style={[styles.modeButton, scanAction === mode && styles.modeButtonActive]}
                  onPress={() => { setScanAction(mode as ScanAction); setAddIsbnRecord(null); setScannedValue(''); }}
                >
                  <Text style={[styles.modeText, scanAction === mode && styles.modeTextActive]}>{label}</Text>
                </Pressable>
              ))}
            </View>
            {scanAction === 'issue' && (
              <TextInput
                value={issueAdmissionNo}
                onChangeText={setIssueAdmissionNo}
                placeholder="Student admission number"
                placeholderTextColor={colors.textMuted}
                style={styles.input}
              />
            )}
            {scanAction === 'audit' && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.branchRow}>
                {['available', 'damaged', 'lost', 'repair', 'reference_only'].map((status) => (
                  <Pressable
                    key={status}
                    style={[styles.branchChip, auditStatus === status && styles.branchChipActive]}
                    onPress={() => setAuditStatus(status)}
                  >
                    <Text style={[styles.branchChipText, auditStatus === status && styles.branchChipTextActive]}>
                      {status.replace(/_/g, ' ')}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            )}
            {scanAction === 'add_isbn' && (
              <Text style={styles.cardHint}>
                {addIsbnRecord
                  ? `Step 2 · Scan the ISBN barcode for "${addIsbnRecord.title || 'this book'}" (acc ${addIsbnRecord.accession_no}).`
                  : 'Step 1 · Scan the accession barcode of a queued book to select it.'}
              </Text>
            )}
            {scanMode ? (
              <CameraView
                style={styles.camera}
                facing="back"
                barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'code39', 'qr'] }}
                onBarcodeScanned={onBarcodeScanned}
              />
            ) : (
              <View style={styles.captureRow}>
                <TextInput
                  value={scannedValue}
                  onChangeText={setScannedValue}
                  placeholder="Enter barcode manually"
                  placeholderTextColor={colors.textMuted}
                  style={styles.input}
                />
                <Pressable style={styles.primaryButton} onPress={startScan}>
                  <Text style={styles.primaryButtonText}>Scan</Text>
                </Pressable>
              </View>
            )}
            <Pressable
              style={[styles.secondaryButton, (!scannedValue || !selectedBranchId || capturing || (scanAction === 'issue' && !issueAdmissionNo.trim())) && styles.disabled]}
              disabled={!scannedValue || !selectedBranchId || capturing || (scanAction === 'issue' && !issueAdmissionNo.trim())}
              onPress={() => processScannedValue(scannedValue)}
            >
              {capturing ? <ActivityIndicator color={colors.primary} /> : scanAction === 'return' ? <RotateCcw size={16} color={colors.primary} /> : <CheckCircle2 size={16} color={colors.primary} />}
              <Text style={styles.secondaryButtonText}>
                {scanAction === 'digitize' ? 'Save to Review Queue'
                  : scanAction === 'add_isbn' ? (addIsbnRecord ? 'Attach ISBN & look up' : 'Find book by accession')
                  : scanAction === 'issue' ? 'Issue Book' : scanAction === 'return' ? 'Return Book' : 'Update Shelf Audit'}
              </Text>
            </Pressable>
          </View>
        )}

        {loans.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Current Loans</Text>
            {loans.map((loan) => (
              <View key={loan.id} style={styles.rowCard}>
                <BookOpen size={18} color={colors.primary} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>{loan.library_items?.library_books?.title || loan.library_items?.accession_no || 'Library item'}</Text>
                  <Text style={styles.rowMeta}>Due {loan.due_on} · {loan.status}</Text>
                </View>
              </View>
            ))}
          </View>
        )}

        <View style={styles.searchBox}>
          <Search size={16} color={colors.textMuted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search books, authors, ISBN..."
            placeholderTextColor={colors.textMuted}
            style={styles.searchInput}
          />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Catalog</Text>
          {filtered.length === 0 ? (
            <View style={styles.emptyCard}>
              <BookOpen size={30} color={colors.textMuted} />
              <Text style={styles.emptyText}>No books found</Text>
            </View>
          ) : filtered.map((item) => (
            <View key={item.id} style={styles.rowCard}>
              <BookOpen size={18} color={item.status === 'available' ? colors.primary : colors.textMuted} />
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{item.library_books?.title || 'Untitled book'}</Text>
                <Text style={styles.rowMeta}>{authorLabel(item.library_books?.authors)} · {item.accession_no}</Text>
              </View>
              <Text style={[styles.status, item.status === 'available' ? styles.statusOk : styles.statusMuted]}>
                {item.status.replace(/_/g, ' ')}
              </Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: spacing.lg, paddingBottom: 100 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: spacing.sm, marginBottom: spacing.lg },
  title: { ...typography.h1, color: colors.text },
  subtitle: { ...typography.body, color: colors.textSecondary, marginTop: 2 },
  iconButton: {
    height: 40,
    width: 40,
    borderRadius: radius.lg,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  actionCard: {
    backgroundColor: colors.card,
    borderRadius: radius.xl,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    marginBottom: spacing.lg,
    gap: spacing.md,
  },
  actionHeader: { flexDirection: 'row', gap: spacing.md, alignItems: 'center' },
  cardTitle: { ...typography.bodyMedium, color: colors.text },
  cardHint: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  branchRow: { gap: spacing.sm, paddingVertical: spacing.xs },
  branchChip: {
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.background,
  },
  branchChipActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryLight,
  },
  branchChipText: { ...typography.caption, color: colors.textSecondary },
  branchChipTextActive: { color: colors.primary, fontWeight: '700' },
  modeGrid: { flexDirection: 'row', gap: spacing.sm },
  modeButton: {
    flex: 1,
    minHeight: 36,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  modeButtonActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryLight,
  },
  modeText: { ...typography.caption, color: colors.textSecondary, textTransform: 'capitalize' },
  modeTextActive: { color: colors.primary, fontWeight: '700' },
  captureRow: { flexDirection: 'row', gap: spacing.sm },
  input: {
    flex: 1,
    backgroundColor: colors.background,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    color: colors.text,
  },
  camera: { height: 240, borderRadius: radius.lg, overflow: 'hidden' },
  primaryButton: {
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: { color: '#FFFFFF', fontWeight: '700' },
  secondaryButton: {
    minHeight: 42,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  secondaryButtonText: { color: colors.primary, fontWeight: '700' },
  disabled: { opacity: 0.55 },
  section: { marginTop: spacing.lg, gap: spacing.sm },
  sectionTitle: { ...typography.h3, color: colors.text, marginBottom: spacing.xs },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.card,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    paddingHorizontal: spacing.md,
    minHeight: 46,
  },
  searchInput: { flex: 1, color: colors.text },
  rowCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    padding: spacing.md,
  },
  rowTitle: { ...typography.bodyMedium, color: colors.text },
  rowMeta: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  status: { ...typography.caption, textTransform: 'capitalize', maxWidth: 92, textAlign: 'right' },
  statusOk: { color: colors.primary },
  statusMuted: { color: colors.textMuted },
  emptyCard: {
    backgroundColor: colors.card,
    borderRadius: radius.xl,
    padding: spacing.xxl,
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  emptyText: { ...typography.bodyMedium, color: colors.textSecondary },
});
