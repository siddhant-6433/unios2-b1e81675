import { Tabs } from 'expo-router';
import { Briefcase, Home, Inbox, User } from 'lucide-react-native';
import { useTheme } from '../../../theme/ThemeContext';

/** Staff tab set is identical for all roles — role variation lives inside Work. */
export default function StaffTabLayout() {
  const { colors, mode } = useTheme();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.ink,
        tabBarInactiveTintColor: colors.inkMuted,
        tabBarStyle: {
          backgroundColor: colors.card,
          borderTopWidth: mode === 'dark' ? 0 : 0.5,
          borderTopColor: colors.line,
          height: 62,
          paddingBottom: 8,
          paddingTop: 8,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Me',
          tabBarIcon: ({ color, size }) => <Home size={size - 4} color={color} />,
        }}
      />
      <Tabs.Screen
        name="inbox"
        options={{
          title: 'Inbox',
          tabBarIcon: ({ color, size }) => <Inbox size={size - 4} color={color} />,
        }}
      />
      <Tabs.Screen
        name="work"
        options={{
          title: 'Work',
          tabBarIcon: ({ color, size }) => <Briefcase size={size - 4} color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, size }) => <User size={size - 4} color={color} />,
        }}
      />
    </Tabs>
  );
}
