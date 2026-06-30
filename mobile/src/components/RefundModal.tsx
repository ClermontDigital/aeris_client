import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  ActivityIndicator,
  Alert,
  InputAccessoryView,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Modal from 'react-native-modal';
import * as Crypto from 'expo-crypto';
import {RefundError, RelayError} from '@aeris/shared';
import EyebrowLabel from './EyebrowLabel';
import PillButton from './PillButton';
import ErrorBanner from './ErrorBanner';
import Icon from './Icon';
import {
  BORDER_RADIUS,
  COLORS,
  FONT_FAMILY,
  FONT_SIZE,
  SPACING,
} from '../constants/theme';
import ApiClient from '../services/ApiClient';
import {useTransactionActivityStore} from '../stores/transactionActivityStore';
import {useHaptics} from '../hooks/useHaptics';
import {useResponsiveLayout} from '../hooks/useResponsiveLayout';
import type {
  RefundParams,
  RefundResponse,
  SaleDetail,
} from '../types/api.types';
import {formatCurrency} from '../utils/format';

// Three operator-facing refund modes. They compile down to the wire shape
// expected by sales.refund:
//   - 'full'    → no `amount` / no `items` (server refunds the remaining balance).
//   - 'amount'  → `amount` (dollars) only.
//   - 'items'   → `items[]` only (server uses items when both are sent, but
//                 we deliberately omit `amount` to keep the wire intent clean).
type Mode = 'full' | 'amount' | 'items';

// 'original' is the operator-facing label; on the wire it maps to
// 'original_method' per RefundParams.refund_method. 'card' may be silently
// coerced to 'eftpos' server-side — we always trust response.refund.payment_method
// for the post-success display.
type RefundMethodSelection = 'cash' | 'card' | 'original';

// react-native InputAccessoryView nativeID must be unique per app. The
// decimal-pad has no Done key on iOS so we pair the amount input with a
// "Done" + "Exact" toolbar above the keyboard.
const AMOUNT_ACCESSORY_ID = 'refundModalAmountAccessory';

// Server enforces 500. Track locally so the counter renders without a
// round-trip and the user can self-correct before submit.
const REASON_MAX_LEN = 500;

// Rate-limit countdown — server enforces 10/min/user on the refund route.
const RATE_LIMIT_COUNTDOWN_SEC = 10;

export interface RefundModalProps {
  visible: boolean;
  onClose: () => void;
  sale: SaleDetail;
  onRefunded: (response: RefundResponse) => void;
}

interface ItemLine {
  sale_item_id: number;
  product_name: string;
  unit_price_cents: number;
  max_qty: number;
  qty: number; // user-selected qty to refund (0 = excluded)
}

const RefundModal: React.FC<RefundModalProps> = ({
  visible,
  onClose,
  sale,
  onRefunded,
}) => {
  const haptics = useHaptics();
  const {isTablet} = useResponsiveLayout();
  const tabletCap = isTablet
    ? ({maxWidth: 560, alignSelf: 'center', width: '100%'} as const)
    : null;

  const [mode, setMode] = useState<Mode>('full');
  // Dollar string; raw so an empty field stays empty.
  const [amountText, setAmountText] = useState('');
  const [items, setItems] = useState<ItemLine[]>([]);
  const [reason, setReason] = useState('');
  const [method, setMethod] = useState<RefundMethodSelection>('cash');

  // Idempotency key — minted on open, then re-minted at submit time only
  // when the body has changed since the last submission. Reusing the same
  // key with the same body is end-to-end safe (replay path); reusing with
  // a different body triggers a 409. The dirty ref tracks whether any
  // field changed since the last mint so we don't burn entropy on every
  // keystroke (or pollute server-side audit logs with discarded UUIDs).
  // Stored in a ref (not state) so `handleSubmit` can read + mint
  // synchronously without waiting for a render cycle.
  const idempotencyKeyRef = useRef<string>('');
  const dirtyRef = useRef(false);
  const mintIdempotencyKey = useCallback(() => {
    idempotencyKeyRef.current = Crypto.randomUUID();
    dirtyRef.current = false;
  }, []);
  const markDirty = useCallback(() => {
    dirtyRef.current = true;
  }, []);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rateLimitCountdown, setRateLimitCountdown] = useState(0);

  // Synchronous double-tap guard — see StockAdjustModal for the same pattern.
  // setSubmitting is async; a 60Hz double-tap can fire two refundSale calls
  // before the disabled state takes effect.
  const submitLockRef = useRef(false);

  // Hydrate items from the sale every time the modal opens. Without this,
  // reopening on a different sale would surface the previous items list.
  useEffect(() => {
    if (!visible) return;
    setMode('full');
    setAmountText('');
    setItems(
      sale.items
        // Per-line refunds require the sale_items.id PK; legacy resources
        // that don't expose it (id === 0) can't be referenced, so we hide
        // them from the per-items selector. Full / by-amount still work
        // on those sales.
        .filter(line => line.id > 0)
        .map(line => ({
          sale_item_id: line.id,
          product_name: line.product_name,
          unit_price_cents: line.unit_price_cents,
          max_qty: line.quantity,
          qty: 0,
        })),
    );
    setReason('');
    setMethod('cash');
    setSubmitting(false);
    setError(null);
    setRateLimitCountdown(0);
    mintIdempotencyKey();
  }, [visible, sale, mintIdempotencyKey]);

  // Countdown ticker for the 429 rate-limit backoff.
  useEffect(() => {
    if (rateLimitCountdown <= 0) return;
    const t = setTimeout(
      () => setRateLimitCountdown(c => Math.max(0, c - 1)),
      1000,
    );
    return () => clearTimeout(t);
  }, [rateLimitCountdown]);

  // Field handlers flip the dirty flag; the next submit will mint a fresh
  // UUID before sending. This keeps the key stable across noisy edit
  // bursts (reason typing) while still guaranteeing same-body == same-key
  // for replay safety.
  const handleModeChange = useCallback(
    (next: Mode) => {
      if (next === mode) return;
      haptics.selection();
      setMode(next);
      setError(null);
      markDirty();
    },
    [mode, haptics, markDirty],
  );

  const handleAmountChange = useCallback(
    (text: string) => {
      setAmountText(text);
      markDirty();
    },
    [markDirty],
  );

  const handleItemQtyDelta = useCallback(
    (saleItemId: number, delta: number) => {
      setItems(prev =>
        prev.map(line => {
          if (line.sale_item_id !== saleItemId) return line;
          const nextQty = Math.max(0, Math.min(line.max_qty, line.qty + delta));
          if (nextQty === line.qty) return line;
          haptics.selection();
          return {...line, qty: nextQty};
        }),
      );
      markDirty();
    },
    [haptics, markDirty],
  );

  const handleItemToggle = useCallback(
    (saleItemId: number) => {
      setItems(prev =>
        prev.map(line => {
          if (line.sale_item_id !== saleItemId) return line;
          const nextQty = line.qty > 0 ? 0 : line.max_qty;
          haptics.selection();
          return {...line, qty: nextQty};
        }),
      );
      markDirty();
    },
    [haptics, markDirty],
  );

  const handleReasonChange = useCallback(
    (text: string) => {
      if (text.length > REASON_MAX_LEN) return; // hard-cap, server would 422
      setReason(text);
      markDirty();
    },
    [markDirty],
  );

  const handleMethodChange = useCallback(
    (next: RefundMethodSelection) => {
      if (next === method) return;
      haptics.selection();
      setMethod(next);
      markDirty();
    },
    [method, haptics, markDirty],
  );

  // Refundable balance = original total minus prior refunds. The server's
  // sale.payments collection includes negative-amount Refund rows from
  // previous partial refunds; subtracting them gives the operator the
  // remaining headroom. Capping the by-amount input on this (not on the
  // original total) prevents the second partial refund from accidentally
  // exceeding the server's max-refundable cap and 422-ing.
  const refundedCents = useMemo(
    () =>
      sale.payments.reduce(
        (acc, p) => (p.amount_cents < 0 ? acc + Math.abs(p.amount_cents) : acc),
        0,
      ),
    [sale.payments],
  );
  const refundableBalanceCents = sale.total_cents - refundedCents;
  const refundableBalanceDollars = refundableBalanceCents / 100;
  const hasPriorRefunds = refundedCents > 0;

  // Parsed amount + cap check. Cap on remaining refundable balance, not
  // the original sale total.
  const parsedAmount = useMemo(() => {
    if (mode !== 'amount') return null;
    const n = parseFloat(amountText);
    if (Number.isNaN(n) || n <= 0) return null;
    if (n > refundableBalanceDollars) return null;
    return Math.round(n * 100) / 100;
  }, [mode, amountText, refundableBalanceDollars]);

  // Items selected for refund — server expects {sale_item_id, quantity}[],
  // qty > 0 only.
  const selectedItems = useMemo(
    () =>
      items
        .filter(line => line.qty > 0)
        .map(line => ({sale_item_id: line.sale_item_id, quantity: line.qty})),
    [items],
  );

  // Submit-enablement per mode:
  // - full: always ok
  // - amount: parsedAmount > 0 and within cap
  // - items: at least one line with qty > 0
  const canSubmit = useMemo(() => {
    if (submitting || rateLimitCountdown > 0) return false;
    if (mode === 'full') return true;
    if (mode === 'amount') return parsedAmount !== null;
    return selectedItems.length > 0;
  }, [mode, parsedAmount, selectedItems.length, submitting, rateLimitCountdown]);

  const handleSubmit = useCallback(async () => {
    if (submitLockRef.current) return;
    if (!canSubmit) return;
    submitLockRef.current = true;
    setSubmitting(true);
    setError(null);
    // M-R7 (§19.2 rule 1 / §22.5 Q1): a refund is a money-move; mark it
    // in-flight so the routing cascade never flips cloud↔local mid-refund. The
    // store comment claimed saleInFlight covered createSale OR refundSale, but
    // only CheckoutScreen wrote it — this closes the refund gap. Cleared in the
    // finally below.
    useTransactionActivityStore.getState().setSaleInFlight(true);

    // Mint a fresh key only if the body changed since the last submit.
    // A clean retry (no edits) reuses the previous key so the server
    // takes the cached replay path instead of doing the work twice.
    if (dirtyRef.current || !idempotencyKeyRef.current) {
      mintIdempotencyKey();
    }

    const params: RefundParams = {
      sale_id: sale.id,
      idempotency_key: idempotencyKeyRef.current,
      refund_method:
        method === 'original' ? 'original_method' : method,
      ...(reason.trim() ? {reason: reason.trim()} : {}),
      // Only send the field that matches the active mode — never both.
      // Server prefers items when both are present, but keeping the wire
      // intent clean simplifies the audit trail.
      ...(mode === 'amount' && parsedAmount !== null
        ? {amount: parsedAmount}
        : {}),
      ...(mode === 'items' ? {items: selectedItems} : {}),
    };

    try {
      const response = await ApiClient.refundSale(params);
      // Suppress the success haptic on idempotent replay — the action
      // already fired the first time; a second buzz misrepresents what
      // happened on the server.
      if (!response.data.idempotent_replay) {
        haptics.success();
      }
      onRefunded(response);
      onClose();
    } catch (e) {
      // Aeris2 DR gate (§9.2 cloud-origin refund block) surfaces as a
      // RelayError on the envelope with code=DR_FAILOVER_CLOUD_ORIGIN_REFUND_BLOCKED.
      // Map to our own copy — the server message intentionally varies and
      // we don't want it echoed unstyled into the modal. Caught BEFORE
      // RefundError because the envelope-level error throws as RelayError
      // (not RefundError) and would otherwise fall through to the generic
      // "check connection" branch.
      if (
        e instanceof RelayError &&
        e.code === 'DR_FAILOVER_CLOUD_ORIGIN_REFUND_BLOCKED'
      ) {
        haptics.error();
        setError(
          'Cloud-origin sales can’t be refunded during on-prem failover.',
        );
        return;
      }
      if (e instanceof RefundError) {
        if (e.kind === 'conflict') {
          // Stale idempotency key — sheet closes (next open mints a fresh
          // UUID) and we surface a transient toast. Per spec: no haptic.
          Alert.alert('Refund', 'Refund could not be applied, try again');
          onClose();
          return;
        }
        if (e.kind === 'rate_limited') {
          haptics.error();
          setRateLimitCountdown(RATE_LIMIT_COUNTDOWN_SEC);
          setError(e.message || 'Too many refund attempts. Please wait.');
          return;
        }
        // forbidden / rejected — keep the sheet open, surface the server
        // message verbatim (per spec). Don't pattern-match server copy.
        if (e.kind === 'forbidden' || e.kind === 'rejected') {
          haptics.error();
          setError(e.message);
          return;
        }
        // unknown — generic banner, sheet stays open.
        haptics.error();
        setError(
          e.message ||
            "Couldn't apply refund — check connection and try again.",
        );
        return;
      }
      // Network / other — generic banner.
      haptics.error();
      setError("Couldn't apply refund — check connection and try again.");
    } finally {
      setSubmitting(false);
      submitLockRef.current = false;
      // M-R7: clear the mid-transaction defer flag once the refund settles.
      useTransactionActivityStore.getState().setSaleInFlight(false);
    }
  }, [
    canSubmit,
    sale.id,
    method,
    reason,
    mode,
    parsedAmount,
    selectedItems,
    mintIdempotencyKey,
    haptics,
    onRefunded,
    onClose,
  ]);

  const submitLabel = useMemo(() => {
    if (submitting) return 'Refunding...';
    if (rateLimitCountdown > 0) return `Try again in ${rateLimitCountdown}s`;
    return 'Process refund';
  }, [submitting, rateLimitCountdown]);

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
            <EyebrowLabel>Refund sale</EyebrowLabel>
            <Text style={styles.title} numberOfLines={1}>
              {sale.sale_number}
            </Text>
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Sale total</Text>
              <Text style={styles.totalValue}>
                {formatCurrency(sale.total_cents)}
              </Text>
            </View>
            {hasPriorRefunds ? (
              <View style={styles.balanceRow}>
                <Text style={styles.balanceLabel}>
                  Already refunded · {formatCurrency(refundedCents)}
                </Text>
                <Text style={styles.balanceValue}>
                  {formatCurrency(refundableBalanceCents)} left
                </Text>
              </View>
            ) : null}

            {error ? (
              <View style={styles.bannerWrap}>
                <ErrorBanner
                  message={error}
                  onDismiss={() => setError(null)}
                />
              </View>
            ) : null}

            {/* Mode selector */}
            <View style={styles.segmentRow} accessibilityRole="tablist">
              {(
                [
                  {value: 'full', label: 'Full'},
                  {value: 'amount', label: 'By amount'},
                  {value: 'items', label: 'By items'},
                ] as const
              ).map(opt => {
                const selected = mode === opt.value;
                return (
                  <TouchableOpacity
                    key={opt.value}
                    style={[styles.segmentBtn, selected && styles.segmentBtnActive]}
                    onPress={() => handleModeChange(opt.value)}
                    accessibilityRole="button"
                    accessibilityLabel={`Refund mode: ${opt.label}`}
                    accessibilityState={{selected}}>
                    <Text
                      style={[
                        styles.segmentText,
                        selected && styles.segmentTextActive,
                      ]}>
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {mode === 'amount' ? (
              <View style={styles.field}>
                <Text style={styles.label}>
                  Refund amount (max {formatCurrency(refundableBalanceCents)})
                </Text>
                <TextInput
                  style={styles.input}
                  value={amountText}
                  onChangeText={handleAmountChange}
                  keyboardType="decimal-pad"
                  placeholder="0.00"
                  placeholderTextColor={COLORS.inputPlaceholder}
                  accessibilityLabel="Refund amount in dollars"
                  inputAccessoryViewID={
                    Platform.OS === 'ios' ? AMOUNT_ACCESSORY_ID : undefined
                  }
                />
                {amountText.length > 0 && parsedAmount === null ? (
                  <Text style={styles.warning}>
                    Enter an amount between $0.01 and{' '}
                    {formatCurrency(refundableBalanceCents)}.
                  </Text>
                ) : null}
              </View>
            ) : null}

            {mode === 'items' ? (
              <View style={styles.field}>
                <Text style={styles.label}>Items to refund</Text>
                {items.length === 0 ? (
                  <Text style={styles.emptyText}>
                    This sale has no refundable items.
                  </Text>
                ) : (
                  items.map(line => {
                    const selected = line.qty > 0;
                    return (
                      <View key={line.sale_item_id} style={styles.itemRow}>
                        <TouchableOpacity
                          style={styles.itemCheckbox}
                          onPress={() => handleItemToggle(line.sale_item_id)}
                          accessibilityRole="checkbox"
                          accessibilityState={{checked: selected}}
                          accessibilityLabel={`Toggle refund for ${line.product_name}`}>
                          <View
                            style={[
                              styles.checkbox,
                              selected && styles.checkboxChecked,
                            ]}>
                            {selected ? (
                              <Icon
                                name="check"
                                size={14}
                                color={COLORS.white}
                              />
                            ) : null}
                          </View>
                          <View style={styles.itemMeta}>
                            <Text
                              style={styles.itemName}
                              numberOfLines={2}>
                              {line.product_name}
                            </Text>
                            <Text style={styles.itemSub}>
                              {formatCurrency(line.unit_price_cents)} each ·
                              max {line.max_qty}
                            </Text>
                          </View>
                        </TouchableOpacity>
                        <View style={styles.stepper}>
                          <TouchableOpacity
                            style={[
                              styles.stepBtn,
                              line.qty <= 0 && styles.stepBtnDisabled,
                            ]}
                            onPress={() =>
                              handleItemQtyDelta(line.sale_item_id, -1)
                            }
                            disabled={line.qty <= 0}
                            accessibilityRole="button"
                            accessibilityLabel={`Decrease refund qty for ${line.product_name}`}>
                            <Icon
                              name="minus"
                              size={14}
                              color={
                                line.qty <= 0 ? COLORS.textDim : COLORS.navy
                              }
                            />
                          </TouchableOpacity>
                          <Text style={styles.qtyText}>{line.qty}</Text>
                          <TouchableOpacity
                            style={[
                              styles.stepBtn,
                              line.qty >= line.max_qty && styles.stepBtnDisabled,
                            ]}
                            onPress={() =>
                              handleItemQtyDelta(line.sale_item_id, 1)
                            }
                            disabled={line.qty >= line.max_qty}
                            accessibilityRole="button"
                            accessibilityLabel={`Increase refund qty for ${line.product_name}`}>
                            <Icon
                              name="plus"
                              size={14}
                              color={
                                line.qty >= line.max_qty
                                  ? COLORS.textDim
                                  : COLORS.navy
                              }
                            />
                          </TouchableOpacity>
                        </View>
                      </View>
                    );
                  })
                )}
              </View>
            ) : null}

            <View style={styles.field}>
              <Text style={styles.label}>Reason (optional)</Text>
              <TextInput
                style={[styles.input, styles.reasonInput]}
                value={reason}
                onChangeText={handleReasonChange}
                placeholder="e.g. customer changed their mind"
                placeholderTextColor={COLORS.inputPlaceholder}
                multiline
                maxLength={REASON_MAX_LEN}
                accessibilityLabel="Refund reason"
              />
              <Text style={styles.counter}>
                {reason.length}/{REASON_MAX_LEN}
              </Text>
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>Refund method</Text>
              <View style={styles.segmentRow}>
                {(
                  [
                    {value: 'cash', label: 'Cash'},
                    {value: 'card', label: 'Card'},
                    {value: 'original', label: 'Original'},
                  ] as const
                ).map(opt => {
                  const selected = method === opt.value;
                  return (
                    <TouchableOpacity
                      key={opt.value}
                      style={[
                        styles.segmentBtn,
                        selected && styles.segmentBtnActive,
                      ]}
                      onPress={() => handleMethodChange(opt.value)}
                      accessibilityRole="button"
                      accessibilityLabel={`Refund method: ${opt.label}`}
                      accessibilityState={{selected}}>
                      <Text
                        style={[
                          styles.segmentText,
                          selected && styles.segmentTextActive,
                        ]}>
                        {opt.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            <View style={styles.actions}>
              <PillButton
                label="Cancel"
                variant="tertiary"
                onPress={onClose}
                accessibilityLabel="Cancel refund"
                disabled={submitting}
              />
              <PillButton
                label={submitLabel}
                variant="solid"
                onPress={handleSubmit}
                disabled={!canSubmit}
                accessibilityLabel="Confirm refund"
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
      {Platform.OS === 'ios' ? (
        <InputAccessoryView nativeID={AMOUNT_ACCESSORY_ID}>
          <View style={styles.accessory}>
            <TouchableOpacity
              onPress={() => {
                haptics.light();
                // Quick-fill uses the refundable balance, not the
                // original sale total, so partially-refunded sales
                // populate with the correct remaining cap.
                handleAmountChange(refundableBalanceDollars.toFixed(2));
              }}
              accessibilityRole="button"
              accessibilityLabel="Fill in refundable balance">
              <Text style={styles.accessoryLink}>
                Full ({formatCurrency(refundableBalanceCents)})
              </Text>
            </TouchableOpacity>
            <View style={styles.accessorySpacer} />
            <TouchableOpacity
              onPress={() => {
                haptics.light();
                Keyboard.dismiss();
              }}
              accessibilityRole="button"
              accessibilityLabel="Dismiss keyboard">
              <Text style={styles.accessoryDone}>Done</Text>
            </TouchableOpacity>
          </View>
        </InputAccessoryView>
      ) : null}
    </Modal>
  );
};

const styles = StyleSheet.create({
  modal: {justifyContent: 'flex-end', margin: 0},
  sheet: {
    backgroundColor: COLORS.background,
    borderTopLeftRadius: BORDER_RADIUS.xxl,
    borderTopRightRadius: BORDER_RADIUS.xxl,
    maxHeight: '92%',
  },
  scroll: {padding: SPACING.lg, paddingBottom: SPACING.xxl},
  title: {
    fontSize: FONT_SIZE.xl,
    fontFamily: FONT_FAMILY.bold,
    color: COLORS.text,
    marginBottom: SPACING.md,
    letterSpacing: -0.3,
  },
  totalRow: {
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
  totalLabel: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.sm,
    fontFamily: FONT_FAMILY.medium,
  },
  totalValue: {
    color: COLORS.text,
    fontSize: FONT_SIZE.lg,
    fontFamily: FONT_FAMILY.bold,
    fontVariant: ['tabular-nums'],
  },
  balanceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    paddingHorizontal: SPACING.md,
    marginTop: -SPACING.sm,
    marginBottom: SPACING.md,
  },
  balanceLabel: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.xs,
    fontFamily: FONT_FAMILY.medium,
  },
  balanceValue: {
    color: COLORS.crimson,
    fontSize: FONT_SIZE.sm,
    fontFamily: FONT_FAMILY.bold,
    fontVariant: ['tabular-nums'],
  },
  bannerWrap: {marginBottom: SPACING.md},
  segmentRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
    marginBottom: SPACING.md,
  },
  segmentBtn: {
    flex: 1,
    minHeight: 44,
    paddingVertical: SPACING.sm + 4,
    paddingHorizontal: SPACING.sm,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.inputBorder,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.surface,
  },
  segmentBtnActive: {
    backgroundColor: COLORS.navy,
    borderColor: COLORS.navy,
  },
  segmentText: {
    color: COLORS.textMuted,
    fontFamily: FONT_FAMILY.medium,
    fontSize: FONT_SIZE.md,
  },
  segmentTextActive: {color: COLORS.cream},
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
  reasonInput: {minHeight: 88, textAlignVertical: 'top'},
  counter: {
    marginTop: SPACING.xs,
    alignSelf: 'flex-end',
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.xs,
    fontVariant: ['tabular-nums'],
  },
  warning: {
    color: COLORS.danger,
    fontSize: FONT_SIZE.sm,
    fontFamily: FONT_FAMILY.medium,
    marginTop: SPACING.xs + 2,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.surfaceBorder,
  },
  itemCheckbox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: SPACING.sm,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: BORDER_RADIUS.sm,
    borderWidth: 1.5,
    borderColor: COLORS.inputBorder,
    backgroundColor: COLORS.inputBg,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: SPACING.sm,
  },
  checkboxChecked: {
    backgroundColor: COLORS.crimson,
    borderColor: COLORS.crimson,
  },
  itemMeta: {flex: 1},
  itemName: {
    color: COLORS.text,
    fontSize: FONT_SIZE.md,
    fontFamily: FONT_FAMILY.medium,
  },
  itemSub: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.sm,
    marginTop: 2,
    fontVariant: ['tabular-nums'],
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  stepBtn: {
    width: 32,
    height: 32,
    borderRadius: BORDER_RADIUS.full,
    borderWidth: 1,
    borderColor: COLORS.inputBorder,
    backgroundColor: COLORS.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBtnDisabled: {opacity: 0.4},
  qtyText: {
    minWidth: 24,
    textAlign: 'center',
    color: COLORS.text,
    fontFamily: FONT_FAMILY.bold,
    fontSize: FONT_SIZE.md,
    fontVariant: ['tabular-nums'],
  },
  emptyText: {color: COLORS.textMuted, fontSize: FONT_SIZE.sm},
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: SPACING.sm,
    marginTop: SPACING.md,
  },
  loaderRow: {alignItems: 'center', marginTop: SPACING.sm},
  accessory: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    backgroundColor: COLORS.surface,
    borderTopWidth: 1,
    borderTopColor: COLORS.surfaceBorder,
  },
  accessoryLink: {
    color: COLORS.crimson,
    fontFamily: FONT_FAMILY.semibold,
    fontSize: FONT_SIZE.md,
  },
  accessorySpacer: {flex: 1},
  accessoryDone: {
    color: COLORS.navy,
    fontFamily: FONT_FAMILY.semibold,
    fontSize: FONT_SIZE.md,
  },
});

export default RefundModal;
