import React, {useState} from 'react';
import {View, Text, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform, useWindowDimensions} from 'react-native';
import {COLORS, FONT_SIZE, FONT_FAMILY, SPACING, BORDER_RADIUS} from '../constants/theme';
import {useHaptics} from '../hooks/useHaptics';
import {useResponsiveLayout} from '../hooks/useResponsiveLayout';

interface PinPadProps {
  title: string;
  onSubmit: (pin: string) => void;
  onCancel?: () => void;
  error?: string;
}

const PinPad: React.FC<PinPadProps> = ({title, onSubmit, onCancel, error}) => {
  const [pin, setPin] = useState('');
  const haptics = useHaptics();
  // Three size buckets:
  //   compact — short viewports (iPhone SE 667pt, 13 mini 812pt with bio)
  //   tablet  — width >= 600 (Galaxy Tab, iPad portrait/landscape)
  //   regular — everything else (default phone)
  // Tablet wins over compact (tablets are never < 700pt tall).
  const {height: viewportHeight} = useWindowDimensions();
  const {isTablet} = useResponsiveLayout();
  const compact = !isTablet && viewportHeight < 700;

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

  const keyStyle = isTablet
    ? styles.keyTablet
    : compact
      ? styles.keyCompact
      : null;
  const keyTextStyle = isTablet
    ? styles.keyTextTablet
    : compact
      ? styles.keyTextCompact
      : null;
  const gridStyle = isTablet
    ? styles.gridTablet
    : compact
      ? styles.gridCompact
      : null;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.container, isTablet && styles.containerTablet]}>
      <Text style={[styles.title, isTablet && styles.titleTablet]}>{title}</Text>
      {/* Dots indicator is a status, not a button — give VoiceOver a
          meaningful read-out of progress instead of letting it read each
          dot individually as "empty view". */}
      <View
        style={[styles.dotsRow, isTablet && styles.dotsRowTablet]}
        accessible
        accessibilityRole="text"
        accessibilityLabel={`PIN entry, ${pin.length} of 4 digits entered`}>
        {dots.map((dot, i) =>
          React.cloneElement(dot, {
            style: [styles.dot, isTablet && styles.dotTablet, i < pin.length && styles.dotFilled],
          }),
        )}
      </View>
      {error && (
        <Text style={styles.error} accessibilityLiveRegion="polite">
          {error}
        </Text>
      )}
      <View style={[styles.grid, gridStyle]}>
        {digits.map((d, i) =>
          d === '' ? (
            <View
              key={i}
              style={[styles.emptyKey, keyStyle]}
              importantForAccessibility="no"
            />
          ) : d === 'DEL' ? (
            <TouchableOpacity
              key={i}
              style={[styles.key, keyStyle]}
              onPress={handleDelete}
              onLongPress={handleClear}
              accessibilityRole="button"
              accessibilityLabel="Delete last digit. Long press to clear PIN.">
              <Text style={[styles.keyText, keyTextStyle]}>DEL</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              key={i}
              style={[styles.key, keyStyle]}
              onPress={() => handleDigit(d)}
              accessibilityRole="button"
              accessibilityLabel={`Digit ${d}`}>
              <Text style={[styles.keyText, keyTextStyle]}>{d}</Text>
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
  containerTablet: {padding: SPACING.xl},
  title: {fontSize: FONT_SIZE.xl, fontFamily: FONT_FAMILY.medium, color: COLORS.textOnDark, marginBottom: SPACING.lg},
  titleTablet: {fontSize: FONT_SIZE.display, marginBottom: SPACING.xl},
  dotsRow: {flexDirection: 'row', gap: SPACING.md, marginBottom: SPACING.sm + 4},
  dotsRowTablet: {gap: SPACING.lg, marginBottom: SPACING.lg},
  dot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: COLORS.textOnDark,
  },
  dotTablet: {width: 24, height: 24, borderRadius: 12, borderWidth: 2},
  dotFilled: {backgroundColor: COLORS.textOnDark},
  error: {color: COLORS.danger, fontSize: FONT_SIZE.md, marginBottom: SPACING.sm + 4},
  grid: {flexDirection: 'row', flexWrap: 'wrap', width: 240, justifyContent: 'center'},
  gridCompact: {width: 216},
  gridTablet: {width: 360},
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
  keyTablet: {width: 108, height: 84, margin: 6, borderRadius: BORDER_RADIUS.lg},
  emptyKey: {width: 72, height: 56, margin: 4},
  keyText: {fontSize: 22, fontFamily: FONT_FAMILY.medium, color: COLORS.textOnDark},
  keyTextCompact: {fontSize: 20},
  keyTextTablet: {fontSize: 32},
  cancelBtn: {marginTop: SPACING.md},
  cancelText: {color: COLORS.textOnDark, fontSize: FONT_SIZE.lg, textDecorationLine: 'underline'},
});

export default PinPad;
