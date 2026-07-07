// Device push registration (see DESIGN plan §4).
// Every physical device registers its Expo push token (which wraps the
// native APNs/FCM token) against the signed-in user in push_devices.
// Sign-out disables the row so the next user of a shared device never
// receives the previous user's notifications.
import { Platform } from 'react-native';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import * as Application from 'expo-application';
import { router } from 'expo-router';
import { supabase } from './supabase';
import { APP_VARIANT } from './appVariant';

const ANDROID_CHANNELS: Array<{ id: string; name: string; importance: Notifications.AndroidImportance }> = [
  { id: 'default', name: 'General', importance: Notifications.AndroidImportance.DEFAULT },
  { id: 'approvals', name: 'Approvals', importance: Notifications.AndroidImportance.HIGH },
  { id: 'attendance', name: 'Attendance', importance: Notifications.AndroidImportance.HIGH },
  { id: 'payments', name: 'Payments & fees', importance: Notifications.AndroidImportance.DEFAULT },
];

async function ensureAndroidChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Promise.all(
    ANDROID_CHANNELS.map((channel) =>
      Notifications.setNotificationChannelAsync(channel.id, {
        name: channel.name,
        importance: channel.importance,
      }),
    ),
  );
}

/**
 * Request permission (call after the in-app priming screen), fetch the Expo
 * push token, and upsert this device against the current user.
 * Returns true when the device is registered.
 */
export async function registerPushDevice(userId: string): Promise<boolean> {
  if (!Device.isDevice) return false;

  try {
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
    if (status !== 'granted') return false;

    await ensureAndroidChannels();

    const { data: tokenData } = await Notifications.getExpoPushTokenAsync();
    const token = tokenData;
    if (!token) return false;

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
      console.error('[push] register failed:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[push] register error:', err instanceof Error ? err.message : err);
    return false;
  }
}

/** Disable this device's token on sign-out (shared-device safety). */
export async function unregisterPushDevice(): Promise<void> {
  if (!Device.isDevice) return;
  try {
    const { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') return;
    const { data: token } = await Notifications.getExpoPushTokenAsync();
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
  if (!Device.isDevice) return () => {};
  const sub = Notifications.addNotificationResponseReceivedListener((response) => {
    const url = response.notification.request.content.data?.url;
    if (typeof url === 'string' && url.startsWith('/')) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      router.push(url as any);
    }
  });
  return () => sub.remove();
}
