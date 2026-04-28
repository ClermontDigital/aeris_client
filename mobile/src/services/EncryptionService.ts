import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import {STORAGE_KEYS} from '../constants/config';

// Uses expo-crypto for cryptographically secure random number generation.
// PINs are stored as one-way salted hashes (not reversible).
// The real security comes from expo-secure-store being hardware-backed
// (Android Keystore / iOS Keychain).

function secureRandomHex(byteCount: number): string {
  const bytes = Crypto.getRandomBytes(byteCount);
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

class EncryptionService {
  private key: string | null = null;

  async init(): Promise<void> {
    let stored = await SecureStore.getItemAsync(STORAGE_KEYS.ENCRYPTION_KEY);
    if (!stored) {
      const key = secureRandomHex(32);
      await SecureStore.setItemAsync(STORAGE_KEYS.ENCRYPTION_KEY, key);
      stored = key;
    }
    this.key = stored;
  }

  async hashPin(pin: string): Promise<{hash: string; salt: string}> {
    if (!this.key) throw new Error('EncryptionService not initialized');
    const salt = secureRandomHex(16);
    const hash = await this.deriveKey(pin, salt, this.key);
    return {hash, salt};
  }

  async verifyPin(pin: string, data: {hash: string; salt: string}): Promise<boolean> {
    if (!this.key) throw new Error('EncryptionService not initialized');
    const computed = await this.deriveKey(pin, data.salt, this.key);
    // Constant-time comparison to prevent timing attacks
    if (computed.length !== data.hash.length) return false;
    let diff = 0;
    for (let i = 0; i < computed.length; i++) {
      diff |= computed.charCodeAt(i) ^ data.hash.charCodeAt(i);
    }
    return diff === 0;
  }

  // Iterated SHA-256 key stretching using expo-crypto's digestStringAsync.
  // Uses iterated SHA-256 hashing with salt and key mixing.
  // Each round feeds the previous hash back in, providing key stretching.
  private async deriveKey(pin: string, salt: string, key: string): Promise<string> {
    let current = `${salt}:${pin}:${key}`;
    // 1000 rounds of SHA-256 — each round hashes the previous output with the salt.
    // This provides meaningful key stretching while remaining performant on mobile.
    for (let i = 0; i < 1000; i++) {
      current = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        `${i}:${salt}:${current}`,
      );
    }
    return current;
  }
}

export default new EncryptionService();
