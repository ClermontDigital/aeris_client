import React, {useMemo} from 'react';
import {View, Image, StyleSheet, useWindowDimensions} from 'react-native';
import {SafeAreaView, useSafeAreaInsets} from 'react-native-safe-area-context';
import Svg, {Path} from 'react-native-svg';
import {COLORS} from '../constants/theme';

// Shared brand-header chrome — the navy band + cream tongue cutouts +
// centred AERIS wordmark. Used by AppTabs (under the tab navigator) and
// SettingsScreen (when the gear pushes Settings as a sibling stack screen)
// so the two surfaces render with identical chrome.
//
// Callers may pass children — they render INSIDE the SafeAreaView in the
// same coordinate space as the wordmark, so absolute-positioned overlays
// (mode chip, gear, back, failover banner) work the same way they always
// have. AppTabs in particular passes its ModeIndicator + FailoverBanners
// through here.

const BAND_TOP = 30;
// BAND_H is the vertical span of the Bezier shoulder — the curve from
// the top of the cream cutout down to where the tongue begins.
const BAND_H = 36;
const TONGUE_TOP_W = 200;
const TONGUE_BOTTOM_W = 140;
const TONGUE_PROTRUSION = 16;
const TONGUE_RADIUS = 14;

interface Props {
  children?: React.ReactNode;
}

export const BrandHeaderChrome: React.FC<Props> = ({children}) => {
  const insets = useSafeAreaInsets();
  const {width: screenWidth} = useWindowDimensions();

  // Chrome layout:
  //   y = 0          → screen top (behind status bar)
  //   y = cutoutTopY → top of the cream cutout. Above this the chrome
  //                    stays full-width (no taper into the safe area).
  //   y = bandY      → bottom of the Bezier shoulder = tongue starts
  //   y = tongueBottomY → bottom of the tongue
  const cutoutTopY = insets.top + BAND_TOP;
  const bandY = cutoutTopY + BAND_H;
  const tongueBottomY = bandY + TONGUE_PROTRUSION;
  const svgHeight = tongueBottomY;

  const paths = useMemo(() => {
    const cx = screenWidth / 2;
    const ttiL = cx - TONGUE_TOP_W / 2;
    const ttiR = cx + TONGUE_TOP_W / 2;
    const tbiL = cx - TONGUE_BOTTOM_W / 2;
    const tbiR = cx + TONGUE_BOTTOM_W / 2;
    return {
      // Cream cutout starts at cutoutTopY (NOT at SVG y=0) so the chrome
      // stays full-width from screen top down to cutoutTopY — wide navy
      // banner with sharp 90° outer corners. Bezier control at
      // (tbiL, cutoutTopY) / (tbiR, cutoutTopY) keeps horizontal tangent
      // at the chrome bottom edge and vertical tangent at the tongue side.
      creamLeft:
        `M 0 ${cutoutTopY} L ${ttiL} ${cutoutTopY} ` +
        `Q ${tbiL} ${cutoutTopY}, ${tbiL} ${bandY} ` +
        `L ${tbiL} ${tongueBottomY - TONGUE_RADIUS} ` +
        `A ${TONGUE_RADIUS} ${TONGUE_RADIUS} 0 0 0 ${tbiL + TONGUE_RADIUS} ${tongueBottomY} ` +
        `L 0 ${tongueBottomY} Z`,
      creamRight:
        `M ${screenWidth} ${cutoutTopY} L ${ttiR} ${cutoutTopY} ` +
        `Q ${tbiR} ${cutoutTopY}, ${tbiR} ${bandY} ` +
        `L ${tbiR} ${tongueBottomY - TONGUE_RADIUS} ` +
        `A ${TONGUE_RADIUS} ${TONGUE_RADIUS} 0 0 1 ${tbiR - TONGUE_RADIUS} ${tongueBottomY} ` +
        `L ${screenWidth} ${tongueBottomY} Z`,
      tongue:
        `M ${tbiL} ${bandY} L ${tbiR} ${bandY} ` +
        `L ${tbiR} ${tongueBottomY - TONGUE_RADIUS} ` +
        `A ${TONGUE_RADIUS} ${TONGUE_RADIUS} 0 0 1 ${tbiR - TONGUE_RADIUS} ${tongueBottomY} ` +
        `L ${tbiL + TONGUE_RADIUS} ${tongueBottomY} ` +
        `A ${TONGUE_RADIUS} ${TONGUE_RADIUS} 0 0 1 ${tbiL} ${tongueBottomY - TONGUE_RADIUS} Z`,
    };
  }, [screenWidth, cutoutTopY, bandY, tongueBottomY]);

  return (
    <SafeAreaView edges={['top']} style={styles.topBar}>
      {/* SVG sibling of topBarRow, absolute-positioned to cover from the
          SafeAreaView's outer top (behind the status bar) down past the
          tongue. Painting the chrome inside the SVG — rather than relying
          on SafeAreaView's bg — gives the chrome a continuous tapered
          silhouette with no 90° step at the safe area boundary. */}
      <View
        style={[styles.svgWrap, {height: svgHeight}]}
        pointerEvents="none">
        <Svg width={screenWidth} height={svgHeight}>
          <Path
            d={`M0 0 H${screenWidth} V${svgHeight} H0 Z`}
            fill={COLORS.background}
          />
          <Path
            d={`M0 0 H${screenWidth} V${bandY} H0 Z`}
            fill={COLORS.navy}
          />
          <Path d={paths.creamLeft} fill={COLORS.background} />
          <Path d={paths.creamRight} fill={COLORS.background} />
          <Path d={paths.tongue} fill={COLORS.navy} />
        </Svg>
      </View>
      <View style={styles.topBarRow}>
        <Image
          source={require('../../assets/images/aeris-wordmark.png')}
          style={styles.brandWordmark}
          accessibilityIgnoresInvertColors
          accessibilityLabel="Aeris"
          resizeMode="contain"
        />
      </View>
      {children}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  // SafeAreaView bg is transparent — the SVG paints the navy chrome rect
  // itself, including the safe-area zone. zIndex:2 keeps the SafeAreaView
  // (and its overflowing SVG — the tongue protrudes TONGUE_PROTRUSION px
  // past the SafeAreaView's box) above siblings that render later.
  topBar: {backgroundColor: 'transparent', overflow: 'visible', zIndex: 2},
  topBarRow: {
    minHeight: 76,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'visible',
  },
  // svgWrap covers the FULL chrome area, anchored at the SafeAreaView's
  // outer top (top:0 — position:absolute is relative to the padding edge,
  // which sits at the safe-area-view's outer top, not after its
  // paddingTop). The SVG inside is sized to bandY + TONGUE_PROTRUSION, so
  // it paints the chrome from behind the status bar down through the
  // tongue.
  svgWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
  },
  brandWordmark: {
    width: 130,
    height: 38,
    // Small upward nudge against the safe-area top — the wordmark was
    // sitting a touch low under the notch on iPhones with smaller bezels.
    marginTop: -6,
    marginBottom: -10,
    zIndex: 2,
  },
});
