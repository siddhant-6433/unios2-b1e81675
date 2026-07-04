import { createClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import type { Database } from './database.types';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

// SecureStore values are capped (~2KB advisory; hard failures above it on
// some Android keystores) and Supabase sessions routinely exceed that.
// Chunk values across `${key}__chunk_N` entries with a count marker.
const CHUNK_SIZE = 1800;

async function chunkedGet(key: string): Promise<string | null> {
  const countRaw = await SecureStore.getItemAsync(`${key}__chunks`);
  if (!countRaw) {
    // Legacy single-value entry (pre-chunking sessions survive the upgrade).
    return SecureStore.getItemAsync(key);
  }
  const count = Number(countRaw);
  const parts = await Promise.all(
    Array.from({ length: count }, (_, i) => SecureStore.getItemAsync(`${key}__chunk_${i}`)),
  );
  if (parts.some((part) => part === null)) return null;
  return parts.join('');
}

async function chunkedSet(key: string, value: string): Promise<void> {
  const chunks: string[] = [];
  for (let i = 0; i < value.length; i += CHUNK_SIZE) {
    chunks.push(value.slice(i, i + CHUNK_SIZE));
  }
  await Promise.all([
    SecureStore.setItemAsync(`${key}__chunks`, String(chunks.length)),
    ...chunks.map((chunk, i) => SecureStore.setItemAsync(`${key}__chunk_${i}`, chunk)),
  ]);
  // Clear any legacy unchunked value so stale sessions can't resurface.
  await SecureStore.deleteItemAsync(key).catch(() => {});
}

async function chunkedRemove(key: string): Promise<void> {
  const countRaw = await SecureStore.getItemAsync(`${key}__chunks`);
  const count = countRaw ? Number(countRaw) : 0;
  await Promise.all([
    SecureStore.deleteItemAsync(key).catch(() => {}),
    SecureStore.deleteItemAsync(`${key}__chunks`).catch(() => {}),
    ...Array.from({ length: count }, (_, i) =>
      SecureStore.deleteItemAsync(`${key}__chunk_${i}`).catch(() => {}),
    ),
  ]);
}

const SecureStoreAdapter = {
  getItem: async (key: string): Promise<string | null> => {
    if (Platform.OS === 'web') {
      if (typeof localStorage !== 'undefined') return localStorage.getItem(key);
      return null;
    }
    return chunkedGet(key);
  },
  setItem: async (key: string, value: string): Promise<void> => {
    if (Platform.OS === 'web') {
      if (typeof localStorage !== 'undefined') localStorage.setItem(key, value);
      return;
    }
    await chunkedSet(key, value);
  },
  removeItem: async (key: string): Promise<void> => {
    if (Platform.OS === 'web') {
      if (typeof localStorage !== 'undefined') localStorage.removeItem(key);
      return;
    }
    await chunkedRemove(key);
  },
};

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: SecureStoreAdapter,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
