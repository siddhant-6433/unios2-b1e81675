import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  Check,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldAlert,
  UserRound,
} from 'lucide-react-native';
import { supabase } from '../../../lib/supabase';
import { useAuth } from '../../../contexts/AuthContext';
import { colors, radius, spacing } from '../../../constants/Colors';

type StudentRow = {
  id: string;
  name: string;
  admission_no: string | null;
  pre_admission_no: string | null;
  status: string | null;
  campus_id: string | null;
  photo_url: string | null;
  joining_class: string | null;
  section: string | null;
  batch_id: string | null;
  course_id: string | null;
  course_name: string;
  batch_name: string;
  campus_name: string;
};

const PHOTO_STAFF_ROLES = new Set(['office_admin', 'office_assistant']);
const PHOTO_ADMIN_ROLES = new Set(['super_admin']);
const ROMAN_GRADE_VALUES: Record<string, number> = {
  i: 1,
  ii: 2,
  iii: 3,
  iv: 4,
  v: 5,
  vi: 6,
  vii: 7,
  viii: 8,
  ix: 9,
  x: 10,
  xi: 11,
  xii: 12,
};

function firstRelationName(value: any): string {
  if (Array.isArray(value)) return value[0]?.name || '-';
  return value?.name || '-';
}

function displayAdmissionNo(student: StudentRow): string {
  return student.admission_no || student.pre_admission_no || 'No admission no';
}

function normalizeGradeOption(raw: string | null | undefined): { value: string; label: string } | null {
  if (!raw) return null;
  const text = raw.trim();
  if (!text || text === '-') return null;
  const lower = text.toLowerCase();

  if (lower === 'nursery') return { value: 'nursery', label: 'Nursery' };
  if (lower === 'lkg') return { value: 'lkg', label: 'LKG' };
  if (lower === 'ukg') return { value: 'ukg', label: 'UKG' };

  const numeric = lower.match(/(?:grade|class)\s*[-:]?\s*(\d{1,2})/);
  if (numeric) return { value: `grade-${Number(numeric[1])}`, label: `Grade ${Number(numeric[1])}` };

  const roman = lower.match(/(?:grade|class)\s*[-:]?\s*([ivx]{1,5})\b/);
  if (roman && ROMAN_GRADE_VALUES[roman[1]]) {
    const grade = ROMAN_GRADE_VALUES[roman[1]];
    return { value: `grade-${grade}`, label: `Grade ${grade}` };
  }

  return null;
}

function getStudentGrade(student: StudentRow): { value: string; label: string } {
  return (
    normalizeGradeOption(student.course_name) ||
    normalizeGradeOption(student.joining_class) || {
      value: 'unassigned',
      label: 'Unassigned',
    }
  );
}

function displaySection(section: string | null): string | null {
  if (!section) return null;
  if (normalizeGradeOption(section)) return null;
  return section;
}

function getProgrammeBatchKey(student: StudentRow): string {
  return `${student.course_id || student.course_name}::${student.batch_id || student.batch_name}`;
}

function getProgrammeBatchLabel(student: StudentRow): string {
  const batch = student.batch_name && student.batch_name !== '-' ? student.batch_name : 'No batch';
  return `${student.course_name} / ${batch}`;
}

export default function StudentPhotosScreen() {
  const { role, profile } = useAuth();
  const cameraRef = useRef<CameraView | null>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [gradeFilter, setGradeFilter] = useState('all');
  const [programmeBatchFilter, setProgrammeBatchFilter] = useState('all');
  const [gradeDropdownOpen, setGradeDropdownOpen] = useState(false);
  const [programmeBatchDropdownOpen, setProgrammeBatchDropdownOpen] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);

  const hasPhotoAdminAccess = PHOTO_ADMIN_ROLES.has(role || '');
  const hasPhotoStaffAccess = PHOTO_STAFF_ROLES.has(role || '');
  const branchMissing = hasPhotoStaffAccess && !hasPhotoAdminAccess && !profile?.campus_id;

  const filteredStudents = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = students.filter((student) => {
      const gradeKey = getStudentGrade(student).value;
      const programmeBatchKey = getProgrammeBatchKey(student);

      if (gradeFilter !== 'all' && gradeKey !== gradeFilter) return false;
      if (programmeBatchFilter !== 'all' && programmeBatchKey !== programmeBatchFilter) return false;
      if (!q) return true;

      return (
        student.name.toLowerCase().includes(q) ||
        displayAdmissionNo(student).toLowerCase().includes(q) ||
        student.course_name.toLowerCase().includes(q) ||
        student.batch_name.toLowerCase().includes(q) ||
        (student.joining_class || '').toLowerCase().includes(q) ||
        (student.section || '').toLowerCase().includes(q)
      );
    });

    return [...rows].sort((a, b) => {
      if (Boolean(a.photo_url) !== Boolean(b.photo_url)) return a.photo_url ? 1 : -1;
      return a.name.localeCompare(b.name);
    });
  }, [students, search, gradeFilter, programmeBatchFilter]);

  const gradeOptions = useMemo(() => {
    const map = new Map<string, string>();
    students.forEach((student) => {
      const grade = getStudentGrade(student);
      map.set(grade.value, grade.label);
    });
    return Array.from(map.entries()).sort((a, b) => {
      const aNum = Number(a[0].replace('grade-', ''));
      const bNum = Number(b[0].replace('grade-', ''));
      if (Number.isFinite(aNum) && Number.isFinite(bNum)) return aNum - bNum;
      return a[1].localeCompare(b[1], undefined, { numeric: true });
    });
  }, [students]);

  const programmeBatchOptions = useMemo(() => {
    const map = new Map<string, string>();
    students.forEach((student) => map.set(getProgrammeBatchKey(student), getProgrammeBatchLabel(student)));
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1], undefined, { numeric: true }));
  }, [students]);

  const currentStudent = filteredStudents[currentIndex] || null;
  const completedCount = students.filter((student) => student.photo_url).length;

  useEffect(() => {
    fetchStudents();
  }, [role, profile?.campus_id]);

  useEffect(() => {
    if (currentIndex >= filteredStudents.length) {
      setCurrentIndex(Math.max(filteredStudents.length - 1, 0));
    }
    setCapturedImage(null);
  }, [filteredStudents.length, currentIndex]);

  async function fetchStudents() {
    if ((!hasPhotoAdminAccess && !hasPhotoStaffAccess) || branchMissing) {
      setStudents([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    let query = supabase
      .from('students')
      .select('id, name, admission_no, pre_admission_no, status, campus_id, photo_url, joining_class, section, course_id, batch_id, courses:course_id(name), batches:batch_id(name), campuses:campus_id(name)')
      .in('status', ['active', 'pre_admitted'])
      .order('name', { ascending: true })
      .limit(500);

    if (!hasPhotoAdminAccess && profile?.campus_id) query = query.eq('campus_id', profile.campus_id);

    const { data, error } = await query;
    if (error) {
      Alert.alert('Unable to load students', error.message);
      setStudents([]);
    } else {
      setStudents((data || []).map((student: any) => ({
        id: student.id,
        name: student.name || 'Unnamed student',
        admission_no: student.admission_no || null,
        pre_admission_no: student.pre_admission_no || null,
        status: student.status || null,
        campus_id: student.campus_id || null,
        photo_url: student.photo_url || null,
        joining_class: student.joining_class || null,
        section: student.section || null,
        course_id: student.course_id || null,
        batch_id: student.batch_id || null,
        course_name: firstRelationName(student.courses),
        batch_name: firstRelationName(student.batches),
        campus_name: firstRelationName(student.campuses),
      })));
    }
    setCurrentIndex(0);
    setCapturedImage(null);
    setLoading(false);
  }

  async function refreshStudents() {
    setRefreshing(true);
    await fetchStudents();
    setRefreshing(false);
  }

  async function capturePhoto() {
    if (!permission?.granted) {
      const result = await requestPermission();
      if (!result.granted) {
        Alert.alert('Camera permission required', 'Allow camera access to capture student photos.');
        return;
      }
    }

    const photo = await cameraRef.current?.takePictureAsync({
      quality: 0.9,
      base64: true,
      exif: false,
    });
    if (!photo?.base64) {
      Alert.alert('Capture failed', 'The camera did not return image data. Please try again.');
      return;
    }
    setCapturedImage(`data:image/jpeg;base64,${photo.base64}`);
  }

  async function savePhoto() {
    if (!currentStudent || !capturedImage) return;
    setSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke('student-profile-photo-upload', {
        body: { student_id: currentStudent.id, image: capturedImage },
      });
      if (error || data?.error) throw new Error(data?.error || error?.message || 'Photo upload failed');

      const nextStudents = students.map((student) =>
        student.id === currentStudent.id ? { ...student, photo_url: data.photo_url as string } : student
      );
      setStudents(nextStudents);
      setCapturedImage(null);
      setCurrentIndex(Math.min(currentIndex, Math.max(filteredStudents.length - 1, 0)));
    } catch (err: any) {
      Alert.alert('Photo not saved', err?.message || 'AI processing or upload failed.');
    } finally {
      setSaving(false);
    }
  }

  function move(delta: number) {
    setCapturedImage(null);
    setCurrentIndex((index) => Math.min(Math.max(index + delta, 0), Math.max(filteredStudents.length - 1, 0)));
  }

  if ((!hasPhotoAdminAccess && !hasPhotoStaffAccess) || branchMissing) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centerState}>
          <ShieldAlert size={34} color={colors.destructive} />
          <Text style={styles.centerTitle}>Branch access required</Text>
          <Text style={styles.centerText}>
            This photo capture queue is available to super admins, office admins, and office assistants assigned to a branch.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centerState}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.centerText}>Loading students...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Student Photos</Text>
            <Text style={styles.subtitle}>{completedCount} of {students.length} completed</Text>
          </View>
          <TouchableOpacity style={styles.iconButton} onPress={refreshStudents} disabled={refreshing}>
            {refreshing ? <ActivityIndicator color={colors.primary} /> : <RefreshCw size={20} color={colors.primary} />}
          </TouchableOpacity>
        </View>

        <View style={styles.searchBox}>
          <Search size={17} color={colors.textMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search student or admission no"
            placeholderTextColor={colors.textMuted}
            value={search}
            onChangeText={(value) => {
              setSearch(value);
              setCurrentIndex(0);
              setCapturedImage(null);
            }}
          />
        </View>

        <View style={styles.filterPanel}>
          <DropdownFilter
            label="Grade"
            value={gradeFilter}
            open={gradeDropdownOpen}
            setOpen={setGradeDropdownOpen}
            allLabel="All grades"
            options={gradeOptions.map(([value, label]) => ({ value, label }))}
            onChange={(value) => {
              setGradeFilter(value);
              setCurrentIndex(0);
              setCapturedImage(null);
            }}
          />
          <DropdownFilter
            label="Programme / Batch"
            value={programmeBatchFilter}
            open={programmeBatchDropdownOpen}
            setOpen={setProgrammeBatchDropdownOpen}
            allLabel="All programme batches"
            options={programmeBatchOptions.map(([value, label]) => ({ value, label }))}
            onChange={(value) => {
              setProgrammeBatchFilter(value);
              setCurrentIndex(0);
              setCapturedImage(null);
            }}
          />
        </View>

        {!currentStudent ? (
          <View style={styles.emptyCard}>
            <UserRound size={28} color={colors.textMuted} />
            <Text style={styles.emptyTitle}>No students found</Text>
            <Text style={styles.centerText}>Try a different search or refresh the branch list.</Text>
          </View>
        ) : (
          <>
            <View style={styles.studentCard}>
              <View style={styles.studentAvatar}>
                {currentStudent.photo_url ? (
                  <Image source={{ uri: currentStudent.photo_url }} style={styles.avatarImage} />
                ) : (
                  <Text style={styles.avatarInitials}>
                    {currentStudent.name.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase()}
                  </Text>
                )}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.studentName} numberOfLines={2}>{currentStudent.name}</Text>
                <Text style={styles.studentMeta} numberOfLines={1}>{displayAdmissionNo(currentStudent)}</Text>
                <Text style={styles.studentMeta} numberOfLines={1}>{currentStudent.course_name} - {currentStudent.batch_name}</Text>
                <Text style={styles.studentMeta} numberOfLines={1}>
                  {getStudentGrade(currentStudent).label}{displaySection(currentStudent.section) ? ` / ${displaySection(currentStudent.section)}` : ''} - {currentStudent.campus_name}
                </Text>
              </View>
              <View style={[styles.statusPill, currentStudent.photo_url ? styles.donePill : styles.pendingPill]}>
                {currentStudent.photo_url ? <Check size={13} color={colors.success} /> : <Camera size={13} color={colors.warning} />}
                <Text style={[styles.statusText, currentStudent.photo_url ? styles.doneText : styles.pendingText]}>
                  {currentStudent.photo_url ? 'Done' : 'Pending'}
                </Text>
              </View>
            </View>

            <View style={styles.cameraPanel}>
              {capturedImage ? (
                <Image source={{ uri: capturedImage }} style={styles.previewImage} resizeMode="cover" />
              ) : permission?.granted ? (
                <CameraView ref={cameraRef} style={styles.camera} facing="front" />
              ) : (
                <View style={styles.permissionPanel}>
                  <Camera size={30} color={colors.primary} />
                  <Text style={styles.permissionTitle}>Camera permission needed</Text>
                  <TouchableOpacity style={styles.primaryButton} onPress={requestPermission}>
                    <Text style={styles.primaryButtonText}>Allow Camera</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>

            <View style={styles.captureActions}>
              <TouchableOpacity style={styles.secondaryButton} onPress={() => move(-1)} disabled={currentIndex === 0 || saving}>
                <ArrowLeft size={18} color={currentIndex === 0 ? colors.textMuted : colors.text} />
                <Text style={[styles.secondaryButtonText, currentIndex === 0 && styles.disabledText]}>Prev</Text>
              </TouchableOpacity>

              {capturedImage ? (
                <>
                  <TouchableOpacity style={styles.secondaryButton} onPress={() => setCapturedImage(null)} disabled={saving}>
                    <RotateCcw size={18} color={colors.text} />
                    <Text style={styles.secondaryButtonText}>Retake</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.primaryButton} onPress={savePhoto} disabled={saving}>
                    {saving ? <ActivityIndicator color="#fff" /> : <Check size={18} color="#fff" />}
                    <Text style={styles.primaryButtonText}>{saving ? 'AI Editing...' : 'Save & Next'}</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <TouchableOpacity style={styles.primaryButton} onPress={capturePhoto} disabled={saving}>
                  <Camera size={18} color="#fff" />
                  <Text style={styles.primaryButtonText}>Capture</Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity
                style={styles.secondaryButton}
                onPress={() => move(1)}
                disabled={currentIndex >= filteredStudents.length - 1 || saving}
              >
                <Text style={[styles.secondaryButtonText, currentIndex >= filteredStudents.length - 1 && styles.disabledText]}>Next</Text>
                <ArrowRight size={18} color={currentIndex >= filteredStudents.length - 1 ? colors.textMuted : colors.text} />
              </TouchableOpacity>
            </View>

            <Text style={styles.queueText}>
              {filteredStudents.length === 0 ? '0 / 0' : `${currentIndex + 1} / ${filteredStudents.length}`} in current queue
            </Text>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function DropdownFilter({
  label,
  value,
  open,
  setOpen,
  allLabel,
  options,
  onChange,
}: {
  label: string;
  value: string;
  open: boolean;
  setOpen: (open: boolean) => void;
  allLabel: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  const selected = value === 'all' ? allLabel : options.find((option) => option.value === value)?.label || allLabel;
  const allOptions = [{ value: 'all', label: allLabel }, ...options];

  return (
    <View style={styles.filterRow}>
      <Text style={styles.filterLabel}>{label}</Text>
      <TouchableOpacity style={styles.dropdownButton} onPress={() => setOpen(true)}>
        <Text style={styles.dropdownButtonText} numberOfLines={1}>{selected}</Text>
        <Text style={styles.dropdownChevron}>v</Text>
      </TouchableOpacity>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={() => setOpen(false)}>
          <View style={styles.dropdownMenu}>
            <Text style={styles.dropdownTitle}>{label}</Text>
            <ScrollView style={styles.dropdownScroll}>
              {allOptions.map((option) => (
                <TouchableOpacity
                  key={option.value}
                  style={[styles.dropdownItem, value === option.value && styles.dropdownItemActive]}
                  onPress={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                >
                  <Text style={[styles.dropdownItemText, value === option.value && styles.dropdownItemTextActive]}>
                    {option.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scroll: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  title: {
    color: colors.text,
    fontSize: 24,
    fontWeight: '700',
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: 13,
    marginTop: 2,
  },
  iconButton: {
    width: 42,
    height: 42,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchBox: {
    minHeight: 46,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  searchInput: {
    flex: 1,
    color: colors.text,
    fontSize: 14,
    paddingVertical: spacing.sm,
  },
  filterPanel: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  filterRow: {
    gap: spacing.xs,
  },
  filterLabel: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: '700',
    paddingHorizontal: spacing.md,
    textTransform: 'uppercase',
  },
  dropdownButton: {
    minHeight: 42,
    marginHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  dropdownButtonText: {
    flex: 1,
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
  },
  dropdownChevron: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(17, 24, 39, 0.36)',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  dropdownMenu: {
    maxHeight: 420,
    borderRadius: radius.lg,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  dropdownTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  dropdownScroll: {
    maxHeight: 360,
  },
  dropdownItem: {
    minHeight: 44,
    paddingHorizontal: spacing.md,
    justifyContent: 'center',
    borderBottomWidth: 1,
    borderBottomColor: colors.cardBorder,
  },
  dropdownItemActive: {
    backgroundColor: colors.primaryLight,
  },
  dropdownItemText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  dropdownItemTextActive: {
    color: colors.primary,
    fontWeight: '800',
  },
  studentCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  studentAvatar: {
    width: 56,
    height: 56,
    borderRadius: radius.md,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImage: {
    width: 56,
    height: 56,
  },
  avatarInitials: {
    color: colors.primary,
    fontWeight: '700',
    fontSize: 16,
  },
  studentName: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
  },
  studentMeta: {
    color: colors.textSecondary,
    fontSize: 12,
    marginTop: 2,
  },
  statusPill: {
    minHeight: 28,
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  donePill: {
    backgroundColor: colors.successLight,
  },
  pendingPill: {
    backgroundColor: colors.warningLight,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '700',
  },
  doneText: {
    color: colors.success,
  },
  pendingText: {
    color: colors.warning,
  },
  cameraPanel: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    aspectRatio: 3 / 4,
  },
  camera: {
    flex: 1,
  },
  previewImage: {
    width: '100%',
    height: '100%',
  },
  permissionPanel: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.md,
  },
  permissionTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
  },
  captureActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  primaryButton: {
    minHeight: 44,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    flexGrow: 1,
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  secondaryButton: {
    minHeight: 44,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  secondaryButtonText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '700',
  },
  disabledText: {
    color: colors.textMuted,
  },
  queueText: {
    textAlign: 'center',
    color: colors.textSecondary,
    fontSize: 12,
  },
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.md,
  },
  centerTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
  },
  centerText: {
    color: colors.textSecondary,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 20,
  },
  emptyCard: {
    minHeight: 220,
    borderRadius: radius.lg,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.sm,
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
  },
});
