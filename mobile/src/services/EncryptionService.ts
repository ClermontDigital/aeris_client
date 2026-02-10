import 'react-native-get-random-values';
import EncryptedStorage from 'react-native-encrypted-storage';
import {STORAGE_KEYS} from '../constants/config';

// Uses crypto.getRandomValues (polyfilled by react-native-get-random-values)
// for cryptographically secure random number generation.
// PINs are stored as one-way salted hashes (not reversible).
// The real security comes from EncryptedStorage being hardware-backed
// (Android Keystore / iOS Keychain).

function secureRandomHex(byteCount: number): string {
  const bytes = new Uint8Array(byteCount);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

class EncryptionService {
  private key: string | null = null;

  async init(): Promise<void> {
    let stored = await EncryptedStorage.getItem(STORAGE_KEYS.ENCRYPTION_KEY);
    if (!stored) {
      // Generate a cryptographically secure key (32 bytes = 64 hex chars)
      const key = secureRandomHex(32);
      await EncryptedStorage.setItem(STORAGE_KEYS.ENCRYPTION_KEY, key);
      stored = key;
    }
    this.key = stored;
  }

  hashPin(pin: string): {hash: string; salt: string} {
    if (!this.key) throw new Error('EncryptionService not initialized');
    const salt = secureRandomHex(16);
    const hash = this.computeHash(pin, salt);
    return {hash, salt};
  }

  verifyPin(pin: string, data: {hash: string; salt: string}): boolean {
    if (!this.key) throw new Error('EncryptionService not initialized');
    const computed = this.computeHash(pin, data.salt);
    // Constant-time comparison to prevent timing attacks
    if (computed.length !== data.hash.length) return false;
    let diff = 0;
    for (let i = 0; i < computed.length; i++) {
      diff |= computed.charCodeAt(i) ^ data.hash.charCodeAt(i);
    }
    return diff === 0;
  }

  private computeHash(pin: string, salt: string): string {
    const input = `${salt}:${pin}:${this.key}`;

    // 256-bit state using 8 x 32-bit words, initialized with SHA-256 constants
    const state = new Uint32Array([
      0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
      0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
    ]);

    // Multiple rounds of mixing for key stretching
    for (let round = 0; round < 10000; round++) {
      for (let i = 0; i < input.length; i++) {
        const idx = (i + round) % 8;
        state[idx] = (state[idx] ^ (input.charCodeAt(i) + round)) >>> 0;
        state[idx] = Math.imul(state[idx], 0x01000193) >>> 0;
        state[(idx + 1) % 8] = (state[(idx + 1) % 8] ^ (state[idx] >>> 13)) >>> 0;
        state[(idx + 3) % 8] = (state[(idx + 3) % 8] + state[idx]) >>> 0;
      }
    }

    return Array.from(state)
      .map(v => v.toString(16).padStart(8, '0'))
      .join('');
  }
}

export default new EncryptionService();
