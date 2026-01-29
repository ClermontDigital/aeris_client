import {useSettingsStore} from '../stores/settingsStore';

export function useSettings() {
  const settings = useSettingsStore(s => s.settings);
  const isLoading = useSettingsStore(s => s.isLoading);
  const saveSettings = useSettingsStore(s => s.saveSettings);
  const testConnection = useSettingsStore(s => s.testConnection);

  return {settings, saveSettings, testConnection, isLoading};
}
