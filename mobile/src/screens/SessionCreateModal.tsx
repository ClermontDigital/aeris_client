import React, {useState} from 'react';
import {View, Text, TextInput, StyleSheet, Alert, KeyboardAvoidingView, Platform} from 'react-native';
import Modal from 'react-native-modal';
import PinPad from '../components/PinPad';
import {useSessionStore} from '../stores/sessionStore';
import {COLORS, FONT_SIZE, SPACING, BORDER_RADIUS} from '../constants/theme';

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
                placeholderTextColor={COLORS.inputPlaceholder}
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
  modal: {justifyContent: 'center', margin: SPACING.xl + 8},
  content: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.lg,
    alignItems: 'center',
  },
  title: {fontSize: FONT_SIZE.xl, fontWeight: '700', color: COLORS.text, marginBottom: SPACING.md},
  label: {fontSize: FONT_SIZE.md, color: COLORS.textMuted, alignSelf: 'flex-start', marginBottom: 4},
  input: {
    borderWidth: 1,
    borderColor: COLORS.inputBorder,
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.sm + 4,
    fontSize: FONT_SIZE.lg,
    width: '100%',
    color: COLORS.text,
  },
  buttons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    marginTop: SPACING.lg - 4,
  },
  cancel: {color: COLORS.danger, fontSize: FONT_SIZE.lg},
  next: {color: COLORS.crimson, fontSize: FONT_SIZE.lg, fontWeight: '600'},
});

export default SessionCreateModal;
