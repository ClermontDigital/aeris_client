import { settingsStore } from '../settingsStore';
import { DEFAULT_SETTINGS } from '../../shared-types/ipc';
import StoreMock from 'electron-store';

describe('settingsStore', () => {
  beforeEach(() => {
    (StoreMock as unknown as { __resetAll: () => void }).__resetAll();
    settingsStore._reset();
  });

  test('returns defaults when nothing has been written', () => {
    const got = settingsStore.get();
    expect(got).toEqual(DEFAULT_SETTINGS);
  });

  test('set merges patch over previous value', () => {
    settingsStore.set({ workspaceCode: 'demo' });
    expect(settingsStore.get().workspaceCode).toBe('demo');
    expect(settingsStore.get().relayUrl).toBe(DEFAULT_SETTINGS.relayUrl);
  });

  test('onChange listener fires with prev + next on every set()', () => {
    const fn = jest.fn();
    const off = settingsStore.onChange(fn);
    settingsStore.set({ autoLockMs: 60_000 });
    expect(fn).toHaveBeenCalledTimes(1);
    const [next, prev] = fn.mock.calls[0];
    expect(prev.autoLockMs).toBe(DEFAULT_SETTINGS.autoLockMs);
    expect(next.autoLockMs).toBe(60_000);
    off();
    settingsStore.set({ autoLockMs: 30_000 });
    expect(fn).toHaveBeenCalledTimes(1); // unsubscribed
  });
});
