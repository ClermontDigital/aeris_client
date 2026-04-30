import React, {useState} from 'react';
import {View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert} from 'react-native';
import Modal from 'react-native-modal';
import SessionCard from '../components/SessionCard';
import PinPad from '../components/PinPad';
import {useSessionStore} from '../stores/sessionStore';
import {COLORS, FONT_SIZE, SPACING, BORDER_RADIUS} from '../constants/theme';

interface Props {
  visible: boolean;
  onClose: () => void;
  onCreateNew: () => void;
}

const SessionSwitcherModal: React.FC<Props> = ({visible, onClose, onCreateNew}) => {
  const {sessions, activeSession, switchToSession, deleteSession} = useSessionStore();
  const [pinForSession, setPinForSession] = useState<string | null>(null);
  const [pinError, setPinError] = useState('');

  const handleSessionPress = (sessionId: string, isLocked: boolean) => {
    if (isLocked) {
      setPinForSession(sessionId);
      setPinError('');
    } else {
      try {
        switchToSession(sessionId);
        onClose();
      } catch (e: unknown) {
        Alert.alert('Error', e instanceof Error ? e.message : 'Failed to switch session');
      }
    }
  };

  const handlePinSubmit = (pin: string) => {
    if (!pinForSession) return;
    try {
      switchToSession(pinForSession, pin);
      setPinForSession(null);
      setPinError('');
      onClose();
    } catch (e: unknown) {
      setPinError(e instanceof Error ? e.message : 'Invalid PIN');
    }
  };

  const handleDelete = (sessionId: string, name: string) => {
    Alert.alert('Delete Session', `Delete "${name}"?`, [
      {text: 'Cancel', style: 'cancel'},
      {text: 'Delete', style: 'destructive', onPress: () => deleteSession(sessionId)},
    ]);
  };

  if (pinForSession) {
    return (
      <Modal isVisible={visible} onBackdropPress={() => setPinForSession(null)} style={styles.modal}>
        <View style={styles.pinContent}>
          <PinPad
            title="Enter PIN"
            onSubmit={handlePinSubmit}
            onCancel={() => setPinForSession(null)}
            error={pinError}
          />
        </View>
      </Modal>
    );
  }

  return (
    <Modal isVisible={visible} onBackdropPress={onClose} style={styles.modal}>
      <View style={styles.content}>
        <Text style={styles.title}>Sessions</Text>
        <ScrollView horizontal style={styles.scrollView}>
          {sessions.map(s => (
            <SessionCard
              key={s.id}
              session={s}
              isActive={s.id === activeSession?.id}
              onPress={() => handleSessionPress(s.id, s.isLocked)}
              onDelete={() => handleDelete(s.id, s.name)}
            />
          ))}
        </ScrollView>
        <View style={styles.buttons}>
          <TouchableOpacity style={styles.newBtn} onPress={onCreateNew}>
            <Text style={styles.newText}>New Session</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onClose}>
            <Text style={styles.closeText}>Close</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modal: {justifyContent: 'center', margin: SPACING.lg - 4},
  content: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.lg - 4,
    maxHeight: 400,
  },
  // PinPad supplies its own navy card, so the outer wrapper here is
  // transparent / flush.
  pinContent: {alignItems: 'center'},
  title: {fontSize: FONT_SIZE.xl, fontWeight: '700', color: COLORS.text, marginBottom: SPACING.sm + 4},
  scrollView: {flexGrow: 0},
  buttons: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: SPACING.md},
  newBtn: {
    backgroundColor: COLORS.crimson,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm + 2,
    borderRadius: BORDER_RADIUS.md,
  },
  newText: {color: COLORS.white, fontWeight: '600'},
  closeText: {color: COLORS.textMuted, fontSize: FONT_SIZE.md + 1},
});

export default SessionSwitcherModal;
