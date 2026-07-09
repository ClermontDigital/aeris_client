import React, {useMemo} from 'react';
import {StyleSheet, useWindowDimensions, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import Svg, {Path} from 'react-native-svg';
import type {BottomTabBarProps} from '@react-navigation/bottom-tabs';
import {COLORS} from '../../constants/theme';
import {barTotalHeight, chromeHeight, domePath} from './navGeometry';

// Custom bottom-tab bar: paints the navy bar + centre dome and RESERVES the
// full chrome height (flat bar + dome protrusion) so screen content insets
// above the dome + the nested A button — no bottom-flush CTA can end up under
// the floating A. The dome is drawn INSIDE the bar's own bounds (the SVG
// canvas == the reserved height), so it never relies on overflow-visible
// (which Android clips). It is NON-interactive — the A button and the fan menu
// live in AerisNavButton, a full-screen sibling overlay. React Navigation
// props are unused; the bar has no per-tab buttons.
const AerisNotchBar: React.FC<BottomTabBarProps> = () => {
  const insets = useSafeAreaInsets();
  const {width} = useWindowDimensions();
  const barH = barTotalHeight(insets.bottom);
  const total = chromeHeight(insets.bottom); // == domePath's svgH
  const {d} = useMemo(() => domePath(width, barH), [width, barH]);

  return (
    <View style={[styles.wrap, {height: total}]} pointerEvents="none">
      <Svg width={width} height={total}>
        <Path d={d} fill={COLORS.navy} />
      </Svg>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {backgroundColor: 'transparent'},
});

export default AerisNotchBar;
