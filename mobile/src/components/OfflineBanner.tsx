import React from 'react';
import {View, Text, TouchableOpacity, StyleSheet} from 'react-native';

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
    backgroundColor: '#e74c3c',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    gap: 16,
  },
  text: {color: '#fff', fontSize: 14, fontWeight: '500'},
  retry: {color: '#fff', fontSize: 14, fontWeight: '700', textDecorationLine: 'underline'},
});

export default OfflineBanner;
