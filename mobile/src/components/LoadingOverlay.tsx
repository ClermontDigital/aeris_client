import React from 'react';
import {View, ActivityIndicator, StyleSheet} from 'react-native';

interface Props {
  visible: boolean;
}

const LoadingOverlay: React.FC<Props> = ({visible}) => {
  if (!visible) return null;

  return (
    <View style={styles.overlay}>
      <ActivityIndicator size="large" color="#2c3e50" />
    </View>
  );
};

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255,255,255,0.8)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
});

export default LoadingOverlay;
