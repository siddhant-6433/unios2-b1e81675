import { ScrollView, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { BookOpen, CalendarDays, LogOut, User } from 'lucide-react-native';
import { useTheme } from '../../theme/ThemeContext';
import { useAuth } from '../../contexts/AuthContext';
import { Card, ListRow } from '../../components/ui';

export function FamilyMoreScreen() {
  const { colors, spacing, type } = useTheme();
  const { signOut } = useAuth();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: spacing.md, gap: spacing.md }}>
        <Text style={[type.h1, { color: colors.ink }]}>More</Text>

        <Card padded={false}>
          <ListRow
            icon={CalendarDays}
            title="Timetable"
            subtitle="Weekly class schedule"
            showChevron
            onPress={() => router.push('/(family)/timetable' as never)}
          />
          <ListRow
            icon={BookOpen}
            title="Library"
            subtitle="Your loans, holds and fines"
            showChevron
            onPress={() => router.push('/(family)/library' as never)}
          />
          <ListRow
            icon={User}
            title="Profile"
            subtitle="Account, security and app settings"
            showChevron
            onPress={() => router.push('/(family)/profile' as never)}
          />
        </Card>

        <Card padded={false}>
          <ListRow icon={LogOut} title="Sign out" onPress={signOut} />
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}
