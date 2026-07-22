// Device push registration (see DESIGN plan §4).
//
// IMPORTANT: do NOT import `expo-notifications` at module top level.
// On Android Expo Go (SDK 53+), that package logs a Console Error as soon as
// it is loaded because remote push was removed from Expo Go. We only dynamic-
// import it inside a real native build (dev-client / store).
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Application from 'expo-application';
import { router } from 'expo-router';
import { supabase } from './supabase';
import { APP_VARIANT } from './appVariant';

type NotificationsModule = typeof import('expo-notifications');

/** True when running inside Expo Go (not a custom dev client / store build). */
function isExpoGo(): boolean {
  return Constants.appOwnership === 'expo';
}

/** Push only works on a physical device in a native build — never Expo Go. */
function canUseNativePush(): boolean {
  return Device.isDevice && !isExpoGo();
}

function easProjectId(): string | undefined {
  return (
    Constants.expoConfig?.extra?.eas?.projectId ??
    (Constants as { easConfig?: { projectId?: string } }).easConfig?.projectId
  );
}

async function loadNotifications(): Promise<NotificationsModule | null> {
  if (!canUseNativePush()) return null;
  try {
    return await import('expo-notifications');
  } catch (err) {
    if (__DEV__) {
      console.warn(
        '[push] expo-notifications unavailable:',
        err instanceof Error ? err.message : err,
      );
    }
    return null;
  }
}

async function ensureAndroidChannels(Notifications: NotificationsModule): Promise<void> {
  if (Platform.OS !== 'android') return;
  const channels: Array<{ id: string; name: string; importance: number }> = [
    { id: 'default', name: 'General', importance: Notifications.AndroidImportance.DEFAULT },
    { id: 'approvals', name: 'Approvals', importance: Notifications.AndroidImportance.HIGH },
    { id: 'attendance', name: 'Attendance', importance: Notifications.AndroidImportance.HIGH },
    { id: 'payments', name: 'Payments & fees', importance: Notifications.AndroidImportance.DEFAULT },
  ];
  await Promise.all(
    channels.map((channel) =>
      Notifications.setNotificationChannelAsync(channel.id, {
        name: channel.name,
        importance: channel.importance,
      }),
    ),
  );
}

/**
 * Request permission, fetch the Expo push token, and register this device.
 * No-ops in Expo Go / simulators. Never throws; never uses console.error
 * (RN LogBox promotes console.error to a full-screen redbox).
 */
export async function registerPushDevice(userId: string): Promise<boolean> {
  if (!canUseNativePush()) {
    if (__DEV__ && isExpoGo()) {
      console.log('[push] skipped — Expo Go has no remote push (SDK 53+). Use a dev build.');
    }
    return false;
  }

  try {
    const Notifications = await loadNotifications();
    if (!Notifications) return false;

    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: false,
        shouldSetBadge: true,
      }),
    });

    const { status: existing } = await Notifications.getPermissionsAsync();
    let status = existing;
    if (existing !== 'granted') {
      const req = await Notifications.requestPermissionsAsync();
      status = req.status;
    }
    if (status !== 'granted') {
      if (__DEV__) console.log('[push] notification permission not granted');
      return false;
    }

    await ensureAndroidChannels(Notifications);

    const projectId = easProjectId();
    const tokenResult = projectId
      ? await Notifications.getExpoPushTokenAsync({ projectId })
      : await Notifications.getExpoPushTokenAsync();
    const token = tokenResult.data;
    if (!token) return false;

    // Cast: register_push_device is added by migration; Database types lag.
    const { error: rpcError } = await (supabase.rpc as Function)('register_push_device', {
      p_token: token,
      p_platform: Platform.OS === 'ios' ? 'ios' : 'android',
      p_app_variant: APP_VARIANT,
      p_device_name: Device.deviceName ?? null,
      p_app_version: Application.nativeApplicationVersion ?? null,
    });

    if (!rpcError) return true;

    const missingFn =
      rpcError.code === '42883' ||
      /function .* does not exist/i.test(rpcError.message) ||
      /could not find the function/i.test(rpcError.message);

    if (!missingFn) {
      if (__DEV__) console.warn('[push] register rpc failed:', rpcError.message);
      return false;
    }

    const { error } = await supabase.from('push_devices').upsert(
      {
        user_id: userId,
        expo_push_token: token,
        platform: Platform.OS === 'ios' ? 'ios' : 'android',
        app_variant: APP_VARIANT,
        device_name: Device.deviceName ?? null,
        app_version: Application.nativeApplicationVersion ?? null,
        last_seen_at: new Date().toISOString(),
        disabled_at: null,
      },
      { onConflict: 'expo_push_token' },
    );
    if (error) {
      if (__DEV__) console.warn('[push] register upsert failed:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    if (__DEV__) {
      console.warn('[push] register error:', err instanceof Error ? err.message : err);
    }
    return false;
  }
}

/** Disable this device's token on sign-out (shared-device safety). */
export async function unregisterPushDevice(): Promise<void> {
  if (!canUseNativePush()) return;
  try {
    const Notifications = await loadNotifications();
    if (!Notifications) return;

    const { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') return;

    const projectId = easProjectId();
    const tokenResult = projectId
      ? await Notifications.getExpoPushTokenAsync({ projectId })
      : await Notifications.getExpoPushTokenAsync();
    const token = tokenResult.data;
    if (!token) return;

    await supabase
      .from('push_devices')
      .update({ disabled_at: new Date().toISOString() })
      .eq('expo_push_token', token);
  } catch {
    // Best effort — never block sign-out.
  }
}

/** Notification taps deep-link via the push payload's data.url. */
export function attachNotificationRouter(): () => void {
  if (!canUseNativePush()) return () => {};

  let unsubscribe: (() => void) | undefined;
  let cancelled = false;

  void (async () => {
    const Notifications = await loadNotifications();
    if (!Notifications || cancelled) return;

    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const url = response.notification.request.content.data?.url;
      if (typeof url === 'string' && url.startsWith('/')) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        router.push(url as any);
      }
    });
    unsubscribe = () => sub.remove();
  })();

  return () => {
    cancelled = true;
    unsubscribe?.();
  };
}
