// The global jest.setup.ts already mocks expo-secure-store with per-file
// jest.fn() instances backed by a shared in-memory store. Grab those fns
// via `require` after the mock is installed rather than defining a local
// factory (which would either collide with the global mock or be discarded
// by jest-expo's setup order).
import * as SecureStore from 'expo-secure-store';
import {useWorkspaceFeaturesStore} from '../workspaceFeaturesStore';

const setItemAsyncSpy = SecureStore.setItemAsync as jest.Mock;
const getItemAsyncSpy = SecureStore.getItemAsync as jest.Mock;
const deleteItemAsyncSpy = SecureStore.deleteItemAsync as jest.Mock;

const WORKSPACE_FEATURES_KEY = 'aeris.workspace.features';

function resetStore() {
  useWorkspaceFeaturesStore.setState({repairs_enabled: false});
}

// Persistence is fire-and-forget; flush the microtask queue so the promise
// chain inside `persist(...)` has a chance to invoke setItemAsync before
// the assertion runs.
const flush = () => new Promise(r => setImmediate(r));

describe('workspaceFeaturesStore', () => {
  beforeEach(() => {
    setItemAsyncSpy.mockClear();
    getItemAsyncSpy.mockClear();
    deleteItemAsyncSpy.mockClear();
    resetStore();
  });

  describe('hydrateFromLogin', () => {
    it('present true → repairs_enabled true', () => {
      useWorkspaceFeaturesStore.getState().hydrateFromLogin({
        workspace: {features: {repairs_enabled: true}},
      });
      expect(useWorkspaceFeaturesStore.getState().repairs_enabled).toBe(true);
    });

    it('present false → repairs_enabled false', () => {
      // Prime the store true so a genuine flip is observable.
      useWorkspaceFeaturesStore.setState({repairs_enabled: true});
      useWorkspaceFeaturesStore.getState().hydrateFromLogin({
        workspace: {features: {repairs_enabled: false}},
      });
      expect(useWorkspaceFeaturesStore.getState().repairs_enabled).toBe(false);
    });

    it('absent workspace key → repairs_enabled false', () => {
      useWorkspaceFeaturesStore.setState({repairs_enabled: true});
      useWorkspaceFeaturesStore.getState().hydrateFromLogin({
        access_token: 'x',
        user: {id: 1, email: 'a@b.c'},
      });
      expect(useWorkspaceFeaturesStore.getState().repairs_enabled).toBe(false);
    });

    it('malformed workspace (string "yes") → repairs_enabled false', () => {
      useWorkspaceFeaturesStore.setState({repairs_enabled: true});
      useWorkspaceFeaturesStore.getState().hydrateFromLogin({workspace: 'yes'});
      expect(useWorkspaceFeaturesStore.getState().repairs_enabled).toBe(false);
    });

    it('malformed workspace (null) → repairs_enabled false', () => {
      useWorkspaceFeaturesStore.setState({repairs_enabled: true});
      useWorkspaceFeaturesStore.getState().hydrateFromLogin({workspace: null});
      expect(useWorkspaceFeaturesStore.getState().repairs_enabled).toBe(false);
    });

    it('malformed workspace (123) → repairs_enabled false', () => {
      useWorkspaceFeaturesStore.setState({repairs_enabled: true});
      useWorkspaceFeaturesStore.getState().hydrateFromLogin({workspace: 123});
      expect(useWorkspaceFeaturesStore.getState().repairs_enabled).toBe(false);
    });

    it('workspace present but features absent → repairs_enabled false', () => {
      useWorkspaceFeaturesStore.setState({repairs_enabled: true});
      useWorkspaceFeaturesStore.getState().hydrateFromLogin({workspace: {}});
      expect(useWorkspaceFeaturesStore.getState().repairs_enabled).toBe(false);
    });

    it('workspace present but features not an object → repairs_enabled false', () => {
      useWorkspaceFeaturesStore.setState({repairs_enabled: true});
      useWorkspaceFeaturesStore.getState().hydrateFromLogin({
        workspace: {features: 'yes'},
      });
      expect(useWorkspaceFeaturesStore.getState().repairs_enabled).toBe(false);
    });

    it('features.repairs_enabled non-boolean → coerces to false', () => {
      useWorkspaceFeaturesStore.setState({repairs_enabled: true});
      useWorkspaceFeaturesStore.getState().hydrateFromLogin({
        workspace: {features: {repairs_enabled: 'yes'}},
      });
      expect(useWorkspaceFeaturesStore.getState().repairs_enabled).toBe(false);
    });
  });

  describe('setRepairsEnabled', () => {
    it('setRepairsEnabled(true) → store flips', () => {
      useWorkspaceFeaturesStore.getState().setRepairsEnabled(true);
      expect(useWorkspaceFeaturesStore.getState().repairs_enabled).toBe(true);
    });

    it('setRepairsEnabled(false) → store returns to false', () => {
      useWorkspaceFeaturesStore.setState({repairs_enabled: true});
      useWorkspaceFeaturesStore.getState().setRepairsEnabled(false);
      expect(useWorkspaceFeaturesStore.getState().repairs_enabled).toBe(false);
    });
  });

  describe('reset', () => {
    it('reset() → back to false', () => {
      useWorkspaceFeaturesStore.setState({repairs_enabled: true});
      useWorkspaceFeaturesStore.getState().reset();
      expect(useWorkspaceFeaturesStore.getState().repairs_enabled).toBe(false);
    });
  });

  describe('SecureStorage.setItem persistence', () => {
    it('hydrateFromLogin persists to SecureStorage with the correct key', async () => {
      useWorkspaceFeaturesStore.getState().hydrateFromLogin({
        workspace: {features: {repairs_enabled: true}},
      });
      await flush();
      expect(setItemAsyncSpy).toHaveBeenCalledWith(
        WORKSPACE_FEATURES_KEY,
        JSON.stringify({repairs_enabled: true}),
        expect.any(Object),
      );
    });

    it('setRepairsEnabled(true) persists to SecureStorage', async () => {
      useWorkspaceFeaturesStore.getState().setRepairsEnabled(true);
      await flush();
      expect(setItemAsyncSpy).toHaveBeenCalledWith(
        WORKSPACE_FEATURES_KEY,
        JSON.stringify({repairs_enabled: true}),
        expect.any(Object),
      );
    });

    it('setRepairsEnabled(false) persists the false value', async () => {
      useWorkspaceFeaturesStore.getState().setRepairsEnabled(false);
      await flush();
      expect(setItemAsyncSpy).toHaveBeenCalledWith(
        WORKSPACE_FEATURES_KEY,
        JSON.stringify({repairs_enabled: false}),
        expect.any(Object),
      );
    });

    it('reset() removes the persisted entry (cross-user hygiene)', async () => {
      useWorkspaceFeaturesStore.setState({repairs_enabled: true});
      useWorkspaceFeaturesStore.getState().reset();
      await flush();
      // reset() removes the entry entirely rather than overwriting to false so
      // a stale parse can't reintroduce the flag before hydrateFromLogin runs
      // on the next login (SEC-2 cross-user residue guard).
      expect(deleteItemAsyncSpy).toHaveBeenCalledWith(
        WORKSPACE_FEATURES_KEY,
        expect.any(Object),
      );
      expect(useWorkspaceFeaturesStore.getState().repairs_enabled).toBe(false);
    });
  });

  // COV-3 — the warm-boot IIFE / hydrationPromise is the reason this store
  // exists at all (feature-flag gating at cold start). Tests use jest.isolateModules
  // so each case re-runs the module-load code path against a freshly primed
  // SecureStore mock.
  describe('warm-boot restore (hydrationPromise)', () => {
    beforeEach(() => {
      jest.resetModules();
      // Re-import SecureStore in the isolated module context and mimic the spy
      // setup for each case.
    });

    it('valid persisted {repairs_enabled: true} → store rehydrates to true', async () => {
      await jest.isolateModulesAsync(async () => {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const SS = require('expo-secure-store') as {
          getItemAsync: jest.Mock;
        };
        SS.getItemAsync.mockResolvedValueOnce(
          JSON.stringify({repairs_enabled: true}),
        );
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const mod = require('../workspaceFeaturesStore');
        await mod.hydrationPromise;
        expect(mod.useWorkspaceFeaturesStore.getState().repairs_enabled).toBe(true);
      });
    });

    it('invalid JSON payload → default false, no throw', async () => {
      await jest.isolateModulesAsync(async () => {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const SS = require('expo-secure-store') as {getItemAsync: jest.Mock};
        SS.getItemAsync.mockResolvedValueOnce('not-json');
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const mod = require('../workspaceFeaturesStore');
        await expect(mod.hydrationPromise).resolves.toBeUndefined();
        expect(mod.useWorkspaceFeaturesStore.getState().repairs_enabled).toBe(false);
      });
    });

    it('non-object parsed payload (null) → default false', async () => {
      await jest.isolateModulesAsync(async () => {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const SS = require('expo-secure-store') as {getItemAsync: jest.Mock};
        SS.getItemAsync.mockResolvedValueOnce('null');
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const mod = require('../workspaceFeaturesStore');
        await mod.hydrationPromise;
        expect(mod.useWorkspaceFeaturesStore.getState().repairs_enabled).toBe(false);
      });
    });

    it('SecureStore.getItemAsync rejection → default false, promise resolves', async () => {
      await jest.isolateModulesAsync(async () => {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const SS = require('expo-secure-store') as {getItemAsync: jest.Mock};
        SS.getItemAsync.mockRejectedValueOnce(new Error('keychain locked'));
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const mod = require('../workspaceFeaturesStore');
        await expect(mod.hydrationPromise).resolves.toBeUndefined();
        expect(mod.useWorkspaceFeaturesStore.getState().repairs_enabled).toBe(false);
      });
    });

    it('empty persisted value (never written) → default false', async () => {
      await jest.isolateModulesAsync(async () => {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const SS = require('expo-secure-store') as {getItemAsync: jest.Mock};
        SS.getItemAsync.mockResolvedValueOnce(null);
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const mod = require('../workspaceFeaturesStore');
        await mod.hydrationPromise;
        expect(mod.useWorkspaceFeaturesStore.getState().repairs_enabled).toBe(false);
      });
    });
  });
});
