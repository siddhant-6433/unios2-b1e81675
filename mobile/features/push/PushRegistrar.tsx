import { useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { attachNotificationRouter, registerPushDevice } from '../../lib/push';

/** Registers this device for push when a user is signed in and wires tap deep-links. */
export function PushRegistrar() {
  const { user } = useAuth();

  useEffect(() => attachNotificationRouter(), []);

  useEffect(() => {
    if (user) registerPushDevice(user.id);
  }, [user?.id]);

  return null;
}
