import EncryptedStorage from 'react-native-encrypted-storage';

class StorageService {
  async setItem(key: string, value: unknown): Promise<void> {
    await EncryptedStorage.setItem(key, JSON.stringify(value));
  }

  async getItem<T>(key: string): Promise<T | null> {
    const raw = await EncryptedStorage.getItem(key);
    if (raw === null || raw === undefined) return null;
    return JSON.parse(raw) as T;
  }

  async removeItem(key: string): Promise<void> {
    await EncryptedStorage.removeItem(key);
  }

  async clear(): Promise<void> {
    await EncryptedStorage.clear();
  }
}

export default new StorageService();
