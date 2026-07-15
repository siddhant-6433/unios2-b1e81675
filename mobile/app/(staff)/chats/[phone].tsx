/**
 * Chat thread shell — WhatsApp-mimic (structure first).
 */
import { useLocalSearchParams, router } from 'expo-router';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronLeft, Paperclip, Send } from 'lucide-react-native';
import { useState } from 'react';
import { useTheme } from '../../../theme/ThemeContext';
import { spacing, radius } from '../../../theme/tokens';

type Bubble = {
  id: string;
  direction: 'in' | 'out';
  text: string;
  time: string;
};

const DEMO_THREAD: Bubble[] = [
  { id: '1', direction: 'in', text: 'Hello, I want to know about B.Tech admission.', time: '12:40 am' },
  { id: '2', direction: 'out', text: 'Hi! Happy to help. Which campus are you interested in?', time: '12:42 am' },
  { id: '3', direction: 'in', text: 'Greater Noida. Fee kitni hogi?', time: '12:45 am' },
  { id: '4', direction: 'in', text: 'Admission confirm kab hoga', time: '12:53 am' },
];

export default function ChatThreadScreen() {
  const { phone, name } = useLocalSearchParams<{ phone: string; name?: string }>();
  const { colors } = useTheme();
  const [draft, setDraft] = useState('');
  const [messages] = useState<Bubble[]>(DEMO_THREAD);
  const title = name || phone || 'Chat';

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.canvas }]} edges={['top', 'bottom']}>
      <View style={[styles.header, { borderBottomColor: colors.line, backgroundColor: colors.card }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12} style={styles.back}>
          <ChevronLeft size={24} color={colors.ink} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: colors.ink }]} numberOfLines={1}>
            {title}
          </Text>
          <Text style={[styles.sub, { color: colors.inkMuted }]}>+{phone}</Text>
        </View>
        <TouchableOpacity hitSlop={8}>
          <Text style={{ color: colors.accent, fontWeight: '600', fontSize: 14 }}>Lead</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={messages}
        keyExtractor={(m) => m.id}
        contentContainerStyle={styles.thread}
        renderItem={({ item }) => {
          const mine = item.direction === 'out';
          return (
            <View style={[styles.bubbleRow, mine && styles.bubbleRowMine]}>
              <View
                style={[
                  styles.bubble,
                  mine
                    ? { backgroundColor: colors.accentSoft }
                    : { backgroundColor: colors.card, borderColor: colors.line, borderWidth: StyleSheet.hairlineWidth },
                ]}
              >
                <Text style={[styles.bubbleText, { color: colors.ink }]}>{item.text}</Text>
                <Text style={[styles.bubbleTime, { color: colors.inkMuted }]}>{item.time}</Text>
              </View>
            </View>
          );
        }}
      />

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[styles.composer, { borderTopColor: colors.line, backgroundColor: colors.card }]}>
          <TouchableOpacity style={styles.iconBtn} hitSlop={8}>
            <Paperclip size={22} color={colors.inkMuted} />
          </TouchableOpacity>
          <TextInput
            style={[styles.input, { backgroundColor: colors.cardSubtle, color: colors.ink }]}
            placeholder="Message"
            placeholderTextColor={colors.inkMuted}
            value={draft}
            onChangeText={setDraft}
            multiline
          />
          <TouchableOpacity
            style={[
              styles.send,
              { backgroundColor: draft.trim() ? colors.pillBg : colors.line },
            ]}
            disabled={!draft.trim()}
            activeOpacity={0.85}
          >
            <Send size={18} color={draft.trim() ? colors.pillFg : colors.inkMuted} />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  back: { padding: 4 },
  title: { fontSize: 17, fontWeight: '700' },
  sub: { fontSize: 12, marginTop: 1 },
  thread: { padding: spacing.md, gap: spacing.sm, paddingBottom: spacing.xl },
  bubbleRow: { flexDirection: 'row', marginBottom: spacing.sm },
  bubbleRowMine: { justifyContent: 'flex-end' },
  bubble: {
    maxWidth: '78%',
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  bubbleText: { fontSize: 15, lineHeight: 21 },
  bubbleTime: { fontSize: 11, marginTop: 4, alignSelf: 'flex-end' },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  iconBtn: { padding: 8 },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: Platform.OS === 'ios' ? 10 : 8,
    fontSize: 16,
  },
  send: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
