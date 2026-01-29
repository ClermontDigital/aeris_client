import React, {useState} from 'react';
import {View, Text, TextInput, StyleSheet, Alert, KeyboardAvoidingView, Platform} from 'react-native';
import Modal from 'react-native-modal';
import PinPad from '../components/PinPad';
import {useSessionStore} from '../stores/sessionStore';

interface Props {
  visible: boolean;
  onClose: () => void;
}

const SessionCreateModal: React.FC<Props> = ({visible, onClose}) => {
  const {createSession} = useSessionStore();
  const [name, setName] = useState('');
  const [step, setStep] = useState<'name' | 'pin'>('name');

  const handleNameSubmit = () => {
    if (!name.trim()) {
      Alert.alert('Error', 'Please enter a session name.');
      return;
    }
    setStep('pin');
  };

  const handlePinSubmit = (pin: string) => {
    try {
      createSession(name.trim(), pin);
      setName('');
      setStep('name');
      onClose();
    } catch (e: unknown) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Failed to create session');
    }
  };

  const handleClose = () => {
    setName('');
    setStep('name');
    onClose();
  };

  return (
    <Modal isVisible={visible} onBackdropPress={handleClose} style={styles.modal}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={styles.content}>
          {step === 'name' ? (
            <>
              <Text style={styles.title}>New Session</Text>
              <Text style={styles.label}>Session Name</Text>
              <TextInput
                style={styles.input}
                value={name}
                onChangeText={setName}
                placeholder="e.g. Cashier 1"
                autoFocus
                onSubmitEditing={handleNameSubmit}
                returnKeyType="next"
              />
              <View style={styles.buttons}>
                <Text style={styles.cancel} onPress={handleClose}>Cancel</Text>
                <Text style={styles.next} onPress={handleNameSubmit}>Next</Text>
              </View>
            </>
          ) : (
            <PinPad
              title={`Set PIN for "${name}"`}
              onSubmit={handlePinSubmit}
              onCancel={() => setStep('name')}
            />
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modal: {justifyContent: 'center', margin: 40},
  content: {backgroundColor: '#fff', borderRadius: 12, padding: 24, alignItems: 'center'},
  title: {fontSize: 20, fontWeight: '700', color: '#2c3e50', marginBottom: 16},
  label: {fontSize: 14, color: '#555', alignSelf: 'flex-start', marginBottom: 4},
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    width: '100%',
  },
  buttons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    marginTop: 20,
  },
  cancel: {color: '#e74c3c', fontSize: 16},
  next: {color: '#27ae60', fontSize: 16, fontWeight: '600'},
});

export default SessionCreateModal;
