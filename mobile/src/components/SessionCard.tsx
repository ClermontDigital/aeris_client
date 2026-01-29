import React from 'react';
import {View, Text, TouchableOpacity, StyleSheet} from 'react-native';
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
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 16,
    marginVertical: 4,
    marginHorizontal: 8,
    borderWidth: 2,
    borderColor: '#ddd',
    minWidth: 200,
  },
  cardActive: {borderColor: '#27ae60'},
  header: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'},
  name: {fontSize: 16, fontWeight: '600', color: '#2c3e50'},
  lockIcon: {fontSize: 12, color: '#e74c3c', fontWeight: '600'},
  lastAccessed: {fontSize: 12, color: '#7f8c8d', marginTop: 4},
  deleteBtn: {marginTop: 8, alignSelf: 'flex-end'},
  deleteText: {color: '#e74c3c', fontSize: 13},
});

export default SessionCard;
