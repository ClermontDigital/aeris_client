import React, {useState, useMemo, useEffect, useCallback, useRef} from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import Modal from 'react-native-modal';
import EyebrowLabel from './EyebrowLabel';
import PillButton from './PillButton';
import ErrorBanner from './ErrorBanner';
import {
  COLORS,
  SPACING,
  FONT_SIZE,
  FONT_FAMILY,
  BORDER_RADIUS,
} from '../constants/theme';
import ApiClient from '../services/ApiClient';
import {useHaptics} from '../hooks/useHaptics';
import {useResponsiveLayout} from '../hooks/useResponsiveLayout';
import {useProductCacheStore} from '../stores/productCacheStore';
import {useTransactionActivityStore} from '../stores/transactionActivityStore';
import type {StockAdjustmentReason} from '../types/api.types';

// Mode mirrors the operator's mental model — "I counted N" vs "I broke 1".
// Both compile to a signed `adjustment` per shared/StockAdjustmentInput.
type Mode = 'delta' | 'absolute';

// Reason values are the closed enum from shared's StockAdjustmentReason —
// labels are operator-friendly sentence case (Brand Guidelines v0.3 §05).
const REASON_OPTIONS: ReadonlyArray<{value: StockAdjustmentReason; label: string}> = [
  {value: 'count_correction', label: 'Stocktake'},
  {value: 'damaged_goods', label: 'Damaged'},
  {value: 'return_to_stock', label: 'Returned'},
  {value: 'found_stock', label: 'Found stock'},
  {value: 'theft_loss', label: 'Theft / loss'},
  {value: 'expired_goods', label: 'Expired'},
  {value: 'supplier_error', label: 'Supplier error'},
  {value: 'manual_adjustment', label: 'Manual adjustment'},
  {value: 'other', label: 'Other'},
];

export interface StockAdjustModalProps {
  productId: number;
  productName: string;
  currentStock: number;
  visible: boolean;
  onClose: () => void;
  onAdjusted: (newQuantity: number) => void;
}

const StockAdjustModal: React.FC<StockAdjustModalProps> = ({
  productId,
  productName,
  currentStock,
  visible,
  onClose,
  onAdjusted,
}) => {
  const haptics = useHaptics();
  const {isTablet} = useResponsiveLayout();
  const tabletCap = isTablet
    ? ({maxWidth: 560, alignSelf: 'center', width: '100%'} as const)
    : null;

  const [mode, setMode] = useState<Mode>('delta');
  // Raw strings so an empty field stays empty (vs "0" which would fail the
  // "non-zero" validation only after first edit). Sign is preserved in the
  // delta string so "-3" parses cleanly via parseInt.
  const [deltaText, setDeltaText] = useState('');
  const [absoluteText, setAbsoluteText] = useState('');
  const [reason, setReason] = useState<StockAdjustmentReason | null>(null);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset every field when the modal opens — without this, reopening the
  // modal on a new product would surface the previous adjustment, which
  // operator-tested badly.
  useEffect(() => {
    if (visible) {
      setMode('delta');
      setDeltaText('');
      setAbsoluteText('');
      setReason(null);
      setNotes('');
      setSubmitting(false);
      setError(null);
    }
  }, [visible]);

  // Parse the active input → signed delta. Returns null when the field is
  // empty/non-numeric/zero so the submit button can stay disabled.
  const {delta, projected} = useMemo(() => {
    if (mode === 'delta') {
      const n = parseInt(deltaText, 10);
      if (Number.isNaN(n) || n === 0) return {delta: null, projected: currentStock};
      return {delta: n, projected: currentStock + n};
    }
    const target = parseInt(absoluteText, 10);
    if (Number.isNaN(target)) return {delta: null, projected: currentStock};
    const d = target - currentStock;
    if (d === 0) return {delta: null, projected: target};
    return {delta: d, projected: target};
  }, [mode, deltaText, absoluteText, currentStock]);

  const canSubmit =
    !submitting && delta !== null && reason !== null && projected >= 0;

  // Synchronous double-tap guard. `setSubmitting` is async; a 60Hz
  // double-tap can fire two adjustStock calls before the disabled state
  // takes effect. The ref flips before any await.
  const submitLockRef = useRef(false);
  const syncProducts = useProductCacheStore(s => s.syncProducts);

  const handleSubmit = useCallback(async () => {
    if (submitLockRef.current) return;
    if (!canSubmit || delta === null || reason === null) return;
    submitLockRef.current = true;
    setSubmitting(true);
    setError(null);
    // BLOCKER-2 (§19.2 rule 1): a stock adjustment is an in-flight write the
    // auto-failover swap must not drop mid-POST. Mark it so Rule 1 defers any
    // auto-swap until the write completes.
    useTransactionActivityStore.getState().setSettlementOrPrintInFlight(true);
    try {
      const result = await ApiClient.adjustStock({
        product_id: productId,
        adjustment: delta,
        reason,
        ...(notes.trim() ? {notes: notes.trim()} : {}),
      });
      haptics.success();
      // Fire-and-forget invalidate the catalog cache so QuickSale's
      // product grid + ItemsScreen's Low/Out tiles reflect the new
      // stock level at next mount.
      void syncProducts();
      onAdjusted(result.new_quantity);
      onClose();
    } catch (e) {
      haptics.error();
      setError(e instanceof Error ? e.message : 'Failed to adjust stock');
    } finally {
      setSubmitting(false);
      submitLockRef.current = false;
      useTransactionActivityStore.getState().setSettlementOrPrintInFlight(false);
    }
  }, [canSubmit, delta, reason, productId, notes, haptics, onAdjusted, onClose, syncProducts]);

  return (
    <Modal
      isVisible={visible}
      onBackdropPress={submitting ? undefined : onClose}
      onBackButtonPress={submitting ? undefined : onClose}
      backdropColor={COLORS.modalBg}
      backdropOpacity={1}
      style={styles.modal}
      avoidKeyboard
      useNativeDriver>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[styles.sheet, tabletCap]}>
          <ScrollView
            contentContainerStyle={styles.scroll}
            keyboardShouldPersistTaps="handled">
            <EyebrowLabel>Adjust stock</EyebrowLabel>
            <Text style={styles.title} numberOfLines={2}>
              {productName}
            </Text>
            <View style={styles.currentRow}>
              <Text style={styles.currentLabel}>Current on hand</Text>
              <Text style={styles.currentValue}>{currentStock}</Text>
            </View>

            {error ? (
              <View style={styles.bannerWrap}>
                <ErrorBanner
                  message={error}
                  onDismiss={() => setError(null)}
                />
              </View>
            ) : null}

            <View style={styles.modeRow} accessibilityRole="tablist">
              <TouchableOpacity
                style={[styles.modeBtn, mode === 'delta' && styles.modeBtnActive]}
                onPress={() => {
                  haptics.selection();
                  setMode('delta');
                }}
                accessibilityRole="button"
                accessibilityLabel="Adjust by amount"
                accessibilityState={{selected: mode === 'delta'}}>
                <Text
                  style={[
                    styles.modeText,
                    mode === 'delta' && styles.modeTextActive,
                  ]}>
                  Adjust by...
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.modeBtn,
                  mode === 'absolute' && styles.modeBtnActive,
                ]}
                onPress={() => {
                  haptics.selection();
                  setMode('absolute');
                }}
                accessibilityRole="button"
                accessibilityLabel="Set absolute amount"
                accessibilityState={{selected: mode === 'absolute'}}>
                <Text
                  style={[
                    styles.modeText,
                    mode === 'absolute' && styles.modeTextActive,
                  ]}>
                  Set to...
                </Text>
              </TouchableOpacity>
            </View>

            {mode === 'delta' ? (
              <View style={styles.field}>
                <Text style={styles.label}>Change by (use minus for shrink)</Text>
                <TextInput
                  style={styles.input}
                  value={deltaText}
                  onChangeText={setDeltaText}
                  // Signed integer keypad — iOS exposes the minus; Android
                  // does too via 'numbers-and-punctuation'.
                  keyboardType={
                    Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'numeric'
                  }
                  placeholder="e.g. -2 or 10"
                  placeholderTextColor={COLORS.inputPlaceholder}
                  accessibilityLabel="Stock change amount"
                />
              </View>
            ) : (
              <View style={styles.field}>
                <Text style={styles.label}>New on-hand quantity</Text>
                <TextInput
                  style={styles.input}
                  value={absoluteText}
                  onChangeText={setAbsoluteText}
                  keyboardType="number-pad"
                  placeholder="e.g. 42"
                  placeholderTextColor={COLORS.inputPlaceholder}
                  accessibilityLabel="New on-hand quantity"
                />
              </View>
            )}

            <View style={styles.projectedRow}>
              <Text style={styles.projectedLabel}>New on hand</Text>
              <Text
                style={[
                  styles.projectedValue,
                  projected < 0 && styles.projectedNegative,
                ]}>
                {projected}
                {delta !== null ? (
                  <Text style={styles.deltaHint}>
                    {'  '}
                    {delta > 0 ? '+' : ''}
                    {delta}
                  </Text>
                ) : null}
              </Text>
            </View>
            {projected < 0 ? (
              <Text style={styles.warning}>
                Adjustment would leave stock negative.
              </Text>
            ) : null}

            <View style={styles.field}>
              <Text style={styles.label}>Reason</Text>
              <View style={styles.reasonGrid}>
                {REASON_OPTIONS.map(opt => {
                  const selected = reason === opt.value;
                  return (
                    <TouchableOpacity
                      key={opt.value}
                      style={[
                        styles.reasonChip,
                        selected && styles.reasonChipActive,
                      ]}
                      onPress={() => {
                        haptics.selection();
                        setReason(opt.value);
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={`Reason: ${opt.label}`}
                      accessibilityState={{selected}}>
                      <Text
                        style={[
                          styles.reasonChipText,
                          selected && styles.reasonChipTextActive,
                        ]}>
                        {opt.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>Notes (optional)</Text>
              <TextInput
                style={[styles.input, styles.notesInput]}
                value={notes}
                onChangeText={setNotes}
                placeholder="e.g. carton damaged in transit"
                placeholderTextColor={COLORS.inputPlaceholder}
                multiline
                numberOfLines={3}
                accessibilityLabel="Notes"
              />
            </View>

            <View style={styles.actions}>
              <PillButton
                label="Cancel"
                variant="tertiary"
                onPress={onClose}
                accessibilityLabel="Cancel stock adjustment"
                disabled={submitting}
              />
              <PillButton
                label={submitting ? 'Adjusting...' : 'Adjust stock'}
                variant="solid"
                onPress={handleSubmit}
                disabled={!canSubmit}
                // Distinct from the EyebrowLabel's "Adjust stock" string so
                // tests and a11y traversals don't collide on the same node.
                accessibilityLabel="Confirm stock adjustment"
              />
            </View>
            {submitting ? (
              <View style={styles.loaderRow}>
                <ActivityIndicator color={COLORS.crimson} size="small" />
              </View>
            ) : null}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modal: {justifyContent: 'flex-end', margin: 0},
  sheet: {
    backgroundColor: COLORS.background,
    borderTopLeftRadius: BORDER_RADIUS.xxl,
    borderTopRightRadius: BORDER_RADIUS.xxl,
    maxHeight: '90%',
  },
  scroll: {padding: SPACING.lg, paddingBottom: SPACING.xxl},
  title: {
    fontSize: FONT_SIZE.xl,
    fontFamily: FONT_FAMILY.bold,
    color: COLORS.text,
    marginBottom: SPACING.md,
    letterSpacing: -0.3,
  },
  currentRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.surfaceBorder,
    marginBottom: SPACING.md,
  },
  currentLabel: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.sm,
    fontFamily: FONT_FAMILY.medium,
  },
  currentValue: {
    color: COLORS.text,
    fontSize: FONT_SIZE.lg,
    fontFamily: FONT_FAMILY.bold,
    fontVariant: ['tabular-nums'],
  },
  bannerWrap: {marginBottom: SPACING.md},
  modeRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
    marginBottom: SPACING.md,
  },
  modeBtn: {
    flex: 1,
    minHeight: 44,
    paddingVertical: SPACING.sm + 4,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.inputBorder,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.surface,
  },
  modeBtnActive: {
    backgroundColor: COLORS.navy,
    borderColor: COLORS.navy,
  },
  modeText: {
    color: COLORS.textMuted,
    fontFamily: FONT_FAMILY.medium,
    fontSize: FONT_SIZE.md,
  },
  modeTextActive: {color: COLORS.cream},
  field: {marginBottom: SPACING.md},
  label: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.sm,
    fontFamily: FONT_FAMILY.medium,
    marginBottom: SPACING.xs + 2,
  },
  input: {
    minHeight: 44,
    backgroundColor: COLORS.inputBg,
    borderWidth: 1,
    borderColor: COLORS.inputBorder,
    borderRadius: BORDER_RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm + 2,
    fontSize: FONT_SIZE.md,
    color: COLORS.text,
    fontFamily: FONT_FAMILY.regular,
  },
  notesInput: {minHeight: 80, textAlignVertical: 'top'},
  projectedRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.surfaceBorder,
    marginBottom: SPACING.sm,
  },
  projectedLabel: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.sm,
    fontFamily: FONT_FAMILY.medium,
  },
  projectedValue: {
    color: COLORS.crimson,
    fontSize: FONT_SIZE.xl,
    fontFamily: FONT_FAMILY.bold,
    fontVariant: ['tabular-nums'],
  },
  projectedNegative: {color: COLORS.danger},
  deltaHint: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.sm,
    fontFamily: FONT_FAMILY.medium,
  },
  warning: {
    color: COLORS.danger,
    fontSize: FONT_SIZE.sm,
    fontFamily: FONT_FAMILY.medium,
    marginBottom: SPACING.md,
  },
  reasonGrid: {flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs + 2},
  reasonChip: {
    minHeight: 36,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs + 2,
    borderRadius: BORDER_RADIUS.full,
    borderWidth: 1,
    borderColor: COLORS.inputBorder,
    backgroundColor: COLORS.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reasonChipActive: {
    borderColor: COLORS.crimson,
    backgroundColor: COLORS.crimson,
  },
  reasonChipText: {
    color: COLORS.text,
    fontSize: FONT_SIZE.sm,
    fontFamily: FONT_FAMILY.medium,
  },
  reasonChipTextActive: {color: COLORS.white},
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: SPACING.sm,
    marginTop: SPACING.md,
  },
  loaderRow: {alignItems: 'center', marginTop: SPACING.sm},
});

export default StockAdjustModal;
