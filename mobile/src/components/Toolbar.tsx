import React from 'react';
import {View, TouchableOpacity, Text, StyleSheet} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import {COLORS, FONT_SIZE, BORDER_RADIUS, SPACING} from '../constants/theme';

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
    <Ionicons
      name={icon as keyof typeof Ionicons.glyphMap}
      size={20}
      color={disabled ? 'rgba(255, 255, 255, 0.3)' : COLORS.cream}
    />
  </TouchableOpacity>
);

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLORS.toolbarBg,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    height: 44,
  },
  navGroup: {flexDirection: 'row', gap: SPACING.xs},
  actionGroup: {flexDirection: 'row', gap: SPACING.xs},
  button: {
    width: 36,
    height: 36,
    borderRadius: BORDER_RADIUS.md, // matches web "rounded-lg" pill language
    backgroundColor: COLORS.toolbarBtn,
    borderWidth: 1,
    borderColor: COLORS.toolbarBtnBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonDisabled: {opacity: 0.4},
  sessionBadge: {
    backgroundColor: COLORS.crimson, // brand active state (was purple #667eea)
    paddingHorizontal: SPACING.md - 4,
    paddingVertical: SPACING.xs + 2,
    borderRadius: BORDER_RADIUS.lg,
  },
  sessionText: {color: COLORS.white, fontSize: FONT_SIZE.sm + 1, fontWeight: '600'},
});

export default Toolbar;
