// M3-C — attemptSilentReauth: success (reauthed), fallback-to-prompt on a
// failed silent login, and no-cred when the flag is off / nothing cached.
//
// Names referenced inside jest.mock() factories are prefixed `mock` so Jest's
// hoisting allowlist permits them (factories are hoisted above imports).

interface SettingsMock {
  settings: {autoFailoverEnabled?: boolean; workspaceCode?: string | null};
}
const mockSettings: SettingsMock = {
  settings: {autoFailoverEnabled: true, workspaceCode: 'shop-a'},
};

const mockLogin = jest.fn(() => Promise.resolve());
const mockSetAuthState = jest.fn();
const mockLoad = jest.fn();

jest.mock('../../stores/settingsStore', () => ({
  useSettingsStore: {getState: () => ({settings: mockSettings.settings})},
}));
jest.mock('../../stores/authStore', () => ({
  useAuthStore: {
    getState: () => ({login: mockLogin}),
    setState: (...a: unknown[]) => mockSetAuthState(...a),
  },
}));
jest.mock('../SilentReauthCredentialStore', () => ({
  SilentReauthCredentialStore: {
    load: (...a: unknown[]) => mockLoad(...a),
  },
}));
// ApiClient is imported by silentReauth (unused on these paths) — stub it so no
// native deps load.
jest.mock('../ApiClient', () => ({__esModule: true, default: {}}));

import {attemptSilentReauth} from '../silentReauth';

beforeEach(() => {
  mockSettings.settings = {autoFailoverEnabled: true, workspaceCode: 'shop-a'};
  mockLogin.mockReset().mockResolvedValue(undefined);
  mockSetAuthState.mockReset();
  mockLoad.mockReset();
});

describe('attemptSilentReauth', () => {
  it('success → re-auths and returns "reauthed"', async () => {
    mockLoad.mockResolvedValue({
      workspaceCode: 'shop-a',
      email: 'u@x.com',
      password: 'pw',
    });
    const r = await attemptSilentReauth();
    expect(mockLogin).toHaveBeenCalledWith('u@x.com', 'pw');
    expect(r.outcome).toBe('reauthed');
    // clears the stale "sign in again" banner on success.
    expect(mockSetAuthState).toHaveBeenCalledWith({error: null, errorKind: null});
  });

  it('login fails → returns "failed" (fall back to manual prompt)', async () => {
    mockLoad.mockResolvedValue({
      workspaceCode: 'shop-a',
      email: 'u@x.com',
      password: 'badpw',
    });
    mockLogin.mockRejectedValue(new Error('Invalid credentials'));
    const r = await attemptSilentReauth();
    expect(r.outcome).toBe('failed');
    // Does NOT clear the banner — the manual login screen stands.
    expect(mockSetAuthState).not.toHaveBeenCalled();
  });

  it('no cached credential (flag off / none) → "no-cred", never calls login', async () => {
    mockLoad.mockResolvedValue(null);
    const r = await attemptSilentReauth();
    expect(r.outcome).toBe('no-cred');
    expect(mockLogin).not.toHaveBeenCalled();
  });

  it('passes the live flag + workspace into the credential load gate', async () => {
    mockSettings.settings = {autoFailoverEnabled: false, workspaceCode: 'shop-z'};
    mockLoad.mockResolvedValue(null);
    await attemptSilentReauth();
    expect(mockLoad).toHaveBeenCalledWith(false, 'shop-z');
  });
});
