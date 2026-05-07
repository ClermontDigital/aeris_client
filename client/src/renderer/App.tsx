import React, { useEffect } from 'react';
import { useAuthStore } from './stores/authStore';
import { useSettingsStore } from './stores/settingsStore';
import { Routes } from './router/Routes';
import { Spinner } from './components/Spinner';
import { COLORS } from './theme/tokens';

export function App(): React.ReactElement {
  const initialized = useAuthStore((s) => s.initialized);
  const init = useAuthStore((s) => s.init);
  const initSettings = useSettingsStore((s) => s.init);

  useEffect(() => {
    void init();
    void initSettings();
  }, [init, initSettings]);

  if (!initialized) {
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
