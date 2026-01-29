import ConnectionService from '../services/ConnectionService';

// Mock NetInfo
const listeners: Array<(state: any) => void> = [];
jest.mock('@react-native-community/netinfo', () => ({
  addEventListener: jest.fn((cb: any) => {
    listeners.push(cb);
    return () => {
      const idx = listeners.indexOf(cb);
      if (idx >= 0) listeners.splice(idx, 1);
    };
  }),
  fetch: jest.fn(() => Promise.resolve({isConnected: true, isInternetReachable: true})),
}));

// Mock fetch
global.fetch = jest.fn(() =>
  Promise.resolve({ok: true, status: 200} as Response),
);

describe('ConnectionService', () => {
  beforeEach(() => {
    listeners.length = 0;
    ConnectionService.stop();
    (global.fetch as jest.Mock).mockClear();
  });

  test('should start and subscribe to network changes', () => {
    ConnectionService.start('http://test.local:8000');
    expect(listeners.length).toBe(1);
  });

  test('should check server reachability', async () => {
    ConnectionService.start('http://test.local:8000');
    const result = await ConnectionService.checkServer();
    expect(global.fetch).toHaveBeenCalledWith('http://test.local:8000', expect.any(Object));
    expect(result).toBe(true);
  });

  test('should report unreachable on fetch failure', async () => {
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));
    ConnectionService.start('http://test.local:8000');
    const result = await ConnectionService.checkServer();
    expect(result).toBe(false);
  });

  test('should notify subscribers', async () => {
    const cb = jest.fn();
    ConnectionService.start('http://test.local:8000');
    ConnectionService.subscribe(cb);
    await ConnectionService.checkServer();
    expect(cb).toHaveBeenCalledWith(expect.objectContaining({isServerReachable: true}));
  });

  test('should stop and unsubscribe', () => {
    ConnectionService.start('http://test.local:8000');
    ConnectionService.stop();
    expect(listeners.length).toBe(0);
  });
});
