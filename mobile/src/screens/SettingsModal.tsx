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

interface Props {
  visible: boolean;
  onClose: () => void;
}

const SettingsModal: React.FC<Props> = ({visible, onClose}) => {
  const {settings, saveSettings, testConnection} = useSettings();
  const [baseUrl, setBaseUrl] = useState(settings.baseUrl);
  const [sessionTimeout, setSessionTimeout] = useState(settings.sessionTimeout);
  const [enableSessions, setEnableSessions] = useState(settings.enableSessionManagement);

  useEffect(() => {
    setBaseUrl(settings.baseUrl);
    setSessionTimeout(settings.sessionTimeout);
    setEnableSessions(settings.enableSessionManagement);
  }, [settings, visible]);

  const handleSave = async () => {
    await saveSettings({
      baseUrl,
      sessionTimeout,
      enableSessionManagement: enableSessions,
    });
    onClose();
  };

  const handleTest = async () => {
    const ok = await testConnection(baseUrl);
    Alert.alert(ok ? 'Success' : 'Failed', ok ? 'Server is reachable.' : 'Cannot reach server.');
  };

  return (
    <Modal isVisible={visible} onBackdropPress={onClose} style={styles.modal}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.title}>Settings</Text>

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
  title: {fontSize: 22, fontWeight: '700', color: '#2c3e50', marginBottom: 20},
  label: {fontSize: 14, color: '#555', marginTop: 12, marginBottom: 4},
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 10,
    fontSize: 15,
    flex: 1,
  },
  urlRow: {flexDirection: 'row', gap: 8, alignItems: 'center'},
  testBtn: {backgroundColor: '#3498db', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 8},
  testText: {color: '#fff', fontWeight: '600'},
  switchRow: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 16},
  buttons: {flexDirection: 'row', justifyContent: 'flex-end', gap: 12, marginTop: 24},
  cancelBtn: {paddingHorizontal: 16, paddingVertical: 10},
  cancelText: {color: '#e74c3c', fontSize: 16},
  saveBtn: {backgroundColor: '#27ae60', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8},
  saveText: {color: '#fff', fontSize: 16, fontWeight: '600'},
});

export default SettingsModal;
