import {renderHook, waitFor} from '@testing-library/react-native';

// usePresenceBeacon — beats the DR presence beacon through the aligned
// `dr.presence` path (ApiClient.reportDrPresence), gated on DR being
// provisioned for the deployment. mock-prefixed names for jest hoisting.

const mockReportDrPresence = jest.fn(() => Promise.resolve(true));
const mockGetDeviceId = jest.fn(() => Promise.resolve('dev-1'));
const drState = {drEnabled: true};
const settings = {presenceBeaconEnabled: false};
const auth = {isAuthenticated: true};
const decision = {currentMode: 'cloud' as 'cloud' | 'local' | 'switching' | 'offline'};

jest.mock('../../services/ApiClient', () => ({
  __esModule: true,
  default: {reportDrPresence: (...a: unknown[]) => mockReportDrPresence(...a)},
}));
jest.mock('../../services/PresenceService', () => ({
  getDeviceId: () => mockGetDeviceId(),
}));
jest.mock('../useRoutingDecision', () => ({
  useRoutingDecision: () => ({currentMode: decision.currentMode}),
}));
jest.mock('../../stores/authStore', () => ({
  useAuthStore: (sel: (s: {isAuthenticated: boolean}) => unknown) =>
    sel({isAuthenticated: auth.isAuthenticated}),
}));
jest.mock('../../stores/drStore', () => ({
  useDrStore: {getState: () => drState},
}));
jest.mock('../../stores/settingsStore', () => ({
  useSettingsStore: {getState: () => ({settings})},
}));

import {usePresenceBeacon} from '../usePresenceBeacon';

describe('usePresenceBeacon', () => {
  beforeEach(() => {
    mockReportDrPresence.mockClear();
    mockGetDeviceId.mockClear();
    drState.drEnabled = true;
    settings.presenceBeaconEnabled = false;
    auth.isAuthenticated = true;
    decision.currentMode = 'cloud';
  });

  it('beats via dr.presence on mount when DR is provisioned + authenticated', async () => {
    renderHook(() => usePresenceBeacon());
    await waitFor(() =>
      expect(mockReportDrPresence).toHaveBeenCalledWith({
        device_id: 'dev-1',
        mode: 'cloud',
      }),
    );
  });

  it('reports mode "local" when the device is operating in local mode', async () => {
    decision.currentMode = 'local';
    renderHook(() => usePresenceBeacon());
    await waitFor(() =>
      expect(mockReportDrPresence).toHaveBeenCalledWith({
        device_id: 'dev-1',
        mode: 'local',
      }),
    );
  });

  it('does NOT beat for a non-DR deployment (drEnabled false, no opt-in)', async () => {
    drState.drEnabled = false;
    renderHook(() => usePresenceBeacon());
    await new Promise(r => setTimeout(r, 20));
    expect(mockReportDrPresence).not.toHaveBeenCalled();
  });

  it('DOES beat for a non-DR deployment when the operator opts in', async () => {
    drState.drEnabled = false;
    settings.presenceBeaconEnabled = true;
    renderHook(() => usePresenceBeacon());
    await waitFor(() => expect(mockReportDrPresence).toHaveBeenCalled());
  });

  it('does not beat while unauthenticated', async () => {
    auth.isAuthenticated = false;
    renderHook(() => usePresenceBeacon());
    await new Promise(r => setTimeout(r, 20));
    expect(mockReportDrPresence).not.toHaveBeenCalled();
  });
});
