import 'react-native-get-random-values';
import EncryptedStorage from 'react-native-encrypted-storage';
import {STORAGE_KEYS} from '../constants/config';

// Uses crypto.getRandomValues (polyfilled by react-native-get-random-values)
// for cryptographically secure random number generation.
// PIN encryption uses XOR with a persistent key stored in Android Keystore / iOS Keychain.
// The real security comes from EncryptedStorage being hardware-backed.

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

  encryptPin(pin: string): {encrypted: string; iv: string; authTag: string} {
    if (!this.key) throw new Error('EncryptionService not initialized');

    // Generate cryptographically secure random IV (16 bytes = 32 hex chars)
    const iv = secureRandomHex(16);

    // XOR-based encryption (PIN is short, real security is from EncryptedStorage)
    const pinBytes = pin.split('').map(c => c.charCodeAt(0));
    const keyBytes = this.key.match(/.{2}/g)!.map(h => parseInt(h, 16));
    const ivBytes = iv.match(/.{2}/g)!.map(h => parseInt(h, 16));

    const encrypted = pinBytes
      .map((b, i) => b ^ keyBytes[i % keyBytes.length] ^ ivBytes[i % ivBytes.length])
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    // Simple HMAC-like tag for integrity
    let tag = 0;
    for (let i = 0; i < pinBytes.length; i++) {
      tag = (tag * 31 + pinBytes[i] + keyBytes[i % keyBytes.length]) & 0xffffffff;
    }
    const authTag = tag.toString(16).padStart(8, '0');

    return {encrypted, iv, authTag};
  }

  decryptPin(data: {encrypted: string; iv: string; authTag: string}): string | null {
    if (!this.key) throw new Error('EncryptionService not initialized');

    try {
      const encBytes = data.encrypted.match(/.{2}/g)!.map(h => parseInt(h, 16));
      const keyBytes = this.key.match(/.{2}/g)!.map(h => parseInt(h, 16));
      const ivBytes = data.iv.match(/.{2}/g)!.map(h => parseInt(h, 16));

      const decrypted = encBytes
        .map((b, i) => b ^ keyBytes[i % keyBytes.length] ^ ivBytes[i % ivBytes.length])
        .map(b => String.fromCharCode(b))
        .join('');

      // Verify integrity tag
      const pinBytes = decrypted.split('').map(c => c.charCodeAt(0));
      let tag = 0;
      for (let i = 0; i < pinBytes.length; i++) {
        tag = (tag * 31 + pinBytes[i] + keyBytes[i % keyBytes.length]) & 0xffffffff;
      }
      const expectedTag = tag.toString(16).padStart(8, '0');

      if (expectedTag !== data.authTag) return null;
      return decrypted;
    } catch {
      return null;
    }
  }
}

export default new EncryptionService();
