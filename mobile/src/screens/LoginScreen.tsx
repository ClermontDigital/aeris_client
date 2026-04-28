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
import {useAuthStore} from '../stores/authStore';
import {useSettingsStore} from '../stores/settingsStore';
import SettingsModal from './SettingsModal';
import {SPACING, FONT_SIZE, BORDER_RADIUS} from '../constants/theme';
import {validateWorkspaceCode} from '../constants/config';

// Exact colors from the Aeris ERP login page (Aeris2 Laravel CSS)
const LOGIN = {
  background: '#2d6a8c',              // Steel blue background
  card: '#fdf0d5',                    // Cream card
  inputBg: 'rgba(255, 255, 255, 0.9)', // Nearly opaque white
  inputBorder: 'rgba(156, 163, 175, 0.3)', // Gray 30% opacity
  inputFocusBorder: '#c1121f',        // Crimson focus
  inputText: '#003049',               // Navy text
  inputPlaceholder: '#9ca3af',        // Gray placeholder
  buttonStart: '#c1121f',             // Crimson (button bg)
  buttonEnd: '#d32f2f',               // Material red (gradient hint)
  buttonText: '#ffffff',
  navy: '#003049',                    // Navy for labels
  crimson: '#c1121f',                 // Crimson for links/accents
  errorText: '#c1121f',
  helpText: '#6b7280',               // Muted gray
  inputErrorBorder: '#c1121f',       // same as focus crimson; used on workspace error
};

const LoginScreen: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [emailFocused, setEmailFocused] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);

  const login = useAuthStore(s => s.login);
  const isLoading = useAuthStore(s => s.isLoading);
  const error = useAuthStore(s => s.error);
  const clearError = useAuthStore(s => s.clearError);
  const connectionMode = useSettingsStore(s => s.settings.connectionMode);
  const persistedWorkspace = useSettingsStore(s => s.settings.workspaceCode);
  const saveSettings = useSettingsStore(s => s.saveSettings);

  const [workspace, setWorkspace] = useState(persistedWorkspace ?? '');
  const [workspaceFocused, setWorkspaceFocused] = useState(false);
  const [workspaceTouched, setWorkspaceTouched] = useState(false);

  useEffect(() => {
    setWorkspace(persistedWorkspace ?? '');
  }, [persistedWorkspace]);

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
    if (!email.trim() || !password.trim()) return;
    if (connectionMode === 'relay') {
      const err = validateWorkspaceCode(workspace.trim().toLowerCase());
      if (err) {
        setWorkspaceTouched(true);
        return;
      }
      persistWorkspace();
    }
    try {
      await login(email.trim(), password);
    } catch {
      // Error is set in the store
    }
  }, [email, password, login, connectionMode, workspace, persistWorkspace]);

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
    !isLoading &&
    (connectionMode !== 'relay' ||
      validateWorkspaceCode(workspace.trim().toLowerCase()) === null);

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <View style={styles.card}>
            <Image
              source={require('../../assets/images/app-icon.png')}
              style={styles.logo}
              resizeMode="contain"
            />

            {connectionMode === 'relay' ? (
              <View style={styles.inputContainer}>
                <TextInput
                  style={[
                    styles.input,
                    workspaceFocused && styles.inputFocused,
                    workspaceError && styles.inputError,
                  ]}
                  placeholder="Workspace (e.g. acme-prod)"
                  placeholderTextColor={LOGIN.inputPlaceholder}
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
                  editable={!isLoading}
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
                placeholderTextColor={LOGIN.inputPlaceholder}
                value={email}
                onChangeText={handleEmailChange}
                onFocus={() => setEmailFocused(true)}
                onBlur={() => setEmailFocused(false)}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                textContentType="emailAddress"
                returnKeyType="next"
                onSubmitEditing={() => passwordRef.current?.focus()}
                editable={!isLoading}
              />
            </View>

            <View style={styles.inputContainer}>
              <TextInput
                ref={passwordRef}
                style={[styles.input, passwordFocused && styles.inputFocused]}
                placeholder="Password"
                placeholderTextColor={LOGIN.inputPlaceholder}
                value={password}
                onChangeText={handlePasswordChange}
                onFocus={() => setPasswordFocused(true)}
                onBlur={() => setPasswordFocused(false)}
                secureTextEntry
                textContentType="password"
                returnKeyType="go"
                onSubmitEditing={handleSignIn}
                editable={!isLoading}
              />
            </View>

            {error ? (
              <View accessibilityLiveRegion="polite" accessibilityRole="alert">
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}

            <TouchableOpacity
              style={[styles.goButton, !canSubmit && styles.goButtonDisabled]}
              onPress={handleSignIn}
              disabled={!canSubmit}
              activeOpacity={0.8}
              accessibilityState={{disabled: !canSubmit, busy: isLoading}}>
              {isLoading ? (
                <ActivityIndicator size="small" color={LOGIN.buttonText} />
              ) : (
                <Text style={styles.goButtonText}>GO</Text>
              )}
            </TouchableOpacity>

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
              onPress={() => setSettingsOpen(true)}>
              <Text style={styles.connectionLinkText}>
                Connection: {connectionMode === 'relay' ? 'Relay' : 'Direct'} ·
                Configure
              </Text>
            </TouchableOpacity>
          </View>
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
    backgroundColor: LOGIN.background,
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
    backgroundColor: LOGIN.card,
    borderRadius: BORDER_RADIUS.xl,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
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
    marginBottom: 32,
  },
  inputContainer: {
    width: '100%',
    marginBottom: SPACING.md,
  },
  input: {
    width: '100%',
    height: 52,
    backgroundColor: LOGIN.inputBg,
    borderRadius: BORDER_RADIUS.md,
    paddingHorizontal: SPACING.md,
    fontSize: FONT_SIZE.lg,
    color: LOGIN.inputText,
    borderWidth: 2,
    borderColor: LOGIN.inputBorder,
  },
  inputFocused: {
    borderColor: LOGIN.inputFocusBorder,
  },
  inputError: {
    borderColor: LOGIN.inputErrorBorder,
  },
  fieldError: {
    color: LOGIN.errorText,
    fontSize: FONT_SIZE.xs,
    marginTop: SPACING.xs,
  },
  errorText: {
    color: LOGIN.errorText,
    fontSize: FONT_SIZE.sm,
    textAlign: 'center',
    marginBottom: SPACING.md,
  },
  goButton: {
    width: '100%',
    height: 52,
    backgroundColor: LOGIN.buttonStart,
    borderRadius: BORDER_RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: SPACING.sm,
    shadowColor: LOGIN.crimson,
    shadowOffset: {width: 0, height: 3},
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 4,
  },
  goButtonDisabled: {
    opacity: 0.5,
  },
  goButtonText: {
    color: LOGIN.buttonText,
    fontSize: FONT_SIZE.xl,
    fontWeight: '700',
    letterSpacing: 3,
  },
  helpText: {
    color: LOGIN.helpText,
    fontSize: FONT_SIZE.sm,
    textAlign: 'center',
    marginTop: SPACING.md,
    lineHeight: 18,
  },
  helpLink: {
    color: LOGIN.crimson,
    fontWeight: '600',
  },
  connectionLink: {
    marginTop: SPACING.md,
    paddingVertical: SPACING.xs,
  },
  connectionLinkText: {
    color: LOGIN.helpText,
    fontSize: FONT_SIZE.xs,
    textAlign: 'center',
    textDecorationLine: 'underline',
  },
});

export default LoginScreen;
