import React from 'react';
import {
  InputAccessoryView,
  Keyboard,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {COLORS, FONT_FAMILY, FONT_SIZE, SPACING} from '../constants/theme';

interface KeyboardDoneAccessoryProps {
  /**
   * nativeID shared with every TextInput that should show this bar via
   * `inputAccessoryViewID={Platform.OS === 'ios' ? nativeID : undefined}`.
   */
  nativeID: string;
}

/**
 * iOS-only "Done" bar rendered above the keyboard. Multiline and numeric
 * keyboards (decimal-pad / number-pad) have no return key, so without this
 * an operator can get stuck with the keyboard up — a functional defect an
 * App Store reviewer would hit. Mirrors the inline bar CartScreen /
 * CheckoutScreen already ship; extracted so every form reuses one look.
 *
 * Renders null on Android — Android numeric/multiline keyboards expose a
 * system-level dismiss affordance, and drag-to-dismiss covers the rest.
 */
const KeyboardDoneAccessory: React.FC<KeyboardDoneAccessoryProps> = ({
  nativeID,
}) => {
  if (Platform.OS !== 'ios') return null;
  return (
    <InputAccessoryView nativeID={nativeID}>
      <View style={styles.bar}>
        <TouchableOpacity
          onPress={() => Keyboard.dismiss()}
          accessibilityRole="button"
          accessibilityLabel="Dismiss keyboard"
          hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}>
          <Text style={styles.done}>Done</Text>
        </TouchableOpacity>
      </View>
    </InputAccessoryView>
  );
};

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderTopWidth: 1,
    borderTopColor: COLORS.surfaceBorder,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
  },
  done: {
    color: COLORS.crimson,
    fontSize: FONT_SIZE.md,
    fontFamily: FONT_FAMILY.semibold,
    paddingHorizontal: SPACING.sm,
  },
});

export default KeyboardDoneAccessory;
