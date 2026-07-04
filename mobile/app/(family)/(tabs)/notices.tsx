import { useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Bell, Pin } from 'lucide-react-native';
import { useTheme } from '../../../theme/ThemeContext';
import { useMarkNoticeRead, useNotices } from '../../../api/family';
import { Card, Chip, EmptyState, PressableScale, SkeletonCard } from '../../../components/ui';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function NoticesScreen() {
  const { colors, spacing, type } = useTheme();
  const notices = useNotices();
  const markRead = useMarkNoticeRead();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const toggle = (id: string, isRead: boolean) => {
    setExpandedId((current) => (current === id ? null : id));
    if (!isRead) markRead.mutate(id);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }} edges={['top']}>
      <ScrollView
        contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing.xxl, gap: spacing.sm }}
        refreshControl={<RefreshControl refreshing={notices.isRefetching} onRefresh={() => notices.refetch()} />}
      >
        <Text style={[type.h1, { color: colors.ink, marginBottom: spacing.xs }]}>Notices</Text>

        {notices.isLoading ? (
          <>
            <SkeletonCard height={88} />
            <SkeletonCard height={88} />
            <SkeletonCard height={88} />
          </>
        ) : (notices.data ?? []).length === 0 ? (
          <EmptyState
            icon={Bell}
            title="No notices"
            message="Announcements from the university will show up here."
            tint="yellow"
          />
        ) : (
          (notices.data ?? []).map((notice) => {
            const isExpanded = expandedId === notice.id;
            return (
              <PressableScale key={notice.id} onPress={() => toggle(notice.id, notice.isRead)}>
                <Card>
                  <View style={styles.titleRow}>
                    {notice.pinned && <Pin size={14} color={colors.tint.orange.fg} />}
                    <Text
                      style={[
                        type.h3,
                        { color: colors.ink, flex: 1, fontWeight: notice.isRead ? '600' : '700' },
                      ]}
                      numberOfLines={isExpanded ? undefined : 2}
                    >
                      {notice.title}
                    </Text>
                    {!notice.isRead && <View style={[styles.unreadDot, { backgroundColor: colors.accent }]} />}
                  </View>
                  <Text
                    style={[type.body, { color: colors.inkSecondary, marginTop: 6 }]}
                    numberOfLines={isExpanded ? undefined : 2}
                  >
                    {notice.body}
                  </Text>
                  <View style={[styles.metaRow, { marginTop: spacing.sm }]}>
                    <Chip label={notice.category} tint="blue" size="sm" />
                    <Text style={[type.caption, { color: colors.inkMuted }]}>{formatDate(notice.validFrom)}</Text>
                  </View>
                </Card>
              </PressableScale>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  unreadDot: { width: 8, height: 8, borderRadius: 4 },
});
