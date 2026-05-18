import * as LocalAuthentication from 'expo-local-authentication';
import EncryptionService from './EncryptionService';
import {SecureStorage} from './StorageService';

const PIN_HASH_KEY = 'aeris_app_lock_pin';
const BIOMETRIC_PREF_KEY = 'aeris_app_lock_biometric';

interface StoredPin {
  hash: string;
  salt: string;
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
    const raw = await SecureStorage.getItem(PIN_HASH_KEY);
    if (!raw) return false;
    let data: StoredPin;
    try {
      data = JSON.parse(raw) as StoredPin;
    } catch {
      return false;
    }
    await EncryptionService.init();
    return EncryptionService.verifyPin(pin, data);
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
