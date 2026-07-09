import React, {useMemo} from 'react';
import {StyleSheet, useWindowDimensions, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import Svg, {Path} from 'react-native-svg';
import type {BottomTabBarProps} from '@react-navigation/bottom-tabs';
import {COLORS} from '../../constants/theme';
import {barTotalHeight, domePath, PROTRUSION} from './navGeometry';

// Custom bottom-tab bar: paints the navy bar + centre dome and reserves the
// bar's layout height (so screens inset above it). It is NON-interactive — the
// A button and the fan menu live in AerisNavButton, a full-screen sibling
// overlay that can't be touch-clipped by this bar's bounds. Props from
// React Navigation are unused; the bar has no per-tab buttons.
const AerisNotchBar: React.FC<BottomTabBarProps> = () => {
  const insets = useSafeAreaInsets();
  const {width} = useWindowDimensions();
  const barH = barTotalHeight(insets.bottom);
  const {d, svgH} = useMemo(() => domePath(width, barH), [width, barH]);

  return (
    <View style={[styles.wrap, {height: barH}]} pointerEvents="none">
      {/* The SVG overhangs the bar upward by PROTRUSION to draw the dome;
          overflow is visible (matches BrandHeaderChrome's protruding tongue). */}
      <View style={[styles.svgWrap, {height: svgH, top: -PROTRUSION}]}>
        <Svg width={width} height={svgH}>
          <Path d={d} fill={COLORS.navy} />
        </Svg>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {backgroundColor: 'transparent', overflow: 'visible'},
  svgWrap: {position: 'absolute', left: 0, right: 0},
});

export default AerisNotchBar;
