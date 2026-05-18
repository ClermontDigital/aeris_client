import React from 'react';
import {View, StyleSheet} from 'react-native';
import {COLORS} from '../constants/theme';

interface Props {
  isConnected: boolean;
  isServerReachable: boolean;
}

const ConnectionIndicator: React.FC<Props> = ({isConnected, isServerReachable}) => {
  const color = !isConnected
    ? COLORS.danger
    : isServerReachable
    ? COLORS.success
    : COLORS.warning;

  return <View style={[styles.dot, {backgroundColor: color}]} />;
};

const styles = StyleSheet.create({
  dot: {width: 10, height: 10, borderRadius: 5},
});

export default ConnectionIndicator;
