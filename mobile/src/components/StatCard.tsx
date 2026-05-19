import React from 'react';
import {View, Text, Pressable, StyleSheet} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import {
  COLORS,
  SPACING,
  FONT_SIZE,
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
  icon?: keyof typeof Ionicons.glyphMap;
  onPress?: () => void;
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
        <Ionicons
          name={icon}
          size={ICON_SIZE.stat}
          color={valueColor}
          style={styles.icon}
        />
      ) : null}
      {/* numberOfLines + adjustsFontSizeToFit keeps long values (e.g.
          formatted currency) on a single line on narrow iPhones — the
          three-up stat strips on Transactions and Dashboard otherwise
          wrap to a second row. minimumFontScale stops the auto-shrink
          from going so small it becomes illegible. */}
      <Text
        style={[styles.value, {color: valueColor}]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.6}
        allowFontScaling={false}>
        {value}
      </Text>
      <Text style={styles.label} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
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
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
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
    fontWeight: '700',
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
