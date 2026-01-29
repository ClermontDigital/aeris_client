import React from 'react';
import {View, StyleSheet} from 'react-native';

interface Props {
  isConnected: boolean;
  isServerReachable: boolean;
}

const ConnectionIndicator: React.FC<Props> = ({isConnected, isServerReachable}) => {
  const color = !isConnected ? '#e74c3c' : isServerReachable ? '#27ae60' : '#f39c12';

  return <View style={[styles.dot, {backgroundColor: color}]} />;
};

const styles = StyleSheet.create({
  dot: {width: 10, height: 10, borderRadius: 5},
});

export default ConnectionIndicator;
