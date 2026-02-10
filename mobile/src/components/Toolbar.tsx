import React from 'react';
import {View, TouchableOpacity, Text, StyleSheet} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';

interface ToolbarProps {
  canGoBack: boolean;
  canGoForward: boolean;
  onBack: () => void;
  onForward: () => void;
  onReload: () => void;
  onHome: () => void;
  onPrint: () => void;
  onLock: () => void;
  onSettings: () => void;
  onSessions?: () => void;
  showSessionButton: boolean;
  activeSessionName?: string;
}

const Toolbar: React.FC<ToolbarProps> = ({
  canGoBack,
  canGoForward,
  onBack,
  onForward,
  onReload,
  onHome,
  onPrint,
  onLock,
  onSettings,
  onSessions,
  showSessionButton,
  activeSessionName,
}) => {
  return (
    <View style={styles.container}>
      <View style={styles.navGroup}>
        <ToolButton icon="chevron-back" onPress={onBack} disabled={!canGoBack} />
        <ToolButton icon="chevron-forward" onPress={onForward} disabled={!canGoForward} />
        <ToolButton icon="reload" onPress={onReload} />
        <ToolButton icon="home" onPress={onHome} />
      </View>

      {showSessionButton && activeSessionName && (
        <TouchableOpacity style={styles.sessionBadge} onPress={onSessions}>
          <Text style={styles.sessionText}>{activeSessionName}</Text>
        </TouchableOpacity>
      )}

      <View style={styles.actionGroup}>
        <ToolButton icon="print" onPress={onPrint} />
        {showSessionButton && <ToolButton icon="lock-closed" onPress={onLock} />}
        <ToolButton icon="settings" onPress={onSettings} />
      </View>
    </View>
  );
};

const ToolButton: React.FC<{icon: string; onPress: () => void; disabled?: boolean}> = ({
  icon,
  onPress,
  disabled,
}) => (
  <TouchableOpacity
    style={[styles.button, disabled && styles.buttonDisabled]}
    onPress={onPress}
    disabled={disabled}>
    <Icon
      name={icon}
      size={20}
      color={disabled ? 'rgba(255, 255, 255, 0.3)' : '#e2e8f0'}
    />
  </TouchableOpacity>
);

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#003049',
    paddingHorizontal: 8,
    paddingVertical: 4,
    height: 44,
  },
  navGroup: {flexDirection: 'row', gap: 4},
  actionGroup: {flexDirection: 'row', gap: 4},
  button: {
    width: 36,
    height: 36,
    borderRadius: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonDisabled: {opacity: 0.4},
  sessionBadge: {
    backgroundColor: '#667eea',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  sessionText: {color: '#fff', fontSize: 13, fontWeight: '600'},
});

export default Toolbar;
