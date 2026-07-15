/**
 * Chats tab — WhatsApp-mimic list shell (structure first).
 * Data wiring (conversations, send, templates) comes in a follow-up PR.
 */
import { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MessageCircle, Search } from 'lucide-react-native';
import { router } from 'expo-router';
import { useTheme } from '../../../theme/ThemeContext';
import { spacing, radius } from '../../../theme/tokens';

type ChatFilter = 'all' | 'unreplied' | 'unassigned';

export type ChatListItem = {
  id: string;
  name: string;
  phone: string;
  preview: string;
  timeLabel: string;
  unread: number;
};

/** Demo rows so the shell feels real during design QA. Removed when live data lands. */
const DEMO_CHATS: ChatListItem[] = [
  {
    id: '1',
    name: 'Mamta Devi',
    phone: '919418941955',
    preview: 'Admission confirm kab hoga',
    timeLabel: '12:53 am',
    unread: 2,
  },
  {
    id: '2',
    name: 'Amaan',
    phone: '917819000725',
    preview: 'Yes Connect me',
    timeLabel: 'Yesterday',
    unread: 0,
  },
  {
    id: '3',
    name: 'Campus walk-in',
    phone: '919000000001',
    preview: 'You: Visit confirmed for 15 Jul',
    timeLabel: 'Mon',
    unread: 0,
  },
];

export default function ChatsScreen() {
  const { colors } = useTheme();
  const [filter, setFilter] = useState<ChatFilter>('all');
  const [query, setQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  // Structure-first: demo list. Replace with live WA conversations next.
  const [rows] = useState<ChatListItem[]>(DEMO_CHATS);

  const filtered = useMemo(() => {
    let list = rows;
    if (filter === 'unreplied') list = list.filter((r) => r.unread > 0);
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter(
        (r) => r.name.toLowerCase().includes(q) || r.phone.includes(q) || r.preview.toLowerCase().includes(q),
      );
    }
    return list;
  }, [rows, filter, query]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 600);
  }, []);

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.canvas }]} edges={['top']}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.ink }]}>Chats</Text>
        <Text style={[styles.sub, { color: colors.inkSecondary }]}>
          WhatsApp · Super Admin view
        </Text>
      </View>

      <View style={[styles.searchWrap, { backgroundColor: colors.card, borderColor: colors.line }]}>
        <Search size={18} color={colors.inkMuted} />
        <TextInput
          style={[styles.searchInput, { color: colors.ink }]}
          placeholder="Search name or number"
          placeholderTextColor={colors.inkMuted}
          value={query}
          onChangeText={setQuery}
        />
      </View>

      <View style={styles.chips}>
        {(
          [
            ['all', 'All'],
            ['unreplied', 'Unreplied'],
            ['unassigned', 'Unassigned'],
          ] as const
        ).map(([key, label]) => {
          const active = filter === key;
          return (
            <TouchableOpacity
              key={key}
              onPress={() => setFilter(key)}
              style={[
                styles.chip,
                {
                  backgroundColor: active ? colors.pillBg : colors.card,
                  borderColor: colors.line,
                },
              ]}
            >
              <Text style={{ color: active ? colors.pillFg : colors.ink, fontWeight: '600', fontSize: 13 }}>
                {label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={filtered.length === 0 ? styles.emptyContainer : styles.list}
        ListEmptyComponent={
          <View style={styles.empty}>
            <MessageCircle size={40} color={colors.inkMuted} />
            <Text style={[styles.emptyTitle, { color: colors.ink }]}>No chats yet</Text>
            <Text style={[styles.emptySub, { color: colors.inkSecondary }]}>
              Conversations from WhatsApp will show up here.
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            style={[styles.row, { borderBottomColor: colors.line }]}
            activeOpacity={0.7}
            onPress={() =>
              router.push({
                pathname: '/(staff)/chats/[phone]',
                params: { phone: item.phone, name: item.name },
              } as any)
            }
          >
            <View style={[styles.avatar, { backgroundColor: colors.accentSoft }]}>
              <Text style={[styles.avatarText, { color: colors.accent }]}>
                {item.name
                  .split(' ')
                  .map((p) => p[0])
                  .join('')
                  .slice(0, 2)
                  .toUpperCase()}
              </Text>
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <View style={styles.rowTop}>
                <Text style={[styles.name, { color: colors.ink }]} numberOfLines={1}>
                  {item.name}
                </Text>
                <Text style={[styles.time, { color: colors.inkMuted }]}>{item.timeLabel}</Text>
              </View>
              <Text
                style={[styles.preview, { color: item.unread ? colors.ink : colors.inkSecondary }]}
                numberOfLines={1}
              >
                {item.preview}
              </Text>
            </View>
            {item.unread > 0 && (
              <View style={[styles.badge, { backgroundColor: colors.success }]}>
                <Text style={styles.badgeText}>{item.unread}</Text>
              </View>
            )}
          </TouchableOpacity>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.sm },
  title: { fontSize: 28, fontWeight: '700', letterSpacing: -0.5 },
  sub: { fontSize: 13, marginTop: 2 },
  searchWrap: {
    marginHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md,
    height: 44,
  },
  searchInput: { flex: 1, fontSize: 15, paddingVertical: 0 },
  chips: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
  },
  list: { paddingBottom: spacing.xxl },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: 14, fontWeight: '700' },
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  name: { fontSize: 16, fontWeight: '600', flex: 1 },
  time: { fontSize: 12 },
  preview: { fontSize: 14, marginTop: 2 },
  badge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  emptyContainer: { flexGrow: 1, justifyContent: 'center' },
  empty: { alignItems: 'center', padding: spacing.xxl, gap: spacing.sm },
  emptyTitle: { fontSize: 17, fontWeight: '700', marginTop: spacing.sm },
  emptySub: { fontSize: 14, textAlign: 'center', lineHeight: 20 },
});
