import React, {useState} from 'react';
import {View, Text, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform} from 'react-native';
import {COLORS, FONT_SIZE, SPACING, BORDER_RADIUS} from '../constants/theme';

interface PinPadProps {
  title: string;
  onSubmit: (pin: string) => void;
  onCancel?: () => void;
  error?: string;
}

const PinPad: React.FC<PinPadProps> = ({title, onSubmit, onCancel, error}) => {
  const [pin, setPin] = useState('');

  const handleDigit = (digit: string) => {
    if (pin.length < 4) {
      const newPin = pin + digit;
      setPin(newPin);
      if (newPin.length === 4) {
        onSubmit(newPin);
        setPin('');
      }
    }
  };

  const handleDelete = () => setPin(pin.slice(0, -1));
  const handleClear = () => setPin('');

  const dots = Array.from({length: 4}, (_, i) => (
    <View key={i} style={[styles.dot, i < pin.length && styles.dotFilled]} />
  ));

  const digits = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'DEL'];

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}>
      <Text style={styles.title}>{title}</Text>
      <View style={styles.dotsRow}>{dots}</View>
      {error && <Text style={styles.error}>{error}</Text>}
      <View style={styles.grid}>
        {digits.map((d, i) =>
          d === '' ? (
            <View key={i} style={styles.emptyKey} />
          ) : d === 'DEL' ? (
            <TouchableOpacity key={i} style={styles.key} onPress={handleDelete} onLongPress={handleClear}>
              <Text style={styles.keyText}>DEL</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity key={i} style={styles.key} onPress={() => handleDigit(d)}>
              <Text style={styles.keyText}>{d}</Text>
            </TouchableOpacity>
          ),
        )}
      </View>
      {onCancel && (
        <TouchableOpacity style={styles.cancelBtn} onPress={onCancel}>
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>
      )}
    </KeyboardAvoidingView>
  );
};

// PinPad uses a self-contained navy card so it reads correctly whether it's
// rendered on a navy lockOverlay (MainScreen) or inside a white modal
// (SessionSwitcher / SessionCreate). Cream text + glass keys on navy.
const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    padding: SPACING.lg,
    backgroundColor: COLORS.navy,
    borderRadius: BORDER_RADIUS.xl,
  },
  title: {fontSize: FONT_SIZE.xl, fontWeight: '600', color: COLORS.textOnDark, marginBottom: SPACING.lg},
  dotsRow: {flexDirection: 'row', gap: SPACING.md, marginBottom: SPACING.sm + 4},
  dot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: COLORS.textOnDark,
  },
  dotFilled: {backgroundColor: COLORS.textOnDark},
  error: {color: COLORS.dangerLight, fontSize: FONT_SIZE.md, marginBottom: SPACING.sm + 4},
  grid: {flexDirection: 'row', flexWrap: 'wrap', width: 240, justifyContent: 'center'},
  key: {
    width: 72,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
    margin: 4,
    borderRadius: BORDER_RADIUS.md,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  emptyKey: {width: 72, height: 56, margin: 4},
  keyText: {fontSize: 22, fontWeight: '600', color: COLORS.textOnDark},
  cancelBtn: {marginTop: SPACING.md},
  cancelText: {color: COLORS.textOnDark, fontSize: FONT_SIZE.lg, textDecorationLine: 'underline'},
});

export default PinPad;
