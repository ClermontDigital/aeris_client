import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {STORAGE_KEYS} from '../constants/config';

const SECURE_STORE_OPTIONS = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

// --- XOR cipher for BulkStorage encryption ---
// Operates on UTF-8 bytes to avoid multi-byte character corruption with btoa/atob.
// Will be upgraded to AES-256-GCM once expo-crypto's full API is available.
function xorBytes(input: Uint8Array, key: string): Uint8Array {
  if (!key) return input;
  const result = new Uint8Array(input.length);
  for (let i = 0; i < input.length; i++) {
    result[i] = input[i] ^ key.charCodeAt(i % key.length);
  }
  return result;
}

// Convert a byte array to a Latin1 string in fixed-size chunks. The obvious
// `String.fromCharCode(...bytes)` spread blows the native call stack for any
// payload past ~10K bytes on Hermes — which is exactly what happens the moment
// the product catalogue grows into the hundreds. Symptom is a silent
// syncProducts failure ("Maximum call stack size exceeded"), which then reads
// as "POS category pills empty" + "Items Low/Out counters stuck". Chunking at
// 8192 bytes stays well under the arg-count limit while still being fast.
const LATIN1_CHUNK = 8192;
function bytesToLatin1(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += LATIN1_CHUNK) {
    const chunk = bytes.subarray(i, i + LATIN1_CHUNK);
    out += String.fromCharCode.apply(null, Array.from(chunk));
  }
  return out;
}

function encryptValue(value: string, key: string): string {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(value);
  const xored = xorBytes(bytes, key);
  // Convert bytes to Latin1 string for btoa (all values 0-255, safe).
  return btoa(bytesToLatin1(xored));
}

function decryptValue(encoded: string, key: string): string {
  const decoded = atob(encoded);
  const bytes = new Uint8Array(decoded.length);
  for (let i = 0; i < decoded.length; i++) {
    bytes[i] = decoded.charCodeAt(i);
  }
  const decrypted = xorBytes(bytes, key);
  const decoder = new TextDecoder();
  return decoder.decode(decrypted);
}

async function getEncryptionKey(): Promise<string> {
  const key = await SecureStore.getItemAsync(
    STORAGE_KEYS.ENCRYPTION_KEY,
    SECURE_STORE_OPTIONS,
  );
  return key || '';
}

/**
 * SecureStorage: for small secret values (encryption key, auth tokens).
 * Uses expo-secure-store backed by iOS Keychain / Android Keystore.
 */
export const SecureStorage = {
  async setItem(key: string, value: string): Promise<void> {
    await SecureStore.setItemAsync(key, value, SECURE_STORE_OPTIONS);
  },

  async getItem(key: string): Promise<string | null> {
    return SecureStore.getItemAsync(key, SECURE_STORE_OPTIONS);
  },

  async removeItem(key: string): Promise<void> {
    await SecureStore.deleteItemAsync(key, SECURE_STORE_OPTIONS);
  },
};

/**
 * BulkStorage: for larger data (settings, product cache, sessions).
 * Uses AsyncStorage with XOR encryption using a key from SecureStore.
 */
export const BulkStorage = {
  async setItem(key: string, value: unknown): Promise<void> {
    const json = JSON.stringify(value);
    const encKey = await getEncryptionKey();
    if (encKey) {
      const encrypted = encryptValue(json, encKey);
      await AsyncStorage.setItem(key, encrypted);
    } else {
      // No encryption key yet — store as plain JSON (only during initial setup)
      await AsyncStorage.setItem(key, json);
    }
  },

  async getItem<T>(key: string): Promise<T | null> {
    const raw = await AsyncStorage.getItem(key);
    if (raw === null) return null;

    const encKey = await getEncryptionKey();
    try {
      if (encKey) {
        const decrypted = decryptValue(raw, encKey);
        return JSON.parse(decrypted) as T;
      }
      return JSON.parse(raw) as T;
    } catch {
      // If decryption or parsing fails, try plain JSON as fallback
      // (handles migration from pre-encryption data)
      try {
        return JSON.parse(raw) as T;
      } catch {
        return null;
      }
    }
  },

  async removeItem(key: string): Promise<void> {
    await AsyncStorage.removeItem(key);
  },

  async clear(keys: string[]): Promise<void> {
    await AsyncStorage.multiRemove(keys);
  },
};

// All known storage keys for full clear
const ALL_KNOWN_KEYS = Object.values(STORAGE_KEYS);

/**
 * Backward-compatible StorageService.
 * Delegates to SecureStorage for set/get/remove (same string-based API).
 * The clear() method removes all known keys from both stores.
 */
const StorageService = {
  async setItem(key: string, value: unknown): Promise<void> {
    await BulkStorage.setItem(key, value);
  },

  async getItem<T>(key: string): Promise<T | null> {
    return BulkStorage.getItem<T>(key);
  },

  async removeItem(key: string): Promise<void> {
    await BulkStorage.removeItem(key);
  },

  async clear(): Promise<void> {
    // Remove all known keys from AsyncStorage (bulk data)
    await BulkStorage.clear(ALL_KNOWN_KEYS);
    // Remove all known keys from SecureStore (expo-secure-store lacks clear())
    for (const key of ALL_KNOWN_KEYS) {
      try {
        await SecureStorage.removeItem(key);
      } catch {
        // Key may not exist in SecureStore — ignore
      }
    }
  },
};

export default StorageService;
