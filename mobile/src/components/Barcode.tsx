import React, {useMemo} from 'react';
import {View, StyleSheet, Text} from 'react-native';
import Svg, {Rect} from 'react-native-svg';
import {COLORS, FONT_FAMILY, FONT_SIZE, SPACING} from '../constants/theme';

// Pure-JS Code128 (Set B) SVG renderer. Avoids pulling in a barcode-rendering
// dependency — react-native-svg is already on board. Set B was chosen because
// it covers every printable ASCII char (32–127), including digits + mixed
// case, which is what AERIS product barcodes use in practice.
//
// Why render in-app at all: the View Item screen needs to show a scannable
// barcode so a second staff member can point their AERIS app's scanner at
// this device's screen and pull the same item up — the "share-by-scan" flow
// in the product brief.

const CODE128_PATTERNS: readonly string[] = [
  '212222', '222122', '222221', '121223', '121322',
  '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231',
  '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222',
  '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123',
  '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131',
  '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123',
  '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422',
  '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211',
  '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112',
  '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141',
  '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214',
  '211232',
];

// Stop pattern: 7 elements (B-S-B-S-B-S-B), 13 modules total. Spec literal —
// '2331112' encodes bar-2 space-3 bar-3 space-1 bar-1 space-1 bar-2. Stored
// separately because it doesn't share the 6-element layout of codes 0..102.
const CODE128_STOP = '2331112';

const START_B = 104;

// Encode an ASCII string into a Code128B module-width sequence.
// Returns null when the input contains chars outside Code128B's 32–127 range
// so the caller can fall back to a plain-text display rather than render a
// garbled barcode the scanner will refuse.
// Exported so callers can skip rendering a "Share by scan" affordance for
// values the encoder will refuse — keeps the UI honest rather than showing
// a placeholder card with no scannable content.
export function canEncodeCode128B(value: string): boolean {
  if (!value) return false;
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c < 32 || c > 127) return false;
  }
  return true;
}

function encodeCode128B(value: string): number[] | null {
  const codes: number[] = [START_B];
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c < 32 || c > 127) return null;
    codes.push(c - 32);
  }
  // Checksum = (Start + Σ(position × code)) mod 103 over the data codes.
  // Position is 1-indexed starting from the first data code.
  let sum = START_B;
  for (let i = 1; i < codes.length; i++) {
    sum += i * codes[i];
  }
  codes.push(sum % 103);

  // Expand each code into its 6-element bar/space widths, then append the
  // 7-element stop pattern. STOP is only emitted here (it's never pushed
  // into `codes`), so there's no risk of a double-stop.
  const widths: number[] = [];
  for (const code of codes) {
    const pattern = CODE128_PATTERNS[code];
    if (!pattern) return null;
    for (const ch of pattern) widths.push(Number.parseInt(ch, 10));
  }
  for (const ch of CODE128_STOP) widths.push(Number.parseInt(ch, 10));
  return widths;
}

interface BarcodeProps {
  value: string;
  // Target render width in pixels. The module width is derived so the symbol
  // (plus quiet zones) fills `width`. Default is sized to fit a phone card.
  width?: number;
  height?: number;
  // Whether to render the human-readable value beneath the bars. Default on
  // because operators commonly type the value if scanning fails.
  showText?: boolean;
}

const QUIET_MODULES = 10; // 10× module width quiet zone per Code128 spec.

const Barcode: React.FC<BarcodeProps> = ({
  value,
  width = 280,
  height = 80,
  showText = true,
}) => {
  const trimmed = (value ?? '').trim();
  // Single memo block handles encoding + the bar/space walk. This component
  // is mounted on ProductDetail which re-renders on stock optimistic updates
  // and focus refetches; without memoizing the derived rects we'd rebuild
  // them every render even though the input value is stable.
  const encoded = useMemo(() => {
    const widths = trimmed ? encodeCode128B(trimmed) : null;
    if (!widths) return null;
    const symbolModules = widths.reduce((acc, w) => acc + w, 0);
    const totalModules = symbolModules + QUIET_MODULES * 2;
    // Walk the widths array, alternating bar/space. Start with a bar, then
    // every other run is a space (skip emitting rects for spaces).
    const rects: Array<{x: number; w: number}> = [];
    let cursor = QUIET_MODULES;
    for (let i = 0; i < widths.length; i++) {
      const w = widths[i];
      if (i % 2 === 0) rects.push({x: cursor, w});
      cursor += w;
    }
    return {totalModules, rects};
  }, [trimmed]);

  if (!trimmed || !encoded) {
    return (
      <View style={[styles.container, {width, minHeight: height}]}>
        <Text style={styles.placeholder}>No barcode</Text>
      </View>
    );
  }

  const {totalModules, rects} = encoded;
  const barAreaHeight = showText ? Math.max(40, height - 22) : height;

  return (
    <View style={[styles.container, {width}]} accessibilityLabel={`Barcode ${trimmed}`}>
      <Svg
        width={width}
        height={barAreaHeight}
        viewBox={`0 0 ${totalModules} ${barAreaHeight}`}
        preserveAspectRatio="none">
        {/* Pure-white background so the scanner sees full quiet zones even
            if the card behind us is cream-tinted. Critical for scan rates. */}
        <Rect x={0} y={0} width={totalModules} height={barAreaHeight} fill={COLORS.white} />
        {rects.map((r, i) => (
          <Rect
            key={i}
            x={r.x}
            y={0}
            width={r.w}
            height={barAreaHeight}
            fill={COLORS.black}
          />
        ))}
      </Svg>
      {showText ? <Text style={styles.label}>{trimmed}</Text> : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    backgroundColor: COLORS.white,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.sm,
    borderRadius: 8,
  },
  label: {
    marginTop: SPACING.xs,
    color: COLORS.text,
    fontFamily: FONT_FAMILY.medium,
    fontSize: FONT_SIZE.sm,
    letterSpacing: 1,
  },
  placeholder: {
    color: COLORS.textDim,
    fontFamily: FONT_FAMILY.medium,
    fontSize: FONT_SIZE.sm,
  },
});

export default Barcode;
