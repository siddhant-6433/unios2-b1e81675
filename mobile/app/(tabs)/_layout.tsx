import { Tabs } from 'expo-router';
import { useAuth, type AppRole } from '../../contexts/AuthContext';
import { Redirect } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { colors } from '../../constants/Colors';
import {
  Home, User, BookOpen, Bell,
  IndianRupee, Inbox, Briefcase,
} from 'lucide-react-native';

type TabConfig = {
  name: string;
  title: string;
  icon: typeof Home;
};

const roleTabs: Record<string, TabConfig[]> = {
  admin: [
    { name: 'index', title: 'Me', icon: Home },
    { name: 'inbox', title: 'Inbox', icon: Inbox },
    { name: 'work', title: 'Work', icon: Briefcase },
  ],
  employee: [
    { name: 'index', title: 'Me', icon: Home },
    { name: 'inbox', title: 'Inbox', icon: Inbox },
    { name: 'work', title: 'Work', icon: Briefcase },
  ],
  office: [
    { name: 'index', title: 'Me', icon: Home },
    { name: 'inbox', title: 'Inbox', icon: Inbox },
    { name: 'work', title: 'Work', icon: Briefcase },
  ],
  librarian: [
    { name: 'index', title: 'Me', icon: Home },
    { name: 'inbox', title: 'Inbox', icon: Inbox },
    { name: 'work', title: 'Work', icon: Briefcase },
  ],
  faculty: [
    { name: 'index', title: 'Me', icon: Home },
    { name: 'inbox', title: 'Inbox', icon: Inbox },
    { name: 'work', title: 'Work', icon: Briefcase },
  ],
  student: [
    { name: 'index', title: 'Home', icon: Home },
    { name: 'library', title: 'Library', icon: BookOpen },
    { name: 'fees', title: 'Fees', icon: IndianRupee },
    { name: 'notices', title: 'Notices', icon: Bell },
    { name: 'profile', title: 'Profile', icon: User },
  ],
  // Parent
  parent: [
    { name: 'index', title: 'Home', icon: Home },
    { name: 'library', title: 'Library', icon: BookOpen },
    { name: 'fees', title: 'Fees', icon: IndianRupee },
    { name: 'notices', title: 'Notices', icon: Bell },
    { name: 'profile', title: 'Profile', icon: User },
  ],
};

function getTabSet(role: AppRole | null): TabConfig[] {
  if (!role) return roleTabs.student;
  if (['super_admin', 'campus_admin', 'principal', 'admission_head'].includes(role)) return roleTabs.admin;
  if (role === 'librarian') return roleTabs.librarian;
  if (['faculty', 'teacher', 'ib_coordinator'].includes(role)) return roleTabs.faculty;
  if (['office_admin', 'office_assistant'].includes(role)) return roleTabs.office;
  if (['counsellor', 'accountant', 'data_entry', 'hostel_warden'].includes(role)) return roleTabs.employee;
  if (role === 'parent') return roleTabs.parent;
  if (role === 'student') return roleTabs.student;
  return roleTabs.employee;
}

// All possible tab screen file names
const allScreens = ['index', 'work', 'punch', 'student-photos', 'inbox', 'hr', 'team', 'classes', 'library', 'fees', 'notices', 'leave', 'profile'];

export default function TabLayout() {
  const { user, role, loading } = useAuth();

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!user) return <Redirect href="/login" />;

  const tabs = getTabSet(role);
  const visibleNames = new Set(tabs.map(t => t.name));

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: {
          backgroundColor: colors.card,
          borderTopColor: colors.border,
          borderTopWidth: 1,
          height: 60,
          paddingBottom: 6,
          paddingTop: 6,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
      }}
    >
      {allScreens.map((screenName) => {
        const tab = tabs.find(t => t.name === screenName);
        const isVisible = visibleNames.has(screenName);

        return (
          <Tabs.Screen
            key={screenName}
            name={screenName}
            options={{
              title: tab?.title || screenName,
              href: isVisible ? undefined : null,
              tabBarIcon: tab
                ? ({ color, size }) => <tab.icon size={size - 4} color={color} />
                : undefined,
            }}
          />
        );
      })}
    </Tabs>
  );
}
