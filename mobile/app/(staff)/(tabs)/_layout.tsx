import { Tabs } from 'expo-router';
import { Briefcase, Home, MessageCircle, User } from 'lucide-react-native';
import { useTheme } from '../../../theme/ThemeContext';
import { Platform } from 'react-native';

/** Staff tab set — role variation lives inside Me / Work. Chats = WhatsApp-mimic. */
export default function StaffTabLayout() {
  const { colors, mode } = useTheme();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: mode === 'dark' ? colors.ink : colors.inverseInk,
        tabBarInactiveTintColor: mode === 'dark' ? colors.inkMuted : 'rgba(243,245,249,0.55)',
        tabBarStyle: {
          backgroundColor: mode === 'dark' ? colors.card : colors.inverse,
          borderTopWidth: 0,
          height: Platform.OS === 'ios' ? 84 : 64,
          paddingBottom: Platform.OS === 'ios' ? 28 : 10,
          paddingTop: 10,
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
          title: 'Chats',
          tabBarIcon: ({ color, size }) => <MessageCircle size={size - 4} color={color} />,
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
