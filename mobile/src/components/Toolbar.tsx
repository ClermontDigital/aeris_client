import React from 'react';
import {View, TouchableOpacity, Text, StyleSheet} from 'react-native';

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
        <ToolButton label="<" onPress={onBack} disabled={!canGoBack} />
        <ToolButton label=">" onPress={onForward} disabled={!canGoForward} />
        <ToolButton label="R" onPress={onReload} />
        <ToolButton label="H" onPress={onHome} />
      </View>

      {showSessionButton && activeSessionName && (
        <TouchableOpacity style={styles.sessionBadge} onPress={onSessions}>
          <Text style={styles.sessionText}>{activeSessionName}</Text>
        </TouchableOpacity>
      )}

      <View style={styles.actionGroup}>
        <ToolButton label="P" onPress={onPrint} />
        {showSessionButton && <ToolButton label="L" onPress={onLock} />}
        <ToolButton label="S" onPress={onSettings} />
      </View>
    </View>
  );
};

const ToolButton: React.FC<{label: string; onPress: () => void; disabled?: boolean}> = ({
  label,
  onPress,
  disabled,
}) => (
  <TouchableOpacity
    style={[styles.button, disabled && styles.buttonDisabled]}
    onPress={onPress}
    disabled={disabled}>
    <Text style={[styles.buttonText, disabled && styles.buttonTextDisabled]}>{label}</Text>
  </TouchableOpacity>
);

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#2c3e50',
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
    backgroundColor: '#34495e',
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonDisabled: {opacity: 0.4},
  buttonText: {color: '#ecf0f1', fontSize: 16, fontWeight: '600'},
  buttonTextDisabled: {color: '#7f8c8d'},
  sessionBadge: {
    backgroundColor: '#27ae60',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  sessionText: {color: '#fff', fontSize: 13, fontWeight: '600'},
});

export default Toolbar;
