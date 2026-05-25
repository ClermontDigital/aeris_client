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
  Linking,
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
import {useHaptics} from '../hooks/useHaptics';
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
  // Delete-account confirmation: the user must type a phrase before the
  // destructive action enables. Resets every time the user re-opens
  // Settings so it's never primed by a previous session.
  const [deleteConfirm, setDeleteConfirm] = useState('');

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
    setDeleteConfirm('');
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

  // Delete-account guard: typed confirmation must match (case-insensitive,
  // trimmed). DELETE is a one-word phrase any English keyboard can type
  // without autocomplete fights; we trim because mobile keyboards love to
  // append a trailing space.
  const deleteConfirmed = deleteConfirm.trim().toLowerCase() === 'delete';

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
            {/* Apple App Store Review Guideline 5.1.1(v) — apps that
                create accounts must offer in-app deletion. AERIS accounts
                are administrator-provisioned (not user-signed-up), so we
                route the request to the public account-deletion page
                rather than calling a self-serve delete RPC. The page
                collects the user's identifier and confirms with the
                workspace admin; this satisfies the "initiated from
                inside the app" requirement.
                Hardening: the button is disabled until the user types
                "DELETE" into the adjacent field. This stops accidental
                taps from anyone glancing through Settings — the action
                requires deliberate keyboard input, then a destructive
                Alert.alert confirmation, before the browser opens. */}
            <Text style={styles.deleteConfirmLabel}>
              <Text style={styles.deleteConfirmLabelStrong}>Note:</Text> this
              only removes the account from THIS device — it does not delete
              your AERIS account on the server. To permanently delete your
              account, type{' '}
              <Text style={styles.deleteConfirmLabelStrong}>DELETE</Text>{' '}
              below; a confirmation page will open in your browser and your
              workspace administrator will be notified to process the request.
            </Text>
            <TextInput
              style={styles.deleteConfirmInput}
              value={deleteConfirm}
              onChangeText={setDeleteConfirm}
              placeholder="Type DELETE to enable"
              placeholderTextColor={COLORS.inputPlaceholder}
              autoCapitalize="characters"
              autoCorrect={false}
            />
            <TouchableOpacity
              style={[
                styles.deleteAccountBtn,
                !deleteConfirmed && styles.deleteAccountBtnDisabled,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Delete account"
              accessibilityState={{disabled: !deleteConfirmed}}
              disabled={!deleteConfirmed}
              onPress={() => {
                haptics.light();
                Alert.alert(
                  'Delete account',
                  'AERIS accounts are managed by your workspace administrator. Opening the account deletion page in your browser — your admin will be notified to process the request.',
                  [
                    {text: 'Cancel', style: 'cancel'},
                    {
                      text: 'Continue',
                      style: 'destructive',
                      onPress: () => {
                        Linking.openURL(
                          'https://aeris.team/account/delete',
                        ).catch(() => {
                          Alert.alert(
                            'Could not open browser',
                            "Visit https://aeris.team/account/delete on any device to request account deletion, or contact your workspace administrator.",
                          );
                        });
                      },
                    },
                  ],
                );
              }}>
              <Text
                style={[
                  styles.deleteAccountText,
                  !deleteConfirmed && styles.deleteAccountTextDisabled,
                ]}>
                Delete account
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
  deleteConfirmLabelStrong: {
    color: COLORS.destructive,
    fontFamily: FONT_FAMILY.semibold,
  },
  deleteConfirmInput: {
    marginTop: SPACING.xs,
    borderWidth: 1,
    borderColor: COLORS.inputBorder,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    fontSize: FONT_SIZE.md,
    color: COLORS.text,
    backgroundColor: COLORS.inputBg,
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
