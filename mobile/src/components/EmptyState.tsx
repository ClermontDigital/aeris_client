import React from 'react';
import {View, Text, TouchableOpacity, StyleSheet} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import {
  COLORS,
  SPACING,
  FONT_SIZE,
  BORDER_RADIUS,
  ICON_SIZE,
} from '../constants/theme';

export interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  action?: {label: string; onPress: () => void};
}

// Mirrors client/src/renderer/components/EmptyState.tsx. Drop-in for
// the inline emptyContainer/emptyText pattern that screens currently
// reinvent.
const EmptyState: React.FC<EmptyStateProps> = ({
  title,
  description,
  icon,
  action,
}) => {
  return (
    <View style={styles.container} accessibilityRole="text">
      {icon ? (
        <Ionicons
          name={icon}
          size={ICON_SIZE.hero * 2}
          color={COLORS.textMuted}
          style={styles.icon}
        />
      ) : null}
      <Text style={styles.title}>{title}</Text>
      {description ? (
        <Text style={styles.description}>{description}</Text>
      ) : null}
      {action ? (
        <TouchableOpacity
          onPress={action.onPress}
          style={styles.actionBtn}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel={action.label}>
          <Text style={styles.actionLabel}>{action.label}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.xl,
  },
  icon: {marginBottom: SPACING.md},
  title: {
    color: COLORS.text,
    fontSize: FONT_SIZE.xl,
    fontWeight: '600',
    textAlign: 'center',
  },
  description: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.md,
    marginTop: SPACING.sm,
    textAlign: 'center',
    maxWidth: 320,
    lineHeight: 20,
  },
  actionBtn: {
    marginTop: SPACING.lg,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm + 2,
    backgroundColor: COLORS.crimson,
    borderRadius: BORDER_RADIUS.md,
  },
  actionLabel: {
    color: COLORS.cream,
    fontSize: FONT_SIZE.md,
    fontWeight: '700',
  },
});

export default EmptyState;
