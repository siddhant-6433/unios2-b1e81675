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
      <Stack.Screen name="attendance-logs" options={{ title: 'Attendance' }} />
      <Stack.Screen name="payslips" options={{ title: 'Payslips' }} />
      <Stack.Screen name="expenses" options={{ title: 'Expenses' }} />
      <Stack.Screen name="documents" options={{ title: 'Documents' }} />
      <Stack.Screen name="comp-off" options={{ title: 'Comp-Off' }} />
      <Stack.Screen name="encashment" options={{ title: 'Leave Encashment' }} />
      <Stack.Screen name="team" options={{ title: 'Team' }} />
      <Stack.Screen name="student-photos" options={{ title: 'Photo Day' }} />
      <Stack.Screen name="classes" options={{ title: 'Classes' }} />
      <Stack.Screen name="visits" options={{ title: 'Visits' }} />
      <Stack.Screen name="visit/[id]" options={{ title: 'Visit' }} />
      <Stack.Screen name="walk-in" options={{ title: 'Walk-in' }} />
    </Stack>
  );
}
