import React from 'react';
import {View, ActivityIndicator, StyleSheet} from 'react-native';
import {COLORS} from '../constants/theme';

interface Props {
  visible: boolean;
}

const LoadingOverlay: React.FC<Props> = ({visible}) => {
  if (!visible) return null;

  return (
    <View style={styles.overlay}>
      <ActivityIndicator size="large" color={COLORS.cream} />
    </View>
  );
};

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    // Navy scrim — was a white-on-cream flash before. The app body is cream
    // now, so the overlay needs to be darker than the body to read as a
    // loading state.
    backgroundColor: COLORS.overlayBg,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
});

export default LoadingOverlay;
