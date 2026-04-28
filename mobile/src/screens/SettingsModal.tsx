import React, {useState, useEffect} from 'react';
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
import {useSettings} from '../hooks/useSettings';
import {useAuthStore} from '../stores/authStore';
import type {ConnectionMode} from '../types/api.types';

interface Props {
  visible: boolean;
  onClose: () => void;
}

const SettingsModal: React.FC<Props> = ({visible, onClose}) => {
  const {settings, saveSettings, testConnection} = useSettings();
  const isAuthenticated = useAuthStore(s => s.isAuthenticated);
  const clearLocalSession = useAuthStore(s => s.clearLocalSession);
  const [baseUrl, setBaseUrl] = useState(settings.baseUrl);
  const [relayUrl, setRelayUrl] = useState(settings.relayUrl ?? '');
  const [mode, setMode] = useState<ConnectionMode>(
    settings.connectionMode ?? 'direct',
  );
  const [sessionTimeout, setSessionTimeout] = useState(settings.sessionTimeout);
  const [enableSessions, setEnableSessions] = useState(settings.enableSessionManagement);

  useEffect(() => {
    // Sync local form state when the modal opens or persisted settings
    // change. Subscribing to individual fields (rather than the whole
    // settings object) avoids re-syncing whenever an unrelated setting
    // is updated elsewhere.
    setBaseUrl(settings.baseUrl);
    setRelayUrl(settings.relayUrl ?? '');
    setMode(settings.connectionMode ?? 'direct');
    setSessionTimeout(settings.sessionTimeout);
    setEnableSessions(settings.enableSessionManagement);
  }, [
    settings.baseUrl,
    settings.relayUrl,
    settings.connectionMode,
    settings.sessionTimeout,
    settings.enableSessionManagement,
    visible,
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

  const handleSave = async () => {
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
    });
    onClose();
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

  return (
    <Modal isVisible={visible} onBackdropPress={onClose} style={styles.modal}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.title}>Settings</Text>

          <Text style={styles.label}>Connection</Text>
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
            <>
              <Text style={styles.label}>Server URL</Text>
              <View style={styles.urlRow}>
                <TextInput
                  style={styles.input}
                  value={baseUrl}
                  onChangeText={setBaseUrl}
                  placeholder="http://aeris.local:8000"
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <TouchableOpacity style={styles.testBtn} onPress={handleTest}>
                  <Text style={styles.testText}>Test</Text>
                </TouchableOpacity>
              </View>
            </>
          ) : (
            <>
              <Text style={styles.label}>Relay URL</Text>
              <View style={styles.urlRow}>
                <TextInput
                  style={styles.input}
                  value={relayUrl}
                  onChangeText={setRelayUrl}
                  placeholder="https://api.aeris.team"
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <TouchableOpacity style={styles.testBtn} onPress={handleTest}>
                  <Text style={styles.testText}>Test</Text>
                </TouchableOpacity>
              </View>
            </>
          )}

          <Text style={styles.label}>Session Timeout: {sessionTimeout} min</Text>
          <TextInput
            style={styles.input}
            value={String(sessionTimeout)}
            onChangeText={t => {
              const n = parseInt(t, 10);
              if (!isNaN(n) && n >= 5 && n <= 120) setSessionTimeout(n);
            }}
            keyboardType="numeric"
          />

          <View style={styles.switchRow}>
            <Text style={styles.label}>Session Management</Text>
            <Switch value={enableSessions} onValueChange={setEnableSessions} />
          </View>

          <View style={styles.buttons}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onClose}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.saveBtn} onPress={handleSave}>
              <Text style={styles.saveText}>Save</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modal: {justifyContent: 'center', margin: 40},
  content: {backgroundColor: '#fff', borderRadius: 12, padding: 24},
  title: {fontSize: 22, fontWeight: '700', color: '#003049', marginBottom: 20},
  label: {fontSize: 14, color: '#555', marginTop: 12, marginBottom: 4},
  input: {
    borderWidth: 1,
    borderColor: '#e3e3e3',
    borderRadius: 8,
    padding: 10,
    fontSize: 15,
    flex: 1,
  },
  urlRow: {flexDirection: 'row', gap: 8, alignItems: 'center'},
  testBtn: {backgroundColor: '#667eea', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 8},
  testText: {color: '#fff', fontWeight: '600'},
  modeRow: {flexDirection: 'row', gap: 8, marginTop: 4},
  modeBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e3e3e3',
    alignItems: 'center',
    backgroundColor: '#f7f7f7',
  },
  modeBtnActive: {
    backgroundColor: '#003049',
    borderColor: '#003049',
  },
  modeText: {color: '#555', fontWeight: '600'},
  modeTextActive: {color: '#fff'},
  switchRow: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 16},
  buttons: {flexDirection: 'row', justifyContent: 'flex-end', gap: 12, marginTop: 24},
  cancelBtn: {paddingHorizontal: 16, paddingVertical: 10},
  cancelText: {color: '#dc2626', fontSize: 16},
  saveBtn: {backgroundColor: '#48bb78', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8},
  saveText: {color: '#fff', fontSize: 16, fontWeight: '600'},
});

export default SettingsModal;
