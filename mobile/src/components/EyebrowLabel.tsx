import React from 'react';
import {Text, StyleSheet, View, ViewStyle, TextStyle} from 'react-native';
import {COLORS, FONT_FAMILY, FONT_SIZE, LETTER_SPACING, SPACING} from '../constants/theme';

// Eyebrow label per AERIS Visual Brand Guidelines v0.3 §06.
// Short all-caps tag that introduces a section, sets context, or signals a
// category. Poppins SemiBold, letterspaced 4-6%, 12-14px digital. Red Dirt
// Red on light backgrounds, Clermont Cream on dark. One eyebrow per section;
// never decorative.
//
// Use for: section openers above a heading, status tags (NEW, BETA), short
// editorial breakouts. Don't use for: body emphasis (use Medium weight
// inline instead), decorative breaks, or phrases over six words.
type Tone = 'light' | 'dark';

interface Props {
  children: string;
  tone?: Tone;          // 'light' = on cream/paper (default); 'dark' = on navy
  style?: ViewStyle;
  textStyle?: TextStyle;
  // Size — the spec allows 12-14px digital. Default is 12 (FONT_SIZE.eyebrow).
  size?: number;
}

const EyebrowLabel: React.FC<Props> = ({children, tone = 'light', style, textStyle, size}) => {
  const color = tone === 'dark' ? COLORS.cream : COLORS.crimson;
  return (
    <View style={[styles.wrap, style]} accessibilityRole="text">
      <Text
        style={[
          styles.text,
          {color, fontSize: size ?? FONT_SIZE.eyebrow},
          textStyle,
        ]}
        accessibilityLabel={children}
        numberOfLines={1}>
        {children.toUpperCase()}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    marginBottom: SPACING.sm,
  },
  text: {
    fontFamily: FONT_FAMILY.semibold,
    letterSpacing: LETTER_SPACING.eyebrow,
    // line-height 1.1-1.3 for headings (§05); eyebrow sits at the upper
    // edge of that range so a single line of caps has air under it.
    lineHeight: 16,
  },
});

export default EyebrowLabel;
