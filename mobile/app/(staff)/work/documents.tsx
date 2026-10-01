import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, SafeAreaView,
  TouchableOpacity, ActivityIndicator, RefreshControl, Linking, Alert,
} from 'react-native';
import { useAuth } from '../../../contexts/AuthContext';
import { supabase } from '../../../lib/supabase';
import { colors, radius } from '../../../constants/Colors';
import {
  FileText, Download, ExternalLink, CalendarDays,
} from 'lucide-react-native';

const fmtDate = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

const STATUS_TONE: Record<string, { bg: string; fg: string }> = {
  pending: { bg: '#fefce8', fg: '#ca8a04' },
  verified: { bg: '#ecfdf5', fg: '#16a34a' },
  rejected: { bg: '#fef2f2', fg: '#dc2626' },
};

export default function DocumentsScreen() {
  const { user } = useAuth();
  const [profileId, setProfileId] = useState<string | null>(null);
  const [documents, setDocuments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchDocuments = useCallback(async (pid: string) => {
    const { data, error } = await (supabase as any)
      .from('employee_documents')
      .select('id, file_name, doc_category, status, issued_on, expires_on, file_url, uploaded_at')
      .eq('employee_id', pid)
      .order('uploaded_at', { ascending: false });
    if (error) Alert.alert('Could not load documents', error.message);
    setDocuments(data ?? []);
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
      if (pid) await fetchDocuments(pid);
      else setLoading(false);
    })();
  }, [user?.id, fetchDocuments]);

  const onRefresh = () => { if (profileId) { setRefreshing(true); fetchDocuments(profileId); } };

  const openDocument = async (doc: any) => {
    if (!doc.file_url) { Alert.alert('Unavailable', 'This document has no file URL.'); return; }
    try {
      const supported = await Linking.canOpenURL(doc.file_url);
      if (!supported) { Alert.alert('Cannot open', 'No app can open this file.'); return; }
      await Linking.openURL(doc.file_url);
    } catch (err: any) {
      Alert.alert('Cannot open', err?.message || 'Failed to open document.');
    }
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
        {documents.length === 0 ? (
          <View style={styles.emptyCard}>
            <FileText size={32} color={colors.textMuted} />
            <Text style={styles.emptyText}>No documents yet</Text>
            <Text style={styles.emptyHint}>Documents uploaded by HR will appear here</Text>
          </View>
        ) : (
          <View style={{ gap: 10 }}>
            {documents.map((doc: any) => {
              const tone = STATUS_TONE[doc.status] ?? STATUS_TONE.pending;
              return (
                <TouchableOpacity key={doc.id} style={styles.card} onPress={() => openDocument(doc)} activeOpacity={0.8}>
                  <View style={styles.cardIcon}>
                    <FileText size={20} color={colors.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={styles.cardHead}>
                      <Text style={styles.cardTitle}>{doc.file_name || 'Document'}</Text>
                      <View style={[styles.statusTag, { backgroundColor: tone.bg }]}>
                        <Text style={[styles.statusTagText, { color: tone.fg }]}>{doc.status}</Text>
                      </View>
                    </View>
                    {!!doc.doc_category && <Text style={styles.cardCat}>{doc.doc_category}</Text>}
                    <View style={styles.metaRow}>
                      <CalendarDays size={12} color={colors.textMuted} />
                      <Text style={styles.metaText}>Issued {fmtDate(doc.issued_on)}</Text>
                      <Text style={styles.metaText}>Expires {fmtDate(doc.expires_on)}</Text>
                    </View>
                  </View>
                  {doc.file_url ? (
                    <ExternalLink size={18} color={colors.textMuted} />
                  ) : (
                    <Download size={18} color={colors.textMuted} />
                  )}
                </TouchableOpacity>
              );
            })}
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
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  cardTitle: { flexShrink: 1, fontSize: 14, fontWeight: '700', color: colors.text },
  cardCat: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  statusTag: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  statusTagText: { fontSize: 10, fontWeight: '700', textTransform: 'capitalize' as any },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4, flexWrap: 'wrap' },
  metaText: { fontSize: 11, color: colors.textMuted, marginRight: 6 },
});
