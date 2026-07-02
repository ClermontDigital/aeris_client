import React, {useMemo} from 'react';
import {StyleSheet, View} from 'react-native';
import {encodeCode128B} from '../utils/repairLabelHtml';
import {COLORS} from '../constants/theme';

interface BarcodePreviewProps {
  /** The value to encode (CODE128B). Repair numbers are REP-YYYYMMDD-NNNNNN. */
  value: string;
  /** Bar height in dp. */
  height?: number;
  /** Width of one module (narrowest bar) in dp. */
  moduleWidth?: number;
  /** Optional accessibility label; defaults to "Barcode for {value}". */
  accessibilityLabel?: string;
}

/**
 * On-screen CODE128 barcode preview built from RN <View> bars (NOT SVG /
 * HTML). Used in the RepairLabelPrintSheet preview so a technician can eyeball
 * the barcode before committing to a print. Shares encodeCode128B with the
 * print label (repairLabelHtml.ts), so a preview that renders here guarantees
 * the same module pattern the printed label carries.
 *
 * Coalesces consecutive equal modules into a single View per run to keep the
 * view count low (~40-80 rather than 244). Space runs render transparent so
 * the bar spacing is preserved.
 *
 * Renders null if the value can't be encoded (out-of-range char) — the caller
 * still shows the human-readable number, so nothing breaks.
 */
const BarcodePreview: React.FC<BarcodePreviewProps> = ({
  value,
  height = 56,
  moduleWidth = 1.5,
  accessibilityLabel,
}) => {
  const runs = useMemo(() => {
    const pattern = encodeCode128B(value);
    if (!pattern) return null;
    const out: Array<{key: string; width: number; bar: boolean}> = [];
    let runStart = 0;
    for (let i = 1; i <= pattern.length; i++) {
      if (i === pattern.length || pattern[i] !== pattern[runStart]) {
        out.push({
          key: `${runStart}-${i}`,
          width: (i - runStart) * moduleWidth,
          bar: pattern[runStart] === '1',
        });
        runStart = i;
      }
    }
    return out;
  }, [value, moduleWidth]);

  if (!runs) return null;

  return (
    <View
      style={[styles.row, {height}]}
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel ?? `Barcode for ${value}`}>
      {runs.map(run => (
        <View
          key={run.key}
          style={{
            width: run.width,
            height,
            backgroundColor: run.bar ? COLORS.text : COLORS.transparent,
          }}
        />
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'stretch',
    // White backing so a dark theme can't wash out the transparent space runs.
    backgroundColor: '#ffffff',
  },
});

export default BarcodePreview;
