import React, {useState, useCallback, useRef, useEffect} from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Image,
  Linking,
  ScrollView,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import Icon from '../components/Icon';
import {useAuthStore} from '../stores/authStore';
import {useSettingsStore} from '../stores/settingsStore';
import {useHaptics} from '../hooks/useHaptics';
import SettingsModal from './SettingsModal';
import {
  COLORS,
  SPACING,
  FONT_SIZE,
  FONT_FAMILY,
  BORDER_RADIUS,
  LETTER_SPACING,
} from '../constants/theme';
import {validateWorkspaceCode} from '../constants/config';
import MotionCard from '../components/MotionCard';
import PillButton from '../components/PillButton';

const LoginScreen: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [emailFocused, setEmailFocused] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);

  const haptics = useHaptics();
  const login = useAuthStore(s => s.login);
  const error = useAuthStore(s => s.error);
  const errorKind = useAuthStore(s => s.errorKind);
  const clearError = useAuthStore(s => s.clearError);
  // Local sign-in progress flag. Was previously bound to the global
  // authStore.isLoading, but that flag also gates RootNavigator's
  // "render null = splash" check — using it during an active login
  // attempt blanked the screen for the network round-trip and (on a
  // 401) showed a white page instead of the error banner. Local flag
  // gives us the button + input disabled UX without touching the
  // global splash gate.
  const [isSigningIn, setIsSigningIn] = useState(false);
  const connectionMode = useSettingsStore(s => s.settings.connectionMode);
  const persistedWorkspace = useSettingsStore(s => s.settings.workspaceCode);
  const persistedKeepSignedIn = useSettingsStore(
    s => s.settings.keepSignedIn ?? true,
  );
  const saveSettings = useSettingsStore(s => s.saveSettings);

  const [workspace, setWorkspace] = useState(persistedWorkspace ?? '');
  const [workspaceFocused, setWorkspaceFocused] = useState(false);
  const [workspaceTouched, setWorkspaceTouched] = useState(false);

  useEffect(() => {
    setWorkspace(persistedWorkspace ?? '');
  }, [persistedWorkspace]);

  // When the user lands on LoginScreen because their session expired, drop
  // them straight on the email field — they were already signed in once
  // this session, the workspace is persisted, so saving them a tap matches
  // the "the screen DID change, please re-auth" intent.
  useEffect(() => {
    if (errorKind === 'expired') {
      // Tiny delay so the focus call lands after the screen mounts.
      const t = setTimeout(() => emailRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
    return undefined;
    // Run once on mount when the condition holds — we deliberately don't
    // re-trigger on every errorKind change (e.g. invalid → cleared).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const persistWorkspace = useCallback(() => {
    const normalized = workspace.trim().toLowerCase();
    if (normalized !== (persistedWorkspace ?? '')) {
      saveSettings({workspaceCode: normalized});
    }
  }, [workspace, persistedWorkspace, saveSettings]);

  const workspaceError =
    connectionMode === 'relay' && workspaceTouched
      ? validateWorkspaceCode(workspace.trim().toLowerCase())
      : null;

  const handleSignIn = useCallback(async () => {
    haptics.medium();
    if (!email.trim() || !password.trim()) return;
    if (connectionMode === 'relay') {
      const err = validateWorkspaceCode(workspace.trim().toLowerCase());
      if (err) {
        setWorkspaceTouched(true);
        return;
      }
      persistWorkspace();
    }
    // Reset both error AND errorKind before submission so the expired
    // banner doesn't flash back if the user retries during a quick login.
    clearError();
    setIsSigningIn(true);
    try {
      await login(email.trim(), password);
    } catch {
      // Error is set in the store; banner renders on next paint.
    } finally {
      setIsSigningIn(false);
    }
  }, [email, password, login, connectionMode, workspace, persistWorkspace, haptics, clearError]);

  const handleEmailChange = useCallback(
    (text: string) => {
      if (error) clearError();
      setEmail(text);
    },
    [error, clearError],
  );

  const handlePasswordChange = useCallback(
    (text: string) => {
      if (error) clearError();
      setPassword(text);
    },
    [error, clearError],
  );

  const canSubmit =
    !!email.trim() &&
    !!password.trim() &&
    !isSigningIn &&
    (connectionMode !== 'relay' ||
      validateWorkspaceCode(workspace.trim().toLowerCase()) === null);

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <MotionCard style={styles.card}>
            <Image
              source={require('../../assets/images/app-icon.png')}
              style={styles.logo}
              resizeMode="contain"
            />

            <Text style={styles.heading}>Sign in</Text>

            {errorKind === 'expired' && error ? (
              <View
                style={styles.expiredBanner}
                accessibilityLiveRegion="polite"
                accessibilityRole="alert">
                <Icon
                  name="time-outline"
                  size={20}
                  color={COLORS.warningTextDark}
                  style={styles.expiredIcon}
                />
                <Text style={styles.expiredText}>{error}</Text>
              </View>
            ) : null}

            {connectionMode === 'relay' ? (
              <View style={styles.inputContainer}>
                <TextInput
                  style={[
                    styles.input,
                    workspaceFocused && styles.inputFocused,
                    workspaceError && styles.inputError,
                  ]}
                  placeholder="Workspace (e.g. acme-prod)"
                  placeholderTextColor={COLORS.textMuted}
                  value={workspace}
                  onChangeText={text => {
                    if (error) clearError();
                    setWorkspace(text);
                  }}
                  onFocus={() => setWorkspaceFocused(true)}
                  onBlur={() => {
                    setWorkspaceFocused(false);
                    setWorkspaceTouched(true);
                    persistWorkspace();
                  }}
                  autoCapitalize="none"
                  autoCorrect={false}
                  spellCheck={false}
                  maxLength={32}
                  keyboardType="ascii-capable"
                  textContentType="none"
                  autoComplete="off"
                  importantForAutofill="no"
                  clearButtonMode="while-editing"
                  returnKeyType="next"
                  onSubmitEditing={() => emailRef.current?.focus()}
                  editable={!isSigningIn}
                  accessibilityLabel="Workspace code"
                  accessibilityHint="Enter the workspace code provided by your administrator"
                />
                {workspaceError ? (
                  <View accessibilityLiveRegion="polite" accessibilityRole="alert">
                    <Text style={styles.fieldError}>{workspaceError}</Text>
                  </View>
                ) : null}
              </View>
            ) : null}

            <View style={styles.inputContainer}>
              <TextInput
                ref={emailRef}
                style={[styles.input, emailFocused && styles.inputFocused]}
                placeholder="Username"
                placeholderTextColor={COLORS.textMuted}
                value={email}
                onChangeText={handleEmailChange}
                onFocus={() => setEmailFocused(true)}
                onBlur={() => setEmailFocused(false)}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
                keyboardType="email-address"
                textContentType="emailAddress"
                returnKeyType="next"
                onSubmitEditing={() => passwordRef.current?.focus()}
                editable={!isSigningIn}
              />
            </View>

            <View style={styles.inputContainer}>
              <TextInput
                ref={passwordRef}
                style={[styles.input, passwordFocused && styles.inputFocused]}
                placeholder="Password"
                placeholderTextColor={COLORS.textMuted}
                value={password}
                onChangeText={handlePasswordChange}
                onFocus={() => setPasswordFocused(true)}
                onBlur={() => setPasswordFocused(false)}
                secureTextEntry
                // Android's secureTextEntry does NOT reliably suppress
                // auto-capitalization / autocorrect across OEM keyboards, so
                // the first character of the password gets mangled and the
                // server 401s with "email or password incorrect" — even though
                // iOS (where secureTextEntry does suppress it) signs in fine.
                // Force them off explicitly, matching the email field.
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="current-password"
                textContentType="password"
                keyboardType="default"
                returnKeyType="go"
                onSubmitEditing={handleSignIn}
                editable={!isSigningIn}
              />
            </View>

            {error && errorKind !== 'expired' ? (
              <View accessibilityLiveRegion="polite" accessibilityRole="alert">
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}

            {/* "Keep me signed in" — when checked (default) the bearer token
                persists across cold starts via SecureStorage; unchecked keeps
                it in memory only so app-kill forces re-auth. The preference
                is saved to settingsStore the moment it changes, so the next
                login (this one) honours the new value. */}
            <TouchableOpacity
              onPress={() => {
                haptics.selection();
                saveSettings({keepSignedIn: !persistedKeepSignedIn});
              }}
              style={styles.keepSignedInRow}
              accessibilityRole="checkbox"
              accessibilityState={{checked: persistedKeepSignedIn}}
              accessibilityLabel="Keep me signed in"
              hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}>
              <View
                style={[
                  styles.keepSignedInBox,
                  persistedKeepSignedIn && styles.keepSignedInBoxChecked,
                ]}>
                {persistedKeepSignedIn ? (
                  <Icon name="check" size={14} color={COLORS.cream} strokeWidth={2.5} />
                ) : null}
              </View>
              <Text style={styles.keepSignedInLabel}>Keep me signed in</Text>
            </TouchableOpacity>

            {isSigningIn ? (
              // Keep the inline spinner for the brief disabled+busy window —
              // PillButton has no loading state and the user needs visible
              // confirmation that auth is in flight.
              <View style={styles.loadingRow}>
                <ActivityIndicator size="small" color={COLORS.crimson} />
              </View>
            ) : (
              <PillButton
                variant="solid"
                label="Sign in"
                onPress={handleSignIn}
                disabled={!canSubmit}
                style={styles.signInButton}
              />
            )}

            <Text style={styles.helpText}>
              Sign in with credentials provided by your AERIS administrator.{' '}
              <Text
                style={styles.helpLink}
                onPress={() => Linking.openURL('https://aeris.team')}>
                Learn more
              </Text>
            </Text>

            <TouchableOpacity
              style={styles.connectionLink}
              onPress={() => setSettingsOpen(true)}
              accessibilityRole="button"
              accessibilityLabel={`Configure connection, currently ${connectionMode === 'relay' ? 'Relay' : 'Direct'}`}
              hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}>
              <Text style={styles.connectionLinkText}>
                Connection: {connectionMode === 'relay' ? 'Relay' : 'Direct'} ·
                Configure
              </Text>
            </TouchableOpacity>
          </MotionCard>
        </ScrollView>
      </KeyboardAvoidingView>

      <SettingsModal
        visible={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    // Page-level surface BEHIND the cream card. Was a one-off steel blue
    // (#2d6a8c) that isn't in the brand palette; collapsed to the canonical
    // navy chrome to match the rest of the app.
    backgroundColor: COLORS.primary,
  },
  keyboardView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: COLORS.cream,
    borderRadius: BORDER_RADIUS.xxl,
    borderWidth: 1,
    borderColor: COLORS.surfaceBorder,
    padding: SPACING.xl,
    paddingTop: 40,
    paddingBottom: 36,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 4},
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 8,
  },
  logo: {
    width: 180,
    height: 80,
    marginBottom: SPACING.md,
  },
  heading: {
    fontSize: FONT_SIZE.displayLg,
    fontFamily: FONT_FAMILY.medium,
    color: COLORS.text,
    letterSpacing: LETTER_SPACING.tightLg,
    alignSelf: 'flex-start',
    marginBottom: SPACING.lg,
  },
  inputContainer: {
    width: '100%',
    marginBottom: SPACING.md,
  },
  input: {
    width: '100%',
    height: 52,
    backgroundColor: COLORS.inputBg,
    borderRadius: BORDER_RADIUS.md,
    paddingHorizontal: SPACING.md,
    fontSize: FONT_SIZE.lg,
    color: COLORS.text,
    borderWidth: 2,
    borderColor: COLORS.inputBorder,
  },
  inputFocused: {
    borderColor: COLORS.inputFocusBorder,
  },
  inputError: {
    borderColor: COLORS.danger,
  },
  fieldError: {
    color: COLORS.danger,
    fontSize: FONT_SIZE.xs,
    marginTop: SPACING.xs,
  },
  errorText: {
    color: COLORS.danger,
    fontSize: FONT_SIZE.sm,
    textAlign: 'center',
    marginBottom: SPACING.md,
  },
  expiredBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    backgroundColor: COLORS.warningBg,
    borderWidth: 1,
    borderColor: COLORS.warningBorder,
    borderRadius: BORDER_RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    marginBottom: SPACING.md,
  },
  expiredIcon: {
    marginRight: SPACING.sm,
  },
  expiredText: {
    flex: 1,
    color: COLORS.warningText,
    fontSize: FONT_SIZE.sm,
    lineHeight: 18,
  },
  keepSignedInRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: SPACING.md,
    paddingVertical: SPACING.xs,
  },
  keepSignedInBox: {
    width: 18,
    height: 18,
    borderRadius: BORDER_RADIUS.sm,
    borderWidth: 1.5,
    borderColor: COLORS.surfaceBorder,
    backgroundColor: COLORS.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: SPACING.sm,
  },
  keepSignedInBoxChecked: {
    backgroundColor: COLORS.crimson,
    borderColor: COLORS.crimson,
  },
  keepSignedInLabel: {
    color: COLORS.text,
    fontSize: FONT_SIZE.sm,
    fontFamily: FONT_FAMILY.medium,
  },
  signInButton: {
    width: '100%',
    marginTop: SPACING.sm,
  },
  loadingRow: {
    width: '100%',
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: SPACING.sm,
  },
  helpText: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.sm,
    textAlign: 'center',
    marginTop: SPACING.md,
    lineHeight: 18,
  },
  helpLink: {
    color: COLORS.crimson,
    fontFamily: FONT_FAMILY.medium,
  },
  connectionLink: {
    marginTop: SPACING.md,
    paddingVertical: SPACING.xs,
  },
  connectionLinkText: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.xs,
    textAlign: 'center',
    textDecorationLine: 'underline',
  },
});

export default LoginScreen;
