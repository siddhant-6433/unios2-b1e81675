import { Redirect, Stack } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../theme/ThemeContext';

const FAMILY_ROLES = ['student', 'parent'];

/** Staff area guard: requires a signed-in non-family role. */
export default function StaffLayout() {
  const { user, role, loading } = useAuth();
  const { colors } = useTheme();

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.canvas }}>
        <ActivityIndicator color={colors.inkSecondary} />
      </View>
    );
  }

  if (!user) return <Redirect href="/(auth)/login" />;
  if (role && FAMILY_ROLES.includes(role)) return <Redirect href="/(auth)/wrong-app" />;

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.canvas },
      }}
    />
  );
}
