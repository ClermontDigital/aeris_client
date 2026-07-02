import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {useNavigation, useRoute} from '@react-navigation/native';
import type {RouteProp} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import ApiClient from '../services/ApiClient';
import PrintService from '../services/PrintService';
import BarcodePreview from '../components/BarcodePreview';
import ErrorBanner from '../components/ErrorBanner';
import EyebrowLabel from '../components/EyebrowLabel';
import {useHaptics} from '../hooks/useHaptics';
import {useResponsiveLayout} from '../hooks/useResponsiveLayout';
import {useWorkspaceFeaturesStore} from '../stores/workspaceFeaturesStore';
import {RelayError} from '@aeris/shared';
import type {RepairDetail} from '../types/api.types';
import type {RepairsStackParamList} from '../types/navigation.types';
import {
  BORDER_RADIUS,
  COLORS,
  FONT_FAMILY,
  FONT_SIZE,
  SPACING,
} from '../constants/theme';
import {buildRepairLabelHtml} from '../utils/repairLabelHtml';

type Nav = NativeStackNavigationProp<
  RepairsStackParamList,
  'RepairLabelPrint'
>;
type RouteProps = RouteProp<RepairsStackParamList, 'RepairLabelPrint'>;

// Web parity: RepairBarcodeModal caps at 20 pieces.
const MAX_PIECES = 20;
const MIN_PIECES = 1;

/**
 * Builds the human-readable "device" summary used on the label. Falls back
 * across brand/model/device_type so a partial record still prints something
 * useful. Mirrors the web version's `${brand} ${model}`-with-fallbacks logic.
 */
function formatDeviceLine(repair: RepairDetail): string {
  const parts = [repair.brand, repair.model].filter(Boolean) as string[];
  if (parts.length > 0) return parts.join(' ');
  if (repair.device_type) return repair.device_type;
  return 'Device';
}

const RepairLabelPrintSheet: React.FC = () => {
  const navigation = useNavigation<Nav>();
  const route = useRoute<RouteProps>();
  const haptics = useHaptics();
  const {isTablet} = useResponsiveLayout();
  const tabletCap = isTablet
    ? ({maxWidth: 560, alignSelf: 'center', width: '100%'} as const)
    : null;
  const {id: repairId} = route.params;

  // ---------------- state (hooks above early-return guards) ----------------
  const [repair, setRepair] = useState<RepairDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pieces, setPieces] = useState(1);
  const [printing, setPrinting] = useState(false);

  // Sync guard so a 60Hz double-tap on Print can't fire two AirPrint dialogs.
  const printLockRef = useRef(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const data = await ApiClient.getRepairDetail(repairId);
      if (data == null) {
        setLoadError('Repair not found or was deleted.');
      } else {
        setRepair(data);
      }
    } catch (e) {
      const msg =
        e instanceof RelayError
          ? e.message
          : 'Could not load the repair. Please try again.';
      setLoadError(msg);
    } finally {
      setIsLoading(false);
    }
  }, [repairId]);

  useEffect(() => {
    load();
  }, [load]);

  // Workspace flag guard — matches every other repair screen (T7-006).
  useEffect(() => {
    if (!useWorkspaceFeaturesStore.getState().repairs_enabled) {
      Alert.alert('Repairs', 'Repairs are not enabled for this site.');
      navigation.goBack();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCancel = useCallback(() => {
    if (printing) return;
    haptics.light();
    navigation.goBack();
  }, [navigation, haptics, printing]);

  const handleDecrement = useCallback(() => {
    haptics.selection();
    setPieces(p => Math.max(MIN_PIECES, p - 1));
  }, [haptics]);

  const handleIncrement = useCallback(() => {
    haptics.selection();
    setPieces(p => Math.min(MAX_PIECES, p + 1));
  }, [haptics]);

  const handlePrint = useCallback(async () => {
    if (printLockRef.current) return;
    if (!repair) return;
    printLockRef.current = true;
    setPrinting(true);
    try {
      const html = buildRepairLabelHtml({
        repairNumber: repair.repair_number,
        customerName: repair.customer?.name ?? repair.customer_name ?? 'Customer',
        device: formatDeviceLine(repair),
        receivedAt: repair.received_at,
        pieces,
      });
      // PrintService.printHtml → AirPrint on iOS, print intent on Android.
      // Cancellation from the native dialog is swallowed silently by the
      // service (it inspects the error message for "cancel"). Failure surfaces
      // an in-service Alert with a share-sheet fallback so the operator can
      // still get the HTML off the device.
      await PrintService.printHtml(html);
      haptics.success();
      navigation.goBack();
    } catch (e) {
      haptics.error();
      const msg =
        e instanceof Error ? e.message : 'Failed to send the label to the printer.';
      Alert.alert('Print failed', msg);
    } finally {
      printLockRef.current = false;
      setPrinting(false);
    }
  }, [repair, pieces, navigation, haptics]);

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container} edges={['left', 'right', 'bottom']}>
        <View style={styles.header}>
          <TouchableOpacity
            onPress={handleCancel}
            accessibilityRole="button"
            accessibilityLabel="Cancel">
            <Text style={styles.headerCancel}>Cancel</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Print Repair Label</Text>
          <Text style={styles.headerSpacer}>{'  '}</Text>
        </View>
        <View style={styles.center}>
          <ActivityIndicator color={COLORS.accent} size="large" />
          <Text style={styles.loadingText}>Loading repair…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (loadError || !repair) {
    return (
      <SafeAreaView style={styles.container} edges={['left', 'right', 'bottom']}>
        <View style={styles.header}>
          <TouchableOpacity
            onPress={handleCancel}
            accessibilityRole="button"
            accessibilityLabel="Cancel">
            <Text style={styles.headerCancel}>Cancel</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Print Repair Label</Text>
          <Text style={styles.headerSpacer}>{'  '}</Text>
        </View>
        <View style={styles.bannerWrap}>
          <ErrorBanner
            message={loadError ?? 'Repair unavailable.'}
            onRetry={() => {
              haptics.light();
              load();
            }}
          />
        </View>
      </SafeAreaView>
    );
  }

  const customerName =
    repair.customer?.name ?? repair.customer_name ?? 'Customer';
  const deviceLine = formatDeviceLine(repair);
  const canDecrement = pieces > MIN_PIECES && !printing;
  const canIncrement = pieces < MAX_PIECES && !printing;
  const printLabel =
    pieces > 1 ? `Print ${pieces} labels` : 'Print label';

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={handleCancel}
          disabled={printing}
          accessibilityRole="button"
          accessibilityLabel="Cancel"
          hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}>
          <Text
            style={[
              styles.headerCancel,
              printing ? styles.headerActionDisabled : null,
            ]}>
            Cancel
          </Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Print Repair Label</Text>
        <TouchableOpacity
          onPress={handlePrint}
          disabled={printing}
          accessibilityRole="button"
          accessibilityLabel={printLabel}
          accessibilityState={{disabled: printing}}
          hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}>
          <Text
            style={[
              styles.headerSave,
              printing ? styles.headerActionDisabled : null,
            ]}>
            {printing ? 'Printing…' : 'Print'}
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, tabletCap]}
        keyboardShouldPersistTaps="handled">
        <Text style={styles.blurb}>
          Attach a label to each item left for this repair. Each label carries a
          scannable CODE128 of the repair number so the item can be matched back
          to this job with the Repairs tab scanner.
        </Text>

        {/* Preview card — mirrors the boxed layout on the web version.
            The BarcodePreview renders the same CODE128 pattern the printed
            label carries (shared encodeCode128B), so what shows here is what
            AirPrint puts on the sticker. */}
        <View style={styles.previewCard}>
          <EyebrowLabel>Repair</EyebrowLabel>
          <View style={styles.previewBarcode}>
            <BarcodePreview value={repair.repair_number} />
          </View>
          <Text style={styles.previewRepairNumber}>{repair.repair_number}</Text>
          <Text style={styles.previewCustomer}>{customerName}</Text>
          <Text style={styles.previewDevice} numberOfLines={1}>
            {deviceLine}
          </Text>
        </View>

        <View style={styles.section}>
          <EyebrowLabel>Pieces to label</EyebrowLabel>
          <Text style={styles.helperText}>One label printed per piece</Text>
          <View style={styles.stepperRow}>
            <TouchableOpacity
              style={[
                styles.stepperBtn,
                canDecrement ? null : styles.stepperBtnDisabled,
              ]}
              onPress={handleDecrement}
              disabled={!canDecrement}
              accessibilityRole="button"
              accessibilityLabel="Fewer pieces"
              accessibilityState={{disabled: !canDecrement}}>
              <Text style={styles.stepperBtnText}>−</Text>
            </TouchableOpacity>
            <Text
              style={styles.stepperValue}
              accessibilityLabel={`Pieces: ${pieces}`}>
              {pieces}
            </Text>
            <TouchableOpacity
              style={[
                styles.stepperBtn,
                canIncrement ? null : styles.stepperBtnDisabled,
              ]}
              onPress={handleIncrement}
              disabled={!canIncrement}
              accessibilityRole="button"
              accessibilityLabel="More pieces"
              accessibilityState={{disabled: !canIncrement}}>
              <Text style={styles.stepperBtnText}>+</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING.lg,
  },
  loadingText: {
    marginTop: SPACING.md,
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.sm,
    fontFamily: FONT_FAMILY.medium,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.surfaceBorder,
    backgroundColor: COLORS.surface,
  },
  headerCancel: {
    color: COLORS.navy,
    fontSize: FONT_SIZE.md,
    fontFamily: FONT_FAMILY.medium,
  },
  headerTitle: {
    color: COLORS.text,
    fontSize: FONT_SIZE.lg,
    fontFamily: FONT_FAMILY.semibold,
  },
  headerSave: {
    color: COLORS.crimson,
    fontSize: FONT_SIZE.md,
    fontFamily: FONT_FAMILY.semibold,
  },
  headerActionDisabled: {
    opacity: 0.4,
  },
  headerSpacer: {
    color: COLORS.transparent,
    fontSize: FONT_SIZE.md,
  },
  scroll: {
    padding: SPACING.lg,
    paddingBottom: SPACING.xxl,
  },
  bannerWrap: {
    padding: SPACING.md,
  },
  blurb: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.sm,
    fontFamily: FONT_FAMILY.regular,
    marginBottom: SPACING.lg,
    lineHeight: 20,
  },
  previewCard: {
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: COLORS.surfaceBorder,
    backgroundColor: COLORS.surface,
    padding: SPACING.md,
    alignItems: 'center',
    marginBottom: SPACING.lg,
  },
  previewBarcode: {
    marginTop: SPACING.sm,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    backgroundColor: '#ffffff',
    borderRadius: BORDER_RADIUS.sm,
  },
  previewRepairNumber: {
    color: COLORS.text,
    fontSize: FONT_SIZE.lg,
    fontFamily: FONT_FAMILY.semibold,
    marginTop: SPACING.xs,
    letterSpacing: 1.2,
  },
  previewCustomer: {
    color: COLORS.text,
    fontSize: FONT_SIZE.md,
    fontFamily: FONT_FAMILY.semibold,
    marginTop: SPACING.xs,
  },
  previewDevice: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.sm,
    fontFamily: FONT_FAMILY.medium,
    marginTop: 2,
    maxWidth: '100%',
  },
  section: {
    marginTop: SPACING.md,
    marginBottom: SPACING.md,
  },
  helperText: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.xs,
    fontFamily: FONT_FAMILY.regular,
    marginBottom: SPACING.sm,
  },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.lg,
    paddingVertical: SPACING.md,
  },
  stepperBtn: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 1,
    borderColor: COLORS.inputBorder,
    backgroundColor: COLORS.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperBtnDisabled: {
    opacity: 0.4,
  },
  stepperBtnText: {
    color: COLORS.text,
    fontSize: 28,
    fontFamily: FONT_FAMILY.semibold,
    lineHeight: 30,
  },
  stepperValue: {
    minWidth: 60,
    textAlign: 'center',
    color: COLORS.text,
    fontSize: 28,
    fontFamily: FONT_FAMILY.semibold,
  },
});

export default RepairLabelPrintSheet;
