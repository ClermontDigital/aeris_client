import React from 'react';
import {View, Text, Pressable, StyleSheet} from 'react-native';
import Icon from './Icon';
import {
  COLORS,
  SPACING,
  FONT_SIZE,
  FONT_FAMILY,
  BORDER_RADIUS,
  ICON_SIZE,
  SHADOW,
} from '../constants/theme';

export type StatCardTone = 'default' | 'warning' | 'danger' | 'success';

export interface StatCardProps {
  label: string;
  value: string | number;
  sublabel?: string;
  tone?: StatCardTone;
  icon?: React.ComponentProps<typeof Icon>['name'];
  onPress?: () => void;
  // Override the value font size. Used by 3-up stat strips that compute a
  // single size from the widest value in the row, so cards stay visually
  // consistent instead of each shrinking independently. See
  // pickStatRowFontSize in components/StatCard.tsx for the helper.
  valueFontSize?: number;
}

// Helper for callers rendering a row of stat cards. Returns a single font
// size that fits the widest value at the typical 3-up column width on the
// narrowest iPhone we support (~96px per cell after gutters/padding). Per-
// card adjustsFontSizeToFit produces visual mismatch when a row mixes "0"
// and "$1,234.56" — this gives every card in the strip the same scaled
// size based on the longest string.
export function pickStatRowFontSize(values: ReadonlyArray<string | number>): number {
  let longest = 0;
  for (const v of values) {
    const len = String(v ?? '').length;
    if (len > longest) longest = len;
  }
  if (longest <= 5) return FONT_SIZE.xxl; // "$0.00" or shorter
  if (longest <= 7) return 22; // "$99.99"
  if (longest <= 9) return FONT_SIZE.xl; // "$1,234.56"
  if (longest <= 11) return 18; // "$12,345.67"
  if (longest <= 13) return 16; // "$1,234,567.89"
  return 14;
}

// Mirrors client/src/renderer/components/StatCard.tsx so dashboard +
// list-screen aggregates share token-driven typography across desktop
// and mobile.
const StatCard: React.FC<StatCardProps> = ({
  label,
  value,
  sublabel,
  tone = 'default',
  icon,
  onPress,
  valueFontSize,
}) => {
  const valueColor =
    tone === 'danger'
      ? COLORS.danger
      : tone === 'warning'
        ? COLORS.warning
        : tone === 'success'
          ? COLORS.success
          : COLORS.text;

  const body = (
    <>
      {icon ? (
        <Icon
          name={icon}
          size={ICON_SIZE.stat}
          color={valueColor}
          style={styles.icon}
        />
      ) : null}
      {/* valueFontSize overrides the default xxl so every card in a strip
          can be sized uniformly from the widest value. Falls back to
          adjustsFontSizeToFit only when the caller didn't pre-compute a
          size (single-card layouts where per-card shrink is fine). */}
      <Text
        style={[
          styles.value,
          {color: valueColor},
          valueFontSize ? {fontSize: valueFontSize} : null,
        ]}
        numberOfLines={1}
        adjustsFontSizeToFit={!valueFontSize}
        minimumFontScale={0.6}
        allowFontScaling={false}>
        {value}
      </Text>
      <Text style={styles.label} numberOfLines={1}>
        {label}
      </Text>
      {sublabel ? (
        <Text style={styles.sublabel} numberOfLines={1}>
          {sublabel}
        </Text>
      ) : null}
    </>
  );

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${value}`}
        android_ripple={{color: COLORS.surfaceBorderHover}}
        style={({pressed}) => [styles.card, pressed && styles.cardPressed]}>
        {body}
      </Pressable>
    );
  }

  return (
    <View
      style={styles.card}
      accessibilityRole="text"
      accessibilityLabel={`${label}: ${value}`}>
      {body}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    // Fixed minHeight so cards in a 2- or 3-up strip line up even when
    // only some of them have a sublabel — without this, a card with
    // `sublabel` renders ~14px taller than one without, and the row
    // looks uneven. 96 covers icon + value + label + sublabel + padding.
    minHeight: 96,
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.xxl,
    borderWidth: 1,
    borderColor: COLORS.surfaceBorder,
    padding: SPACING.md,
    flexDirection: 'column',
    ...SHADOW.card,
  },
  cardPressed: {opacity: 0.7},
  icon: {marginBottom: SPACING.xs},
  value: {
    fontSize: FONT_SIZE.xxl,
    fontFamily: FONT_FAMILY.bold,
    // tabular-nums keeps stat columns aligned when stacked in a grid
    fontVariant: ['tabular-nums'],
  },
  label: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.sm,
    marginTop: SPACING.xs,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  sublabel: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.xs,
    marginTop: SPACING.xs,
  },
});

export default StatCard;
