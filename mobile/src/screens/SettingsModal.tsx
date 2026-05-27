import React, {useState, useEffect, useCallback} from 'react';
import {
  View,
  Text,
  TextInput,
  Switch,
  TouchableOpacity,
  StyleSheet,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import Modal from 'react-native-modal';
import {SafeAreaView} from 'react-native-safe-area-context';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {useSettings} from '../hooks/useSettings';
import {useAuthStore} from '../stores/authStore';
import {useAppLockStore} from '../stores/appLockStore';
import {useProductCacheStore} from '../stores/productCacheStore';
import {useHaptics} from '../hooks/useHaptics';
import SessionManager from '../services/SessionManager';
import EyebrowLabel from '../components/EyebrowLabel';
import Icon from '../components/Icon';
import {COLORS, FONT_FAMILY, FONT_SIZE, SPACING} from '../constants/theme';
import type {ConnectionMode} from '../types/api.types';
import type {AppStackParamList} from '../types/navigation.types';

// ---------------------------------------------------------------------------
// SettingsBody — the actual form. Shared by:
//   • SettingsModal (default export) — used by LoginScreen, ERPScreen,
//     MainScreen which still pass {visible, onClose} and expect a modal
//     overlay.
//   • SettingsScreen (named export) — pushed by the AppStack as a real
//     page from the gear icon in AppTabs.
// The body knows how to close itself (commit + bubble) via the `onCommit`
// and `onCancel` callbacks; whoever embeds it decides whether closing
// means dismissing a Modal or popping a Stack screen.
// ---------------------------------------------------------------------------

interface SettingsBodyProps {
  /** Called after a successful Save (form is persisted). */
  onCommit: () => void;
  /** Called when the user backs out without committing pending edits. */
  onCancel: () => void;
  /** Page mode renders no inline Save button (the page header owns it);
   *  modal mode keeps the legacy bottom Cancel/Save button row. */
  variant: 'page' | 'modal';
  /** Bump to force a re-sync of local form state from persisted settings.
   *  Modal callers pass their `visible` prop; the page caller can omit
   *  it since the body mounts fresh on navigation. */
  resetKey?: unknown;
  /** Page variant only — fires whenever the internal save handler is
   *  (re)created so the page header's Save button can invoke it.
   *  Receives the latest closure capturing current form state. */
  onSaveHandlerReady?: (save: () => void) => void;
}

const SettingsBody: React.FC<SettingsBodyProps> = ({
  onCommit,
  onCancel,
  variant,
  resetKey,
  onSaveHandlerReady,
}) => {
  const {settings, saveSettings, testConnection} = useSettings();
  const haptics = useHaptics();
  const isAuthenticated = useAuthStore(s => s.isAuthenticated);
  const clearLocalSession = useAuthStore(s => s.clearLocalSession);
  const hasPin = useAppLockStore(s => s.hasPin);
  const lockBiometricEnabled = useAppLockStore(s => s.biometricEnabled);
  const lockBiometricAvailable = useAppLockStore(s => s.biometricAvailable);
  const setLockBiometricEnabled = useAppLockStore(s => s.setBiometricEnabled);
  const resetAppLock = useAppLockStore(s => s.reset);
  const [baseUrl, setBaseUrl] = useState(settings.baseUrl);
  const [relayUrl, setRelayUrl] = useState(settings.relayUrl ?? '');
  const [mode, setMode] = useState<ConnectionMode>(
    settings.connectionMode ?? 'direct',
  );
  const [sessionTimeout, setSessionTimeout] = useState(settings.sessionTimeout);
  const [enableSessions, setEnableSessions] = useState(settings.enableSessionManagement);
  const [hapticsEnabled, setHapticsEnabled] = useState(
    settings.hapticsEnabled !== false,
  );
  // "Remove account from this device" guard: track which clear is in
  // flight so the button can disable + spinner while we sequence the
  // logout → PIN/biometric wipe → product-cache wipe.
  const [isRemoving, setIsRemoving] = useState(false);

  useEffect(() => {
    // Sync local form state when the surface opens (modal becomes visible
    // or page focuses) or persisted settings change. Subscribing to
    // individual fields (rather than the whole settings object) avoids
    // re-syncing whenever an unrelated setting is updated elsewhere.
    setBaseUrl(settings.baseUrl);
    setRelayUrl(settings.relayUrl ?? '');
    setMode(settings.connectionMode ?? 'direct');
    setSessionTimeout(settings.sessionTimeout);
    setEnableSessions(settings.enableSessionManagement);
    setHapticsEnabled(settings.hapticsEnabled !== false);
  }, [
    settings.baseUrl,
    settings.relayUrl,
    settings.connectionMode,
    settings.sessionTimeout,
    settings.enableSessionManagement,
    settings.hapticsEnabled,
    resetKey,
  ]);

  const ensureProtocol = (url: string): string => {
    const trimmed = url.trim();
    if (trimmed && !/^https?:\/\//i.test(trimmed)) {
      return `http://${trimmed}`;
    }
    return trimmed;
  };

  const validateUrl = (url: string, label: string): boolean => {
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        Alert.alert('Invalid URL', `${label} must use http:// or https://`);
        return false;
      }
      return true;
    } catch {
      Alert.alert('Invalid URL', `Please enter a valid ${label.toLowerCase()}.`);
      return false;
    }
  };

  const handleSave = useCallback(async () => {
    haptics.selection();
    const fullBaseUrl = ensureProtocol(baseUrl);
    if (mode === 'direct' && !validateUrl(fullBaseUrl, 'Server URL')) return;

    const trimmedRelay = relayUrl.trim();
    if (mode === 'relay') {
      if (!trimmedRelay) {
        Alert.alert('Relay URL required', 'Enter the relay URL to use relay mode.');
        return;
      }
      if (!validateUrl(trimmedRelay, 'Relay URL')) return;
    }

    // If the user is authenticated and switching connection mode, the
    // in-memory bearer was issued under the old mode's audience (direct =
    // ERP token, relay = Sanctum token via deployment). Forwarding it to
    // the new edge would leak a credential to the wrong audience. Wipe
    // local session before saving so the user must re-login under the new
    // mode. Gate on isAuthenticated to avoid showing "Your session has
    // expired" pre-login when the user is just configuring their setup.
    const modeChanged = mode !== (settings.connectionMode ?? 'direct');
    if (modeChanged && isAuthenticated) {
      try {
        await clearLocalSession();
      } catch (cbErr) {
        // SecureStorage failures shouldn't block the mode change — the
        // in-memory state is wiped synchronously inside clearLocalSession
        // before the persistence await, so we're already in a safe state.
        console.warn('Failed to clear persisted session on mode change:', cbErr);
      }
      // clearLocalSession sets a generic "session expired" error; replace
      // with mode-specific copy so the user understands why they were
      // logged out.
      useAuthStore.setState({
        error: 'Connection mode changed. Please log in again.',
      });
    }

    setBaseUrl(fullBaseUrl);
    await saveSettings({
      baseUrl: fullBaseUrl,
      relayUrl: trimmedRelay || undefined,
      connectionMode: mode,
      sessionTimeout,
      enableSessionManagement: enableSessions,
      hapticsEnabled,
    });
    onCommit();
  }, [
    haptics,
    baseUrl,
    relayUrl,
    mode,
    settings.connectionMode,
    isAuthenticated,
    clearLocalSession,
    saveSettings,
    sessionTimeout,
    enableSessions,
    hapticsEnabled,
    onCommit,
  ]);

  // Page variant: publish the freshest save closure to the parent so
  // the page header's Save button always fires the current form state.
  // Effect re-runs whenever handleSave changes (i.e. whenever any
  // captured field changes), so the header tap never operates on stale
  // data.
  useEffect(() => {
    if (onSaveHandlerReady) {
      onSaveHandlerReady(handleSave);
    }
  }, [onSaveHandlerReady, handleSave]);

  const handleLogout = () => {
    haptics.light();
    Alert.alert('Log out', 'Are you sure you want to log out?', [
      {text: 'Cancel', style: 'cancel'},
      {
        text: 'Log out',
        style: 'destructive',
        onPress: async () => {
          onCancel();
          await useAuthStore.getState().logout();
        },
      },
    ]);
  };

  const handleTest = async () => {
    if (mode === 'relay') {
      const trimmedRelay = relayUrl.trim();
      if (!trimmedRelay || !validateUrl(trimmedRelay, 'Relay URL')) return;
      const ok = await testConnection(trimmedRelay);
      Alert.alert(
        ok ? 'Success' : 'Failed',
        ok ? 'Relay is reachable.' : 'Cannot reach relay.',
      );
      return;
    }
    const fullUrl = ensureProtocol(baseUrl);
    setBaseUrl(fullUrl);
    const ok = await testConnection(fullUrl);
    Alert.alert(
      ok ? 'Success' : 'Failed',
      ok ? 'Server is reachable.' : 'Cannot reach server.',
    );
  };

  // Wires the three resets the "Remove account from this device" flow
  // needs to run in sequence. Pulled outside the JSX so the handler
  // stays readable. authStore.logout already clears tokens + cookies +
  // secure storage; appLockStore.reset clears PIN + biometric pref via
  // AppLockService; productCacheStore.reset wipes the persisted
  // workspace catalog so a re-login into a different workspace doesn't
  // surface the previous workspace's data in search / scan results.
  const productCacheReset = useProductCacheStore(s => s.reset);
  const performRemoveFromDevice = useCallback(async () => {
    setIsRemoving(true);
    try {
      await useAuthStore.getState().logout();
    } catch (e) {
      // logout() already swallows server failures; only an unexpected
      // throw in the local-wipe branch would land here.
      console.warn('Remove-from-device: logout step failed', e);
    }
    try {
      await resetAppLock();
    } catch (e) {
      console.warn('Remove-from-device: app-lock reset failed', e);
    }
    try {
      await productCacheReset();
    } catch (e) {
      console.warn('Remove-from-device: product cache reset failed', e);
    }
    try {
      // Per-cashier named sessions + their PIN-attempt counters live in
      // their own AsyncStorage keys via SessionManager. Wipe them too so
      // a re-provisioned device doesn't surface a previous operator's
      // cashier name or locked PIN-attempt state.
      SessionManager.cleanup();
    } catch (e) {
      console.warn('Remove-from-device: session manager cleanup failed', e);
    }
    setIsRemoving(false);
    // The auth state flip in logout() drops the user back to LoginScreen
    // via the RootNavigator gate — no manual navigate needed.
  }, [resetAppLock, productCacheReset]);

  return (
    <KeyboardAvoidingView
      style={variant === 'page' ? styles.pageFlex : undefined}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentContainerStyle={
          variant === 'page' ? styles.pageContent : styles.modalContent
        }
        keyboardShouldPersistTaps="handled">
        {variant === 'modal' ? <Text style={styles.title}>Settings</Text> : null}

        {/* Connection — card 1 */}
        <View style={styles.section}>
          <EyebrowLabel>Connection</EyebrowLabel>
          <View style={styles.modeRow}>
            <TouchableOpacity
              style={[styles.modeBtn, mode === 'direct' && styles.modeBtnActive]}
              onPress={() => setMode('direct')}>
              <Text
                style={[
                  styles.modeText,
                  mode === 'direct' && styles.modeTextActive,
                ]}>
                Direct
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modeBtn, mode === 'relay' && styles.modeBtnActive]}
              onPress={() => setMode('relay')}>
              <Text
                style={[
                  styles.modeText,
                  mode === 'relay' && styles.modeTextActive,
                ]}>
                Relay
              </Text>
            </TouchableOpacity>
          </View>

          {mode === 'direct' ? (
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Server URL</Text>
              <View style={styles.urlRow}>
                <TextInput
                  style={styles.input}
                  value={baseUrl}
                  onChangeText={setBaseUrl}
                  placeholder="http://aeris.local:8000"
                  placeholderTextColor={COLORS.inputPlaceholder}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <TouchableOpacity style={styles.testBtn} onPress={handleTest}>
                  <Text style={styles.testText}>Test</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Relay URL</Text>
              <View style={styles.urlRow}>
                <TextInput
                  style={styles.input}
                  value={relayUrl}
                  onChangeText={setRelayUrl}
                  placeholder="https://api.aeris.team"
                  placeholderTextColor={COLORS.inputPlaceholder}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <TouchableOpacity style={styles.testBtn} onPress={handleTest}>
                  <Text style={styles.testText}>Test</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>

        {/* Preferences — card 2 */}
        <View style={styles.section}>
          <EyebrowLabel>Preferences</EyebrowLabel>
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>
              Session timeout · {sessionTimeout} min
            </Text>
            <TextInput
              style={styles.input}
              value={String(sessionTimeout)}
              onChangeText={t => {
                const n = parseInt(t, 10);
                if (!isNaN(n) && n >= 5 && n <= 120) setSessionTimeout(n);
              }}
              keyboardType="numeric"
              placeholderTextColor={COLORS.inputPlaceholder}
            />
          </View>
          <View style={styles.switchRow}>
            <Text style={styles.switchLabel}>Session management</Text>
            <Switch value={enableSessions} onValueChange={setEnableSessions} />
          </View>
          <View style={styles.switchRow}>
            <Text style={styles.switchLabel}>Haptic feedback</Text>
            <Switch value={hapticsEnabled} onValueChange={setHapticsEnabled} />
          </View>
        </View>

        {/* App lock — card 3, only when relevant */}
        {isAuthenticated && hasPin ? (
          <View style={styles.section}>
            <EyebrowLabel>App lock</EyebrowLabel>
            {lockBiometricAvailable ? (
              <View style={styles.switchRow}>
                <Text style={styles.switchLabel}>Unlock with biometrics</Text>
                <Switch
                  value={lockBiometricEnabled}
                  onValueChange={async v => {
                    haptics.selection();
                    await setLockBiometricEnabled(v);
                  }}
                />
              </View>
            ) : null}
            <TouchableOpacity
              style={styles.resetPinBtn}
              onPress={() => {
                haptics.light();
                Alert.alert(
                  'Reset PIN',
                  'You will be asked to set a new PIN the next time you unlock the app.',
                  [
                    {text: 'Cancel', style: 'cancel'},
                    {
                      text: 'Reset',
                      style: 'destructive',
                      onPress: async () => {
                        await resetAppLock();
                        onCancel();
                      },
                    },
                  ],
                );
              }}>
              <Text style={styles.resetPinText}>Reset PIN</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {/* Modal variant keeps the legacy bottom action row so embedded
            callers (LoginScreen / ERPScreen / MainScreen) don't lose their
            primary CTA. Page variant doesn't render these because the
            header has its own Back + Save chrome. */}
        {variant === 'modal' ? (
          <View style={styles.buttons}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onCancel}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.saveBtn} onPress={handleSave}>
              <Text style={styles.saveText}>Save</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {/* Danger zone — pushed to the bottom and visually de-emphasised so
            destructive actions aren't fat-fingered. The Log out / Delete
            account buttons used to sit immediately above the save row
            (and "Log out" rendered as the primary crimson CTA), which made
            it easy to brush them on a small device. They now live below
            a clear divider with smaller secondary styling. */}
        {isAuthenticated ? (
          <View style={styles.dangerZone}>
            <EyebrowLabel textStyle={styles.dangerEyebrow}>Danger zone</EyebrowLabel>
            <Text style={styles.dangerHelp}>
              These actions affect your account or session. Each one prompts
              for confirmation before anything is changed.
            </Text>
            <TouchableOpacity
              style={styles.logoutBtn}
              accessibilityRole="button"
              accessibilityLabel="Log out of this device"
              onPress={handleLogout}>
              <Text style={styles.logoutText}>Log out</Text>
            </TouchableOpacity>
            {/* "Remove account from this device" is a device-scoped wipe
                only — it logs out, clears the PIN + biometric prefs, and
                drops the workspace catalog cache. It does NOT delete the
                AERIS account itself; that lives on the workspace
                deployment and can only be removed by the workspace
                administrator. Apple App Store Review Guideline 5.1.1(v)
                requires in-app account deletion only when accounts can
                be self-registered in-app, which AERIS accounts cannot —
                they're administrator-provisioned. Reviewer notes in the
                submission should call this out so the device-scoped
                copy isn't mistaken for a half-implemented delete. */}
            <Text style={styles.deleteConfirmLabel}>
              Removes your sign-in, PIN, biometric, named cashier
              sessions, and cached workspace data from this device only.
              Device settings (connection mode, relay URL) stay so the
              device can be re-provisioned for the same workspace. Your
              AERIS account itself stays live — only your workspace
              administrator can permanently delete it.
            </Text>
            <TouchableOpacity
              style={[
                styles.deleteAccountBtn,
                isRemoving && styles.deleteAccountBtnDisabled,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Remove account from this device"
              accessibilityState={{disabled: isRemoving, busy: isRemoving}}
              disabled={isRemoving}
              onPress={() => {
                haptics.light();
                Alert.alert(
                  'Remove account from this device',
                  'You\'ll be signed out, your PIN and biometric will be cleared, and the workspace catalog cache will be wiped. Your account on the AERIS workspace is unaffected.',
                  [
                    {text: 'Cancel', style: 'cancel'},
                    {
                      text: 'Remove',
                      style: 'destructive',
                      onPress: () => {
                        void performRemoveFromDevice();
                      },
                    },
                  ],
                );
              }}>
              <Text
                style={[
                  styles.deleteAccountText,
                  isRemoving && styles.deleteAccountTextDisabled,
                ]}>
                {isRemoving ? 'Removing…' : 'Remove account from this device'}
              </Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

// ---------------------------------------------------------------------------
// SettingsScreen — page-style variant pushed by AppStack from the gear
// icon. Owns its own header (back chevron + title + save), so the Stack
// is configured with `headerShown: false`. Back / save both pop the
// screen; save commits first.
// ---------------------------------------------------------------------------

type SettingsNav = NativeStackNavigationProp<AppStackParamList, 'Settings'>;

export const SettingsScreen: React.FC = () => {
  const navigation = useNavigation<SettingsNav>();
  const haptics = useHaptics();
  // The Save button lives in the page header, outside SettingsBody. The
  // body publishes its latest save closure into this ref via the
  // onSaveHandlerReady callback (fires on every change to captured form
  // state), so the header's tap always commits the freshest values.
  const saveRef = React.useRef<(() => void) | null>(null);

  const handleBack = useCallback(() => {
    haptics.light();
    navigation.goBack();
  }, [haptics, navigation]);

  const handleSavePress = useCallback(() => {
    saveRef.current?.();
  }, []);

  // Stable callback so SettingsBody's effect doesn't re-fire and republish
  // an identical reference on every render.
  const publishSave = useCallback((save: () => void) => {
    saveRef.current = save;
  }, []);

  const handleCommit = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  return (
    <SafeAreaView edges={['top']} style={styles.pageRoot}>
      <View style={styles.pageHeader}>
        <TouchableOpacity
          onPress={handleBack}
          accessibilityRole="button"
          accessibilityLabel="Back"
          style={styles.pageHeaderBtn}
          hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}>
          <Icon name="chevron-back" size={24} color={COLORS.navy} />
        </TouchableOpacity>
        <Text style={styles.pageHeaderTitle}>Settings</Text>
        <TouchableOpacity
          onPress={handleSavePress}
          accessibilityRole="button"
          accessibilityLabel="Save settings"
          style={styles.pageHeaderSaveBtn}
          hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}>
          <Text style={styles.pageHeaderSaveText}>Save</Text>
        </TouchableOpacity>
      </View>
      <SettingsBody
        variant="page"
        onCommit={handleCommit}
        onCancel={handleCommit}
        onSaveHandlerReady={publishSave}
      />
    </SafeAreaView>
  );
};

// ---------------------------------------------------------------------------
// SettingsModal — legacy default export. Used by LoginScreen, ERPScreen,
// MainScreen which I cannot edit. Keeps the {visible, onClose} contract.
// ---------------------------------------------------------------------------

interface Props {
  visible: boolean;
  onClose: () => void;
}

const SettingsModal: React.FC<Props> = ({visible, onClose}) => {
  return (
    <Modal
      isVisible={visible}
      onBackdropPress={onClose}
      onBackButtonPress={onClose}
      style={styles.modal}>
      <View style={styles.modalSurface}>
        <SettingsBody
          variant="modal"
          onCommit={onClose}
          onCancel={onClose}
          resetKey={visible}
        />
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modal: {justifyContent: 'center', margin: 40},
  modalSurface: {backgroundColor: COLORS.surface, borderRadius: 12, maxHeight: '90%'},
  modalContent: {padding: 24},
  pageFlex: {flex: 1},
  pageRoot: {flex: 1, backgroundColor: COLORS.background},
  pageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.surfaceBorder,
    backgroundColor: COLORS.background,
  },
  pageHeaderBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pageHeaderTitle: {
    flex: 1,
    textAlign: 'center',
    fontFamily: FONT_FAMILY.semibold,
    fontSize: FONT_SIZE.lg,
    color: COLORS.navy,
  },
  pageHeaderSaveBtn: {
    minWidth: 56,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACING.sm,
  },
  pageHeaderSaveText: {
    color: COLORS.crimson,
    fontFamily: FONT_FAMILY.semibold,
    fontSize: FONT_SIZE.lg,
  },
  pageContent: {padding: SPACING.md, paddingBottom: SPACING.xxl},
  title: {fontSize: 22, fontFamily: FONT_FAMILY.bold, color: COLORS.navy, marginBottom: 20},
  // Card container for each settings section — white surface on the cream
  // page bg so groupings read as deliberate UI cards instead of a single
  // monotone beige sheet. Matches the visual treatment used by Product /
  // Customer detail and edit forms.
  section: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.surfaceBorder,
    borderRadius: 12,
    padding: SPACING.md,
    marginBottom: SPACING.md,
  },
  field: {marginTop: SPACING.sm + 4},
  fieldLabel: {
    fontSize: 13,
    color: COLORS.textMuted,
    fontFamily: FONT_FAMILY.medium,
    marginBottom: SPACING.xs,
  },
  switchLabel: {
    fontSize: 15,
    color: COLORS.text,
    fontFamily: FONT_FAMILY.medium,
  },
  // Modal-only inline label kept for the legacy variant (LoginScreen,
  // ERPScreen) which still inlines the form without cards.
  label: {fontSize: 14, color: COLORS.textMuted, marginTop: 12, marginBottom: 4},
  input: {
    borderWidth: 1,
    borderColor: COLORS.inputBorder,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'ios' ? 12 : 8,
    fontSize: 15,
    minHeight: 44,
    flex: 1,
    color: COLORS.text,
    backgroundColor: COLORS.inputBg,
  },
  urlRow: {flexDirection: 'row', gap: 8, alignItems: 'center'},
  testBtn: {backgroundColor: COLORS.navy, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 8},
  testText: {color: COLORS.cream, fontFamily: FONT_FAMILY.medium},
  modeRow: {flexDirection: 'row', gap: 8, marginTop: 4},
  modeBtn: {
    flex: 1,
    minHeight: 44,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.inputBorder,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.inputBg, // matches the input fields
  },
  modeBtnActive: {
    backgroundColor: COLORS.navy,
    borderColor: COLORS.navy,
  },
  modeText: {color: COLORS.textMuted, fontFamily: FONT_FAMILY.medium},
  modeTextActive: {color: COLORS.cream},
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: 44,
    marginTop: SPACING.sm,
    paddingVertical: SPACING.xs,
  },
  buttons: {flexDirection: 'row', justifyContent: 'flex-end', gap: 12, marginTop: 24},
  cancelBtn: {paddingHorizontal: 16, paddingVertical: 10},
  cancelText: {color: COLORS.textMuted, fontSize: 16},
  saveBtn: {backgroundColor: COLORS.crimson, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8},
  saveText: {color: COLORS.white, fontSize: 16, fontFamily: FONT_FAMILY.medium},
  // Danger zone — secondary visual weight, pushed to the bottom under a
  // visible divider + eyebrow label. Buttons keep a 44pt minHeight for
  // accessibility but use smaller text + outline styling rather than
  // the primary-CTA crimson fill that used to dominate the top of the
  // form. Intent: the user has to scroll to find these and read the
  // header before they can act, which dramatically reduces accidental
  // sign-outs.
  // Danger zone wraps in the same white-card pattern as other sections
  // but sits below an extra top margin to visually separate "settings I
  // tweak often" from "actions I should think twice about".
  dangerZone: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.destructive + '33',
    borderRadius: 12,
    padding: SPACING.md,
    marginTop: SPACING.xl,
    marginBottom: SPACING.md,
  },
  dangerEyebrow: {color: COLORS.destructive},
  dangerHelp: {
    color: COLORS.textMuted,
    fontFamily: FONT_FAMILY.regular,
    fontSize: FONT_SIZE.sm,
    marginTop: SPACING.xs,
    marginBottom: SPACING.md,
    lineHeight: 18,
  },
  logoutBtn: {
    minHeight: 44,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: COLORS.inputBorder,
    backgroundColor: COLORS.surface,
  },
  logoutText: {
    color: COLORS.navy,
    fontSize: FONT_SIZE.md,
    fontFamily: FONT_FAMILY.medium,
  },
  deleteConfirmLabel: {
    marginTop: SPACING.lg,
    color: COLORS.textMuted,
    fontFamily: FONT_FAMILY.regular,
    fontSize: FONT_SIZE.sm,
    lineHeight: 18,
  },
  deleteAccountBtn: {
    marginTop: SPACING.sm,
    minHeight: 44,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: COLORS.destructive,
    backgroundColor: 'transparent',
  },
  deleteAccountBtnDisabled: {
    borderColor: COLORS.inputBorder,
    backgroundColor: 'transparent',
  },
  // Royal Red per Brand Guidelines v0.3 §10 — destructive/irreversible actions.
  deleteAccountText: {color: COLORS.destructive, fontSize: FONT_SIZE.md, fontFamily: FONT_FAMILY.semibold},
  deleteAccountTextDisabled: {color: COLORS.inputPlaceholder},
  // lockSection is now wrapped in `styles.section` at the call site, but
  // retained for any legacy refs.
  lockSection: {marginTop: 0},
  resetPinBtn: {
    marginTop: 12,
    paddingVertical: 10,
    alignSelf: 'flex-start',
  },
  resetPinText: {
    color: COLORS.crimson,
    fontSize: 15,
    fontFamily: FONT_FAMILY.medium,
  },
});

export default SettingsModal;
