import { Stack } from 'expo-router';
import { useTheme } from '../../../theme/ThemeContext';

export default function WorkStackLayout() {
  const { colors } = useTheme();
  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerShadowVisible: false,
        headerStyle: { backgroundColor: colors.canvas },
        headerTintColor: colors.ink,
        headerTitleStyle: { fontWeight: '700' },
        headerBackButtonDisplayMode: 'minimal',
        contentStyle: { backgroundColor: colors.canvas },
      }}
    >
      <Stack.Screen name="punch" options={{ title: 'Attendance Punch' }} />
      <Stack.Screen name="leave" options={{ title: 'Leave' }} />
      <Stack.Screen name="hr" options={{ title: 'HR' }} />
      <Stack.Screen name="team" options={{ title: 'Team' }} />
      <Stack.Screen name="student-photos" options={{ title: 'Students' }} />
      <Stack.Screen name="classes" options={{ title: 'Classes' }} />
    </Stack>
  );
}
