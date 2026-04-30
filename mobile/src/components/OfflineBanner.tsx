import React from 'react';
import {View, Text, TouchableOpacity, StyleSheet} from 'react-native';
import {COLORS, FONT_SIZE, SPACING} from '../constants/theme';

interface Props {
  isConnected: boolean;
  isServerReachable: boolean;
  onRetry: () => void;
}

const OfflineBanner: React.FC<Props> = ({isConnected, isServerReachable, onRetry}) => {
  if (isConnected && isServerReachable) return null;

  const message = !isConnected
    ? 'No network connection'
    : 'Cannot reach Aeris server';

  return (
    <View style={styles.banner}>
      <Text style={styles.text}>{message}</Text>
      <TouchableOpacity onPress={onRetry}>
        <Text style={styles.retry}>Retry</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  banner: {
    backgroundColor: COLORS.crimson,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: SPACING.sm,
    gap: SPACING.md,
  },
  text: {color: COLORS.cream, fontSize: FONT_SIZE.md, fontWeight: '500'},
  retry: {color: COLORS.cream, fontSize: FONT_SIZE.md, fontWeight: '700', textDecorationLine: 'underline'},
});

export default OfflineBanner;
