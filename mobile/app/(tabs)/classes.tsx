import {
  View, Text, StyleSheet, ScrollView, SafeAreaView,
} from 'react-native';
import { colors, spacing, radius, typography } from '../../constants/Colors';
import { BookOpen } from 'lucide-react-native';

export default function ClassesScreen() {
  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Classes</Text>
        <Text style={styles.subtitle}>Today's schedule and attendance</Text>

        <View style={styles.emptyCard}>
          <BookOpen size={32} color={colors.textMuted} />
          <Text style={styles.emptyText}>No classes scheduled today</Text>
          <Text style={styles.emptyHint}>Timetable management coming in Phase 2</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: spacing.lg, paddingBottom: 100 },
  title: { ...typography.h1, color: colors.text, paddingTop: spacing.sm },
  subtitle: { ...typography.body, color: colors.textSecondary, marginTop: 2, marginBottom: spacing.lg },
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
  emptyHint: { ...typography.caption, color: colors.textMuted },
});
