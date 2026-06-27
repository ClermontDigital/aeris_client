import React, {useState} from 'react';
import {View, Text, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform, useWindowDimensions} from 'react-native';
import {COLORS, FONT_SIZE, FONT_FAMILY, SPACING, BORDER_RADIUS} from '../constants/theme';
import {useHaptics} from '../hooks/useHaptics';

interface PinPadProps {
  title: string;
  onSubmit: (pin: string) => void;
  onCancel?: () => void;
  error?: string;
}

const PinPad: React.FC<PinPadProps> = ({title, onSubmit, onCancel, error}) => {
  const [pin, setPin] = useState('');
  const haptics = useHaptics();
  // Shrink the keypad on short viewports (iPhone SE 3rd gen 667pt, 13 mini
  // 812pt with biometric button) so the bottom row + Cancel never clip
  // below the safe area. Tall phones / iPad keep the original 72×56 keys.
  const {height: viewportHeight} = useWindowDimensions();
  const compact = viewportHeight < 700;

  // Light haptic on every digit press — matches the system PIN UX on iOS
  // Settings and most banking apps. selection() is the lightest tick we
  // have, perfect for a keypad cadence (10+ digits/sec) without feeling
  // mushy. useHaptics already gates on the user's Settings haptics toggle.
  const handleDigit = (digit: string) => {
    if (pin.length < 4) {
      haptics.selection();
      const newPin = pin + digit;
      setPin(newPin);
      if (newPin.length === 4) {
        onSubmit(newPin);
        setPin('');
      }
    }
  };

  const handleDelete = () => {
    if (pin.length === 0) return;
    haptics.light();
    setPin(pin.slice(0, -1));
  };
  // Long-press clear gets a heavier tick so the user knows the full PIN
  // was wiped (not just one digit).
  const handleClear = () => {
    if (pin.length === 0) return;
    haptics.medium();
    setPin('');
  };

  const dots = Array.from({length: 4}, (_, i) => (
    <View key={i} style={[styles.dot, i < pin.length && styles.dotFilled]} />
  ));

  const digits = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'DEL'];

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.container}>
      <Text style={styles.title}>{title}</Text>
      {/* Dots indicator is a status, not a button — give VoiceOver a
          meaningful read-out of progress instead of letting it read each
          dot individually as "empty view". */}
      <View
        style={styles.dotsRow}
        accessible
        accessibilityRole="text"
        accessibilityLabel={`PIN entry, ${pin.length} of 4 digits entered`}>
        {dots}
      </View>
      {error && (
        <Text style={styles.error} accessibilityLiveRegion="polite">
          {error}
        </Text>
      )}
      <View
        style={[styles.grid, compact && styles.gridCompact]}>
        {digits.map((d, i) =>
          d === '' ? (
            <View
              key={i}
              style={[styles.emptyKey, compact && styles.keyCompact]}
              importantForAccessibility="no"
            />
          ) : d === 'DEL' ? (
            <TouchableOpacity
              key={i}
              style={[styles.key, compact && styles.keyCompact]}
              onPress={handleDelete}
              onLongPress={handleClear}
              accessibilityRole="button"
              accessibilityLabel="Delete last digit. Long press to clear PIN.">
              <Text style={[styles.keyText, compact && styles.keyTextCompact]}>DEL</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              key={i}
              style={[styles.key, compact && styles.keyCompact]}
              onPress={() => handleDigit(d)}
              accessibilityRole="button"
              accessibilityLabel={`Digit ${d}`}>
              <Text style={[styles.keyText, compact && styles.keyTextCompact]}>{d}</Text>
            </TouchableOpacity>
          ),
        )}
      </View>
      {onCancel && (
        <TouchableOpacity
          style={styles.cancelBtn}
          onPress={onCancel}
          accessibilityRole="button"
          accessibilityLabel="Cancel PIN entry">
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
  title: {fontSize: FONT_SIZE.xl, fontFamily: FONT_FAMILY.medium, color: COLORS.textOnDark, marginBottom: SPACING.lg},
  dotsRow: {flexDirection: 'row', gap: SPACING.md, marginBottom: SPACING.sm + 4},
  dot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: COLORS.textOnDark,
  },
  dotFilled: {backgroundColor: COLORS.textOnDark},
  error: {color: COLORS.danger, fontSize: FONT_SIZE.md, marginBottom: SPACING.sm + 4},
  grid: {flexDirection: 'row', flexWrap: 'wrap', width: 240, justifyContent: 'center'},
  gridCompact: {width: 216},
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
  keyCompact: {width: 64, height: 48},
  emptyKey: {width: 72, height: 56, margin: 4},
  keyText: {fontSize: 22, fontFamily: FONT_FAMILY.medium, color: COLORS.textOnDark},
  keyTextCompact: {fontSize: 20},
  cancelBtn: {marginTop: SPACING.md},
  cancelText: {color: COLORS.textOnDark, fontSize: FONT_SIZE.lg, textDecorationLine: 'underline'},
});

export default PinPad;
