import * as LocalAuthentication from 'expo-local-authentication';
import EncryptionService from './EncryptionService';
import {SecureStorage} from './StorageService';

const PIN_HASH_KEY = 'aeris_app_lock_pin';
const BIOMETRIC_PREF_KEY = 'aeris_app_lock_biometric';

interface StoredPin {
  hash: string;
  salt: string;
}

function isStoredPin(value: unknown): value is StoredPin {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  // Both fields must be non-empty strings — an empty {hash:"",salt:""}
  // would otherwise silently fail forever without triggering the wipe.
  return (
    typeof v.hash === 'string' &&
    typeof v.salt === 'string' &&
    v.hash.length > 0 &&
    v.salt.length > 0
  );
}

class AppLockService {
  async hasPin(): Promise<boolean> {
    const raw = await SecureStorage.getItem(PIN_HASH_KEY);
    return !!raw;
  }

  async setPin(pin: string): Promise<void> {
    if (!/^\d{4}$/.test(pin)) throw new Error('PIN must be 4 digits');
    await EncryptionService.init();
    const data = await EncryptionService.hashPin(pin);
    await SecureStorage.setItem(PIN_HASH_KEY, JSON.stringify(data));
  }

  async verifyPin(pin: string): Promise<boolean> {
    try {
      const raw = await SecureStorage.getItem(PIN_HASH_KEY);
      if (!raw) return false;
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        // Stored value isn't valid JSON — almost certainly a legacy
        // bare-hash string from a prior build. Drop it so the user gets
        // routed to PIN setup on the next attempt rather than re-tripping
        // this branch on every unlock.
        console.warn('AppLockService.verifyPin: stored PIN payload not JSON, clearing');
        await SecureStorage.removeItem(PIN_HASH_KEY);
        return false;
      }
      if (!isStoredPin(parsed)) {
        console.warn('AppLockService.verifyPin: stored PIN payload shape mismatch, clearing');
        await SecureStorage.removeItem(PIN_HASH_KEY);
        return false;
      }
      await EncryptionService.init();
      return await EncryptionService.verifyPin(pin, parsed);
    } catch (e) {
      console.warn('AppLockService.verifyPin: unexpected failure', e);
      return false;
    }
  }

  async clearPin(): Promise<void> {
    await SecureStorage.removeItem(PIN_HASH_KEY);
    await SecureStorage.removeItem(BIOMETRIC_PREF_KEY);
  }

  async isBiometricEnabled(): Promise<boolean> {
    const v = await SecureStorage.getItem(BIOMETRIC_PREF_KEY);
    return v === '1';
  }

  async setBiometricEnabled(enabled: boolean): Promise<void> {
    if (enabled) {
      await SecureStorage.setItem(BIOMETRIC_PREF_KEY, '1');
    } else {
      await SecureStorage.removeItem(BIOMETRIC_PREF_KEY);
    }
  }

  async isBiometricAvailable(): Promise<boolean> {
    try {
      const hasHw = await LocalAuthentication.hasHardwareAsync();
      if (!hasHw) return false;
      const enrolled = await LocalAuthentication.isEnrolledAsync();
      return enrolled;
    } catch {
      return false;
    }
  }

  async getBiometricLabel(): Promise<string> {
    try {
      const types =
        await LocalAuthentication.supportedAuthenticationTypesAsync();
      if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) {
        return 'Use Face ID';
      }
      if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) {
        return 'Use Fingerprint';
      }
      if (types.includes(LocalAuthentication.AuthenticationType.IRIS)) {
        return 'Use Iris';
      }
    } catch {
      // fall through
    }
    return 'Use Biometrics';
  }

  async authenticateWithBiometrics(): Promise<boolean> {
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Unlock Aeris',
        fallbackLabel: 'Use PIN',
        disableDeviceFallback: true,
      });
      return result.success;
    } catch {
      return false;
    }
  }
}

export default new AppLockService();
