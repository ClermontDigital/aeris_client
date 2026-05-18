import {useMemo} from 'react';
import * as Haptics from 'expo-haptics';
import {useSettingsStore} from '../stores/settingsStore';

// Treats `undefined` as enabled — older persisted settings predate this flag
// and we don't want a silent regression on first launch after upgrade.
function isEnabled(flag: boolean | undefined): boolean {
  return flag !== false;
}

async function safe(p: () => Promise<unknown>): Promise<void> {
  try {
    await p();
  } catch {
    // Haptics throws on devices without a Taptic engine (some Androids,
    // simulators). Feedback is non-essential — never let it crash the app.
  }
}

export function useHaptics() {
  const enabled = useSettingsStore(s => isEnabled(s.settings.hapticsEnabled));

  return useMemo(
    () => ({
      light: () =>
        enabled
          ? safe(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light))
          : Promise.resolve(),
      medium: () =>
        enabled
          ? safe(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium))
          : Promise.resolve(),
      selection: () =>
        enabled ? safe(() => Haptics.selectionAsync()) : Promise.resolve(),
      success: () =>
        enabled
          ? safe(() =>
              Haptics.notificationAsync(
                Haptics.NotificationFeedbackType.Success,
              ),
            )
          : Promise.resolve(),
      error: () =>
        enabled
          ? safe(() =>
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error),
            )
          : Promise.resolve(),
    }),
    [enabled],
  );
}
