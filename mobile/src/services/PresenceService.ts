import {Platform} from 'react-native';
import * as Application from 'expo-application';
import * as Crypto from 'expo-crypto';
import {SecureStorage} from './StorageService';

// PresenceService — stable per-device id for the DR presence beacon.
// Source of truth: docs/PROJECT_DR_NAS_WARM_FAILOVER.md §22.5 Q2.
//
// The beacon TRANSPORT now lives in usePresenceBeacon →
// ApiClient.reportDrPresence (the route-proxied `dr.presence` action); this
// module retains only the device-id mint that beacon needs.
//
// device_id: a mint-on-first-launch UUID persisted in SecureStore. Preferred
// over the raw expo-application IDs because it survives reinstall (iOS
// getIosIdForVendorAsync resets when the last vendor app is removed) and is a
// stable, non-PII opaque token. expo-application IDs are the fallback only if
// SecureStore is unavailable.

const DEVICE_ID_KEY = 'aeris_dr_device_id';

let cachedDeviceId: string | null = null;

// Mint-on-first-launch, SecureStore-persisted, opaque device id.
export async function getDeviceId(): Promise<string> {
  if (cachedDeviceId) return cachedDeviceId;
  try {
    const existing = await SecureStorage.getItem(DEVICE_ID_KEY);
    if (existing) {
      cachedDeviceId = existing;
      return existing;
    }
    const minted = Crypto.randomUUID();
    await SecureStorage.setItem(DEVICE_ID_KEY, minted);
    cachedDeviceId = minted;
    return minted;
  } catch {
    // SecureStore unavailable — fall back to a stable platform id (non-
    // persisted across reinstall, but better than nothing for this beacon).
    let platformId: string | null = null;
    try {
      platformId =
        Platform.OS === 'android'
          ? Application.getAndroidId()
          : await Application.getIosIdForVendorAsync();
    } catch {
      platformId = null;
    }
    const fallback = platformId || Crypto.randomUUID();
    cachedDeviceId = fallback;
    return fallback;
  }
}
