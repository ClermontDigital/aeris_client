import React from 'react';
import {View, Text, TouchableOpacity, StyleSheet} from 'react-native';
import {COLORS, FONT_SIZE, SPACING, BORDER_RADIUS} from '../constants/theme';
import type {SessionPublic} from '../types/session.types';

interface SessionCardProps {
  session: SessionPublic;
  isActive: boolean;
  onPress: () => void;
  onDelete: () => void;
}

const SessionCard: React.FC<SessionCardProps> = ({session, isActive, onPress, onDelete}) => {
  return (
    <TouchableOpacity
      style={[styles.card, isActive && styles.cardActive]}
      onPress={onPress}>
      <View style={styles.header}>
        <Text style={styles.name}>{session.name}</Text>
        {session.isLocked && <Text style={styles.lockIcon}>Locked</Text>}
      </View>
      <Text style={styles.lastAccessed}>
        Last used: {new Date(session.lastAccessedAt).toLocaleString()}
      </Text>
      <TouchableOpacity style={styles.deleteBtn} onPress={onDelete}>
        <Text style={styles.deleteText}>Delete</Text>
      </TouchableOpacity>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md,
    marginVertical: 4,
    marginHorizontal: SPACING.sm,
    borderWidth: 2,
    borderColor: COLORS.surfaceBorder,
    minWidth: 200,
  },
  cardActive: {borderColor: COLORS.crimson},
  header: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'},
  name: {fontSize: FONT_SIZE.lg, fontWeight: '600', color: COLORS.text},
  lockIcon: {fontSize: FONT_SIZE.xs + 2, color: COLORS.crimson, fontWeight: '600'},
  lastAccessed: {fontSize: FONT_SIZE.xs + 2, color: COLORS.textMuted, marginTop: 4},
  deleteBtn: {marginTop: SPACING.sm, alignSelf: 'flex-end'},
  deleteText: {color: COLORS.danger, fontSize: FONT_SIZE.sm + 1},
});

export default SessionCard;
