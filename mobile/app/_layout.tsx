import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { AuthProvider } from '../contexts/AuthContext';
import { ThemeProvider, useTheme } from '../theme/ThemeContext';
import { QueryProvider } from '../lib/query';
import { AppLockGate } from '../features/applock/AppLockGate';
import { PushRegistrar } from '../features/push/PushRegistrar';
import 'react-native-reanimated';
// Patches supabase.functions.invoke to always send the session's real JWT.
import '../lib/invokeEdge';

export { ErrorBoundary } from 'expo-router';

SplashScreen.preventAutoHideAsync();

function RootStack() {
  const { colors, mode } = useTheme();

  useEffect(() => {
    SplashScreen.hideAsync();
  }, []);

  return (
    <>
      <StatusBar style={mode === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.canvas },
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(staff)" />
        <Stack.Screen name="(family)" />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  return (
    <ThemeProvider>
      <QueryProvider>
        <AuthProvider>
          <AppLockGate>
            <PushRegistrar />
            <RootStack />
          </AppLockGate>
        </AuthProvider>
      </QueryProvider>
    </ThemeProvider>
  );
}
