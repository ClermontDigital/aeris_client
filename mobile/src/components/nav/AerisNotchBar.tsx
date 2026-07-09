import React from 'react';
import {StyleSheet, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import type {BottomTabBarProps} from '@react-navigation/bottom-tabs';
import {COLORS} from '../../constants/theme';
import {barTotalHeight} from './navGeometry';

// Custom bottom-tab bar: a plain full-width OPAQUE navy strip. It reserves the
// tab-bar layout height (barTotalHeight), so screen content insets to its top
// edge and scrolls behind it — no per-tab buttons, no cream cutouts. The navy
// dome cap + the A + the fan are drawn by AerisNavButton (a full-screen sibling
// overlay), so the dome can float over scrolling content unclipped. React
// Navigation props are unused.
const AerisNotchBar: React.FC<BottomTabBarProps> = () => {
  const insets = useSafeAreaInsets();
  return <View style={[styles.bar, {height: barTotalHeight(insets.bottom)}]} />;
};

const styles = StyleSheet.create({
  bar: {backgroundColor: COLORS.navy},
});

export default AerisNotchBar;
