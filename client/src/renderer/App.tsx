import React, { useEffect } from 'react';
import { useAuthStore } from './stores/authStore';
import { useSettingsStore } from './stores/settingsStore';
import { useAppLockStore } from './stores/appLockStore';
import { Routes } from './router/Routes';
import { Spinner } from './components/Spinner';
import { COLORS } from './theme/tokens';

export function App(): React.ReactElement {
  const authInitialized = useAuthStore((s) => s.initialized);
  const lockInitialized = useAppLockStore((s) => s.initialized);
  const init = useAuthStore((s) => s.init);
  const initSettings = useSettingsStore((s) => s.init);
  const initLock = useAppLockStore((s) => s.init);

  useEffect(() => {
    void init();
    void initSettings();
    void initLock();
  }, [init, initSettings, initLock]);

  // Wait for BOTH auth AND lock state — otherwise ProtectedShell would
  // briefly see the default `isPinSet: false` for users who already
  // have a PIN and flash PinSetupScreen on every cold start.
  if (!authInitialized || !lockInitialized) {
    return (
      <div
        style={{
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: COLORS.background,
        }}
      >
        <Spinner label="Starting Aeris…" />
      </div>
    );
  }

  return <Routes />;
}
