import React, {useState, useEffect, useCallback, useRef} from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  InputAccessoryView,
  Keyboard,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {useNavigation, useFocusEffect} from '@react-navigation/native';
import type {CompositeNavigationProp} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import type {BottomTabNavigationProp} from '@react-navigation/bottom-tabs';
import Icon from '../components/Icon';
import {
  COLORS,
  SPACING,
  FONT_SIZE,
  FONT_FAMILY,
  BORDER_RADIUS,
  ICON_SIZE,
} from '../constants/theme';
import {A_CLEARANCE} from '../components/nav/navGeometry';
import {useCartStore} from '../stores/cartStore';
import {useTransactionActivityStore} from '../stores/transactionActivityStore';
import {useFailoverAbortStore} from '../stores/failoverAbortStore';
import {useRoutingDecision} from '../hooks/useRoutingDecision';
import {useHaptics} from '../hooks/useHaptics';
import {useResponsiveLayout} from '../hooks/useResponsiveLayout';
import {usePrintReceipt} from '../hooks/usePrintReceipt';
import ApiClient from '../services/ApiClient';
import {RelayError} from '@aeris/shared';
import ErrorBanner from '../components/ErrorBanner';
import EyebrowLabel from '../components/EyebrowLabel';
import type {PaymentMethod} from '../types/api.types';
import type {
  AppTabParamList,
  QuickSaleStackParamList,
} from '../types/navigation.types';
import {formatCurrency} from '../utils/format';

type NavigationProp = CompositeNavigationProp<
  NativeStackNavigationProp<QuickSaleStackParamList, 'Checkout'>,
  BottomTabNavigationProp<AppTabParamList>
>;

// nativeID for the InputAccessoryView toolbar that sits above the iOS
// decimal-pad when the cashier is entering cash tender. The TextInput
// references this via inputAccessoryViewID; iOS pairs them by ID.
const CASH_TENDER_ACCESSORY_ID = 'cash-tender-accessory';

const DEFAULT_PAYMENT_METHODS: PaymentMethod[] = [
  {code: 'cash', name: 'Cash', requires_reference: false},
  {code: 'card', name: 'Card', requires_reference: false},
  {code: 'account', name: 'Account', requires_reference: false},
];

// Tenders the Aeris2 failover gate blocks during an active on-prem failover
// (DrFailoverState.php:171-174). Mirroring the server-side superset here so
// the tile is dead BEFORE the cashier taps — server still fails closed if a
// tile somehow gets through. Lowercase compare, since the server gate is
// case-insensitive (strtolower at DrFailoverState.php:177).
const FAILOVER_BLOCKED_TENDERS: ReadonlySet<string> = new Set([
  'card',
  'eftpos',
  'credit_card',
  'debit_card',
  'gift_card',
  'account',
  'on_account',
  'layby',
  'lay-by',
  'laybuy',
  'afterpay',
  'zip_pay',
  'zippay',
  'zip',
  'bank_transfer',
]);

function isTenderBlockedByFailover(code: string): boolean {
  return FAILOVER_BLOCKED_TENDERS.has(code.toLowerCase());
}

interface SaleResult {
  sale_id: number;
  sale_number: string;
  total_cents: number;
}

export default function CheckoutScreen() {
  const navigation = useNavigation<NavigationProp>();
  const haptics = useHaptics();
  const {isTablet} = useResponsiveLayout();
  // Whole content column caps at 720pt and centres on iPad. Payment-method
  // tiles get an additional per-tile cap so they don't read as billboards
  // when the grid has only 2-3 items.
  const tabletColumnCap = isTablet
    ? ({maxWidth: 720, alignSelf: 'center', width: '100%'} as const)
    : null;
  const tabletMethodTileCap = isTablet ? ({maxWidth: 220} as const) : null;
  const {
    items,
    customerId,
    customerName,
    discountCents,
    notes,
    repairId,
    getTotalCents,
    getItemCount,
    clear,
    markSaleCompleted,
  } = useCartStore();

  const totalCents = getTotalCents();
  const itemCount = getItemCount();

  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>(
    DEFAULT_PAYMENT_METHODS,
  );
  const [paymentMethodsState, setPaymentMethodsState] = useState<
    'loading' | 'live' | 'fallback'
  >('loading');
  const paymentMethodsStateRef = useRef(paymentMethodsState);
  // Sync the ref in an effect rather than during render — mutating refs in
  // the render body trips React 18 StrictMode's double-invoke and can leave
  // the ref out of sync with the rendered state.
  useEffect(() => {
    paymentMethodsStateRef.current = paymentMethodsState;
  }, [paymentMethodsState]);
  // Captures why we fell back so the operator can see "Server returned 0
  // methods" vs "Network error: ..." vs "Couldn't reach the server" rather
  // than the previous opaque "Using offline defaults". Cleared when a
  // successful live fetch lands.
  const [paymentMethodsFallbackReason, setPaymentMethodsFallbackReason] =
    useState<string | null>(null);
  const [selectedMethod, setSelectedMethod] = useState<string | null>(null);
  const [amountTendered, setAmountTendered] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saleResult, setSaleResult] = useState<SaleResult | null>(null);
  // Receipt print logic + double-tap guard + flag branching all live in
  // the shared hook so CheckoutScreen and ReceiptViewerScreen behave the
  // same way and there's one bug-fix surface.
  const {isPrinting, printReceipt} = usePrintReceipt();

  // Load payment methods. Surfacing the fallback state lets the operator
  // know the workspace's customised method list isn't loaded — important
  // when a deployment has e.g. 'EFTPOS', 'GiftCard' beyond cash/card. We
  // block sale completion in fallback because the hard-coded codes
  // (cash/card/account) aren't guaranteed valid for every deployment;
  // submitting an unknown method would be a server-side validation fail
  // mid-sale. Tap-to-retry covers the transient-network case.
  const loadPaymentMethods = useCallback(async () => {
    const wasFallback =
      paymentMethodsStateRef.current === 'fallback';
    setPaymentMethodsState('loading');
    try {
      const methods = await ApiClient.getPaymentMethods();
      if (methods.length > 0) {
        setPaymentMethods(methods);
        setPaymentMethodsState('live');
        setPaymentMethodsFallbackReason(null);
        return;
      }
      // Server responded fine but returned zero methods. The workspace
      // probably has no methods configured (a setup issue, not a code
      // bug). Surface this distinctly so the operator/support team can
      // tell it apart from a network problem.
      setPaymentMethods(DEFAULT_PAYMENT_METHODS);
      setPaymentMethodsState('fallback');
      setPaymentMethodsFallbackReason(
        "No payment methods set up for this workspace. Please contact your administrator. Tap to retry once they're added.",
      );
      console.warn('[checkout] payment-methods returned empty array');
      if (!wasFallback) haptics.error();
    } catch (e) {
      const msg =
        e instanceof Error && e.message
          ? e.message
          : 'Network or server error';
      console.warn('[checkout] payment-methods failed:', msg, e);
      setPaymentMethods(DEFAULT_PAYMENT_METHODS);
      setPaymentMethodsState('fallback');
      setPaymentMethodsFallbackReason(`Couldn't load: ${msg}. Tap to retry.`);
      if (!wasFallback) haptics.error();
    }
  }, [haptics]);

  useEffect(() => {
    loadPaymentMethods();
  }, [loadPaymentMethods]);

  const tenderedCents = Math.round(parseFloat(amountTendered || '0') * 100);
  const changeCents =
    selectedMethod === 'cash' && tenderedCents > totalCents
      ? tenderedCents - totalCents
      : 0;

  // M-R5 (§17.4): once the cashier has aborted to manual (or the NAS went
  // unavailable mid-outage), writes are blocked — the Complete-sale CTA must go
  // dead and tell the cashier to record on paper. Subscribed so the button
  // re-renders the moment the abort store flips.
  // TODO(DR-M-R5 follow-up): apply the same `isWriteActionBlocked('refund')`
  // gate to RefundModal and `isWriteActionBlocked('account')` to the
  // customer-account screen (separate scope — not built here).
  const saleWritesBlocked = useFailoverAbortStore(s =>
    s.isWriteActionBlocked('sale'),
  );

  // §19.2 routing mode — when the device is selling against the on-prem
  // server (currentMode === 'local'), the Aeris2 NAS rejects non-cash
  // tenders with HTTP 422 + DR_FAILOVER_TENDER_BLOCKED. Pre-disable those
  // tiles so the cashier sees the constraint up-front instead of eating
  // a 422 after picking Card. Cash + manual EFTPOS (free-text) still pass.
  const {currentMode} = useRoutingDecision();
  // Gate during 'local' (active failover) AND 'switching' (cascade mid-
  // transition — conservative; treats the in-flight state as failover so
  // the cashier can't sneak a card sale through right at the boundary).
  const failoverTenderGateActive =
    currentMode === 'local' || currentMode === 'switching';
  const isMethodFailoverBlocked = useCallback(
    (code: string): boolean =>
      failoverTenderGateActive && isTenderBlockedByFailover(code),
    [failoverTenderGateActive],
  );

  // If the cashier had a now-blocked tender selected when the routing
  // mode flipped to local mid-checkout, clear the selection so they can't
  // submit it. Cleanest place to enforce — runs only when the gate flag
  // changes, doesn't fight user input on every render.
  useEffect(() => {
    if (
      failoverTenderGateActive &&
      selectedMethod !== null &&
      isTenderBlockedByFailover(selectedMethod)
    ) {
      setSelectedMethod(null);
      setAmountTendered('');
    }
  }, [failoverTenderGateActive, selectedMethod]);

  const canComplete =
    !saleWritesBlocked &&
    paymentMethodsState === 'live' &&
    selectedMethod !== null &&
    !isMethodFailoverBlocked(selectedMethod) &&
    (selectedMethod !== 'cash' || tenderedCents >= totalCents);

  // Synchronous double-tap guard. `setIsSubmitting(true)` is async — between
  // the press and the next render a fast double-tap on iOS can fire this
  // handler twice. Each invocation generates its own idempotency key inside
  // createSale, so two sales would post. The ref flips before any awaits.
  const submitLockRef = useRef(false);

  const handleCompleteSale = useCallback(async () => {
    // FIX (M-R5 §17.4): re-check the write-gate at the TOP of the handler, not
    // just via the button's `disabled` prop. A programmatic invoke or a
    // render-flip race (gate flips to blocked between the press and re-render)
    // could otherwise still post a sale in manual mode. Read live from the
    // store so we never rely on a stale subscribed snapshot.
    if (useFailoverAbortStore.getState().isWriteActionBlocked('sale')) {
      haptics.error();
      setError('On-prem unavailable — record on paper');
      return;
    }
    if (!selectedMethod) return;
    if (submitLockRef.current) return;
    submitLockRef.current = true;

    haptics.medium();
    setIsSubmitting(true);
    setError(null);
    // §19.2 rule 1: mark the createSale in flight so the routing cascade never
    // switches connection mode mid-post (which would re-auth + drop the call).
    useTransactionActivityStore.getState().setSaleInFlight(true);

    try {
      // T8 pre-flight guard — when the cart is a repair checkout, re-fetch
      // the repair immediately before we send the sale so a status drift
      // between "Take payment for repair" and Complete-sale can't slip an
      // orphan sale past the server. The server SILENTLY skips the
      // completion side-effect for non-ready repairs (per the DR-M3
      // sitrep), so the client MUST enforce this — never trust the
      // server to reject. Belt-and-braces with the RepairDetail Checkout
      // button's own guard.
      if (repairId != null) {
        try {
          const fresh = await ApiClient.getRepairDetail(repairId);
          if (!fresh || fresh.status !== 'ready') {
            haptics.error();
            setError(
              'This repair is no longer ready for checkout. Reload and try again.',
            );
            return;
          }
        } catch {
          haptics.error();
          setError(
            'Could not verify repair status. Check your connection and try again.',
          );
          return;
        }
      }

      const saleItems = items.map(item => ({
        product_id: item.product.id,
        quantity: item.quantity,
        unit_price_cents: item.unit_price_cents,
        // Thread per-line tax_rate so RelayClient.createSale flags
        // gst_applicable correctly for GST-free SKUs.
        tax_rate: item.product.tax_rate,
        discount_cents: item.discount_cents || undefined,
      }));

      const payments = [
        {
          method: selectedMethod,
          amount_cents: totalCents,
        },
      ];

      const result = await ApiClient.createSale({
        items: saleItems,
        payments,
        customer_id: customerId ?? undefined,
        discount_cents: discountCents > 0 ? discountCents : undefined,
        notes: notes || undefined,
        // T8: thread repairId as top-level repair_id so Aeris2's
        // ProcessSaleRequest can link + complete the repair.
        repair_id: repairId ?? undefined,
      });

      haptics.success();
      // Broadcast a "sale just landed" timestamp so the Dashboard's
      // useFocusEffect refetches its summary on the next focus and the
      // operator doesn't see a stale "Quiet so far" empty state.
      markSaleCompleted();
      setSaleResult(result);
    } catch (e) {
      haptics.error();
      // Aeris2 DR gates surface as RelayError with `code` set on the relay
      // envelope. We own the on-prem copy (per-tender server messages
      // intentionally vary — gift_card omits "use cash." etc., per
      // DrFailoverState.php:179-188) — don't echo server text.
      if (e instanceof RelayError) {
        if (e.code === 'DR_FAILOVER_TENDER_BLOCKED') {
          setError(
            'This payment type is paused during on-prem failover — use cash.',
          );
          // Clear the now-blocked selection so the cashier picks Cash.
          if (selectedMethod && isTenderBlockedByFailover(selectedMethod)) {
            setSelectedMethod(null);
            setAmountTendered('');
          }
          return;
        }
        if (e.code === 'DR_FAILOVER_CLOUD_ORIGIN_REFUND_BLOCKED') {
          setError(
            'Cloud-origin sales can’t be refunded during on-prem failover.',
          );
          return;
        }
      }
      const msg = e instanceof Error ? e.message : 'Sale failed';
      setError(msg);
    } finally {
      setIsSubmitting(false);
      submitLockRef.current = false;
      useTransactionActivityStore.getState().setSaleInFlight(false);
    }
  }, [selectedMethod, items, totalCents, customerId, discountCents, notes, repairId, haptics, markSaleCompleted]);

  const handlePrintReceipt = useCallback(async () => {
    if (!saleResult) return;
    try {
      await printReceipt(saleResult.sale_id);
    } catch {
      // Hook already logged + fired error haptic. Surface a banner here so
      // the post-sale screen shows a clear state alongside the receipt.
      setError('Failed to print receipt');
    }
  }, [saleResult, printReceipt]);

  // Reset the QuickSale stack back to ProductGrid. Used by both success
  // actions AND by the focus-loss effect below so any path away from a
  // completed Checkout (button tap OR tabbing away) leaves the operator
  // with a clean ProductGrid the next time they hit the Sale tab —
  // previously the stale success view stayed mounted and the operator
  // saw "Sale complete" for the previous transaction on their next visit.
  const resetSaleStack = useCallback(() => {
    navigation.reset({
      index: 0,
      routes: [{name: 'ProductGrid'}],
    });
  }, [navigation]);

  const handleNewSale = useCallback(() => {
    clear();
    resetSaleStack();
  }, [clear, resetSaleStack]);

  const handleViewTransaction = useCallback(() => {
    if (!saleResult) return;
    haptics.light();
    // Clear before cross-tab nav: the sale is finalised and the user is
    // leaving the success screen, so a stale cart shouldn't survive.
    clear();
    // Pop the QuickSale stack back to ProductGrid BEFORE cross-tab nav,
    // so returning to the Sale tab later shows products, not the stale
    // Checkout success view.
    resetSaleStack();
    // `initial: false` pushes SaleDetail on TOP of TransactionList in the
    // Transactions stack. Without it, React Navigation rewrites the stack
    // to JUST [SaleDetail], so a back press pops the whole tab away and
    // lands on the previous tab (Dashboard / QuickSale) instead of
    // returning to the transactions list. Same fix applied in
    // CustomerDetailScreen + DashboardScreen for cross-tab SaleDetail nav.
    navigation.navigate('Transactions', {
      screen: 'SaleDetail',
      params: {saleId: saleResult.sale_id},
      initial: false,
    });
  }, [saleResult, haptics, clear, navigation, resetSaleStack]);

  // Belt-and-braces: if the operator just tabs away from a completed
  // Checkout without tapping any of the three success actions, reset the
  // QuickSale stack on blur so the next return to the Sale tab lands on
  // ProductGrid (not the now-stale success view). Uses useFocusEffect's
  // cleanup — plain useEffect cleanup ONLY fires on unmount, but the
  // bottom-tab navigator keeps screens mounted across tab switches, so
  // useEffect cleanup never fires in this scenario. useFocusEffect's
  // cleanup runs on blur (the screen losing focus to another tab), which
  // is what we actually want. Gated on saleResult so a mid-checkout tab
  // switch (operator may want to come back to a half-filled tendered
  // amount) doesn't wipe their progress.
  useFocusEffect(
    useCallback(() => {
      return () => {
        if (saleResult) resetSaleStack();
      };
    }, [saleResult, resetSaleStack]),
  );

  // §19.2 rule 1: while Checkout is focused we're mid-transaction, so the
  // routing cascade must defer any cloud↔NAS switch. Set the activeScreen
  // marker on focus and clear it on blur.
  useFocusEffect(
    useCallback(() => {
      useTransactionActivityStore.getState().setActiveScreen('Checkout');
      return () => {
        const ta = useTransactionActivityStore.getState();
        if (ta.activeScreen === 'Checkout') ta.setActiveScreen(null);
      };
    }, []),
  );

  // Success view
  if (saleResult) {
    return (
      <SafeAreaView style={styles.container} edges={['left', 'right']}>
        <ScrollView contentContainerStyle={[styles.successContainer, tabletColumnCap]}>
          <View style={styles.successCard}>
            <View
              style={styles.successIconCircle}
              accessibilityElementsHidden
              importantForAccessibility="no">
              <Icon name="check" size={32} color={COLORS.cream} strokeWidth={2.5} />
            </View>
            <Text style={styles.successTitle}>Sale complete</Text>
            <Text style={styles.saleNumber}>
              #{saleResult.sale_number}
            </Text>
            <Text style={styles.saleTotal}>
              {formatCurrency(saleResult.total_cents)}
            </Text>
          </View>

          <View style={styles.successActions}>
            <TouchableOpacity
              style={styles.printButton}
              onPress={handlePrintReceipt}
              disabled={isPrinting}
              accessibilityRole="button"
              accessibilityLabel="Print receipt"
              accessibilityState={{disabled: isPrinting}}>
              {isPrinting ? (
                <ActivityIndicator color={COLORS.white} size="small" />
              ) : (
                <Text style={styles.printButtonText}>Print receipt</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.viewTransactionButton}
              onPress={handleViewTransaction}
              accessibilityRole="button"
              accessibilityLabel="View transaction">
              <Text style={styles.viewTransactionButtonText}>
                View transaction
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.newSaleButton}
              onPress={handleNewSale}
              accessibilityRole="button"
              accessibilityLabel="Start a new sale">
              <Text style={styles.newSaleButtonText}>New sale</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right']}>
      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentContainerStyle={[styles.scrollContent, tabletColumnCap]}
        keyboardShouldPersistTaps="handled">
        {/* Customer */}
        <View style={styles.customerRow}>
          <View style={styles.customerIconWrap}>
            <Icon
              name="person-outline"
              size={ICON_SIZE.action}
              color={COLORS.crimson}
            />
          </View>
          <View style={styles.customerTextWrap}>
            <Text style={styles.customerLabel}>Customer</Text>
            <Text style={styles.customerName} numberOfLines={1}>
              {customerId != null && customerName ? customerName : 'Walk-in'}
            </Text>
          </View>
          <TouchableOpacity
            style={styles.customerChangeBtn}
            onPress={() => {
              haptics.light();
              navigation.navigate('CustomerPicker');
            }}
            accessibilityRole="button"
            accessibilityLabel="Change customer">
            <Text style={styles.customerChangeText}>Change</Text>
            <Icon
              name="chevron-forward"
              size={ICON_SIZE.action}
              color={COLORS.accent}
            />
          </TouchableOpacity>
        </View>

        {/* Order Summary */}
        <View style={styles.summaryHeader}>
          <Text style={styles.summaryTotal}>
            Total: {formatCurrency(totalCents)}
          </Text>
          <Text style={styles.summaryItems}>
            {itemCount} {itemCount === 1 ? 'item' : 'items'}
          </Text>
        </View>

        {/* Payment Methods */}
        <EyebrowLabel>Payment method</EyebrowLabel>
        {paymentMethodsState === 'fallback' ? (
          <TouchableOpacity
            style={styles.methodsFallbackChip}
            onPress={loadPaymentMethods}
            accessibilityRole="button"
            accessibilityLabel="Retry loading payment methods">
            <Icon
              name="cloud-offline-outline"
              size={ICON_SIZE.action}
              color={COLORS.warning}
              style={styles.methodsFallbackIcon}
            />
            <Text style={styles.methodsFallbackText}>
              {paymentMethodsFallbackReason ??
                'Using offline defaults — tap to retry'}
            </Text>
          </TouchableOpacity>
        ) : null}
        <View style={styles.methodGrid}>
          {paymentMethods.map(method => {
            const selected = selectedMethod === method.code;
            const blocked = isMethodFailoverBlocked(method.code);
            return (
              <TouchableOpacity
                key={method.code}
                disabled={blocked}
                style={[
                  styles.methodButton,
                  selected && styles.methodButtonActive,
                  blocked && styles.methodButtonBlocked,
                  tabletMethodTileCap,
                ]}
                accessibilityRole="button"
                accessibilityLabel={
                  blocked
                    ? `${method.name} unavailable during on-prem failover`
                    : `Payment method ${method.name}`
                }
                accessibilityState={{selected, disabled: blocked}}
                onPress={() => {
                  setSelectedMethod(method.code);
                  setAmountTendered('');
                }}>
                <Text
                  style={[
                    styles.methodButtonText,
                    selected && styles.methodButtonTextActive,
                    blocked && styles.methodButtonTextBlocked,
                  ]}>
                  {method.name}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        {failoverTenderGateActive ? (
          <Text style={styles.failoverHint}>
            On-prem failover — cash only. Other tenders resume when the cloud
            is back.
          </Text>
        ) : null}

        {/* Cash: Amount Tendered */}
        {selectedMethod === 'cash' && (
          <View style={styles.cashSection}>
            <EyebrowLabel>Amount tendered</EyebrowLabel>
            <View style={styles.amountRow}>
              <TextInput
                style={styles.amountInputFlex}
                value={amountTendered}
                onChangeText={setAmountTendered}
                keyboardType="decimal-pad"
                placeholder="0.00"
                placeholderTextColor={COLORS.textDim}
                // iOS-only — surfaces a Done toolbar above the decimal-pad
                // since the decimal-pad has no Return key. Android's
                // numeric keyboard already supports back-button dismiss.
                inputAccessoryViewID={
                  Platform.OS === 'ios' ? CASH_TENDER_ACCESSORY_ID : undefined
                }
              />
              {/* Quick-fill: snap tendered to the exact cart total. Common
                  POS shortcut for the "customer hands you exact cash"
                  case so the cashier doesn't have to type it digit-by-digit. */}
              <TouchableOpacity
                style={styles.exactButton}
                onPress={() => {
                  setAmountTendered((totalCents / 100).toFixed(2));
                  Keyboard.dismiss();
                }}
                accessibilityRole="button"
                accessibilityLabel="Fill exact total">
                <Text style={styles.exactButtonText}>Exact</Text>
              </TouchableOpacity>
            </View>
            {tenderedCents > 0 && tenderedCents >= totalCents && (
              <View style={styles.changeDisplay}>
                <Text style={styles.changeLabel}>Change</Text>
                <Text style={styles.changeValue}>
                  {formatCurrency(changeCents)}
                </Text>
              </View>
            )}
            {tenderedCents > 0 && tenderedCents < totalCents && (
              <Text style={styles.insufficientText}>
                Insufficient amount ({formatCurrency(totalCents - tenderedCents)}{' '}
                remaining)
              </Text>
            )}
          </View>
        )}

        {/* iOS-only accessory toolbar — a Done bar sitting directly above
            the decimal-pad keyboard so the cashier always has a clearly
            labelled dismiss affordance. decimal-pad has no Return key,
            which was leaving cashiers stuck on the keyboard with no
            obvious way back to the Complete Sale button. */}
        {Platform.OS === 'ios' && (
          <InputAccessoryView nativeID={CASH_TENDER_ACCESSORY_ID}>
            <View style={styles.accessoryBar}>
              <TouchableOpacity
                style={styles.accessoryDone}
                onPress={() => Keyboard.dismiss()}
                accessibilityRole="button"
                accessibilityLabel="Dismiss keyboard">
                <Text style={styles.accessoryDoneText}>Done</Text>
              </TouchableOpacity>
            </View>
          </InputAccessoryView>
        )}

        {/* Error */}
        {error ? (
          <View style={styles.errorWrap}>
            <ErrorBanner
              message={error}
              onDismiss={() => setError(null)}
            />
          </View>
        ) : null}

        {/* Complete Sale Button */}
        <TouchableOpacity
          style={[
            styles.completeSaleButton,
            !canComplete && styles.completeSaleButtonDisabled,
          ]}
          onPress={handleCompleteSale}
          disabled={!canComplete || isSubmitting}
          accessibilityRole="button"
          accessibilityLabel="Complete sale"
          accessibilityState={{disabled: !canComplete || isSubmitting}}>
          {isSubmitting ? (
            <ActivityIndicator color={COLORS.white} size="small" />
          ) : (
            <Text style={styles.completeSaleText}>Complete sale</Text>
          )}
        </TouchableOpacity>
        {/* M-R5 (§17.4): when writes are blocked by an unreachable on-prem
            server, the CTA is dead — surface the reason so the cashier
            knows to fall back to paper. */}
        {saleWritesBlocked ? (
          <Text style={styles.manualModeSubtext}>
            On-prem unavailable — record on paper
          </Text>
        ) : null}
      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  keyboardView: {
    flex: 1,
  },
  scrollContent: {
    padding: SPACING.md,
    // Clear the floating Aeris nav "A" so "Complete sale" isn't overlapped
    // (and its centre tap stolen) by it once scrolled to the bottom.
    paddingBottom: SPACING.md + A_CLEARANCE,
  },
  summaryHeader: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.surfaceBorder,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.lg,
    alignItems: 'center',
    marginBottom: SPACING.lg,
  },
  summaryTotal: {
    color: COLORS.text,
    fontSize: FONT_SIZE.xxl,
    fontFamily: FONT_FAMILY.bold,
    fontVariant: ['tabular-nums'],
  },
  summaryItems: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.md,
    marginTop: SPACING.xs,
  },
  methodGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
    marginBottom: SPACING.lg,
  },
  methodsFallbackChip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.warning,
    borderRadius: BORDER_RADIUS.md,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    marginBottom: SPACING.sm,
  },
  methodsFallbackIcon: {
    marginRight: SPACING.xs,
  },
  methodsFallbackText: {
    color: COLORS.warning,
    fontSize: FONT_SIZE.xs,
  },
  methodButton: {
    flex: 1,
    minWidth: 100,
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    paddingVertical: SPACING.md,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: COLORS.surfaceBorder,
  },
  methodButtonActive: {
    borderColor: COLORS.crimson,
    backgroundColor: COLORS.surfaceHover,
  },
  methodButtonText: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.md,
    fontFamily: FONT_FAMILY.medium,
  },
  methodButtonTextActive: {
    color: COLORS.crimson,
  },
  // On-prem failover: visually mute blocked tender tiles. Border + bg drop
  // to the disabled palette and opacity nudges down — the cashier reads
  // them as "not available right now", paired with the failoverHint below.
  methodButtonBlocked: {
    opacity: 0.45,
    borderColor: COLORS.surfaceBorder,
    backgroundColor: COLORS.surface,
  },
  methodButtonTextBlocked: {
    color: COLORS.textDim,
  },
  failoverHint: {
    marginTop: SPACING.sm,
    color: COLORS.warningText,
    fontSize: FONT_SIZE.sm,
    fontFamily: FONT_FAMILY.medium,
    textAlign: 'center',
  },
  cashSection: {
    marginBottom: SPACING.lg,
  },
  // amountInput retained as a "wide" alias for older call sites. The
  // checkout cash row now uses amountInputFlex (flex:1) so the
  // "Exact" quick-fill button can sit alongside without overflowing.
  amountInput: {
    backgroundColor: COLORS.inputBg,
    borderWidth: 1,
    borderColor: COLORS.inputBorder,
    borderRadius: BORDER_RADIUS.lg,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    color: COLORS.text,
    fontSize: FONT_SIZE.xxl,
    fontFamily: FONT_FAMILY.bold,
    textAlign: 'center',
    marginBottom: SPACING.sm,
    fontVariant: ['tabular-nums'],
  },
  amountRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: SPACING.sm,
    marginBottom: SPACING.sm,
  },
  amountInputFlex: {
    flex: 1,
    backgroundColor: COLORS.inputBg,
    borderWidth: 1,
    borderColor: COLORS.inputBorder,
    borderRadius: BORDER_RADIUS.lg,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    color: COLORS.text,
    fontSize: FONT_SIZE.xxl,
    fontFamily: FONT_FAMILY.bold,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  exactButton: {
    paddingHorizontal: SPACING.lg,
    justifyContent: 'center',
    backgroundColor: COLORS.text,
    borderRadius: BORDER_RADIUS.lg,
  },
  exactButtonText: {
    color: COLORS.white,
    fontSize: FONT_SIZE.md,
    fontFamily: FONT_FAMILY.bold,
  },
  accessoryBar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    backgroundColor: COLORS.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.surfaceBorder,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
  },
  accessoryDone: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
  },
  accessoryDoneText: {
    color: COLORS.accent,
    fontSize: FONT_SIZE.md,
    fontFamily: FONT_FAMILY.bold,
  },
  changeDisplay: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.surfaceBorder,
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md,
  },
  changeLabel: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.md,
  },
  changeValue: {
    // Brand affirmative pairing per §04 is cream + crimson, not Stripe-green.
    color: COLORS.crimson,
    fontSize: FONT_SIZE.lg,
    fontFamily: FONT_FAMILY.bold,
    fontVariant: ['tabular-nums'],
  },
  insufficientText: {
    color: COLORS.warning,
    fontSize: FONT_SIZE.sm,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  errorWrap: {
    marginBottom: SPACING.md,
  },
  completeSaleButton: {
    backgroundColor: COLORS.crimson, // brand primary CTA (was COLORS.success — green looked like Stripe)
    borderRadius: BORDER_RADIUS.lg,
    paddingVertical: SPACING.md,
    alignItems: 'center',
    marginTop: SPACING.sm,
  },
  completeSaleButtonDisabled: {
    opacity: 0.5,
  },
  completeSaleText: {
    color: COLORS.white,
    fontSize: FONT_SIZE.lg,
    fontFamily: FONT_FAMILY.bold,
  },
  // M-R5: subtext under the disabled Complete-sale CTA in manual mode.
  manualModeSubtext: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.sm,
    fontFamily: FONT_FAMILY.regular,
    textAlign: 'center',
    marginTop: SPACING.sm,
  },
  // Success screen styles
  successContainer: {
    flex: 1,
    justifyContent: 'center',
    padding: SPACING.lg,
  },
  successCard: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.surfaceBorder,
    borderRadius: BORDER_RADIUS.xl,
    padding: SPACING.xl,
    alignItems: 'center',
    marginBottom: SPACING.lg,
  },
  successIconCircle: {
    // Cream check on a crimson disc — the on-brand affirmative pairing per
    // §04. Sized to roughly match the previous 48px tick's visual weight.
    width: 64,
    height: 64,
    borderRadius: BORDER_RADIUS.full,
    backgroundColor: COLORS.crimson,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.md,
  },
  successTitle: {
    color: COLORS.text,
    fontSize: FONT_SIZE.xxl,
    fontFamily: FONT_FAMILY.bold,
    marginBottom: SPACING.sm,
  },
  saleNumber: {
    color: COLORS.accent,
    fontSize: FONT_SIZE.xl,
    fontFamily: FONT_FAMILY.bold,
    fontVariant: ['tabular-nums'],
  },
  saleTotal: {
    color: COLORS.accent,
    fontSize: FONT_SIZE.xxl,
    fontFamily: FONT_FAMILY.bold,
    marginTop: SPACING.sm,
    fontVariant: ['tabular-nums'],
  },
  successActions: {
    gap: SPACING.md,
  },
  printButton: {
    backgroundColor: COLORS.accent,
    borderRadius: BORDER_RADIUS.lg,
    paddingVertical: SPACING.md,
    alignItems: 'center',
  },
  printButtonText: {
    color: COLORS.white,
    fontSize: FONT_SIZE.md,
    fontFamily: FONT_FAMILY.bold,
  },
  newSaleButton: {
    backgroundColor: COLORS.crimson,
    borderRadius: BORDER_RADIUS.lg,
    paddingVertical: SPACING.md,
    alignItems: 'center',
  },
  newSaleButtonText: {
    color: COLORS.white,
    fontSize: FONT_SIZE.md,
    fontFamily: FONT_FAMILY.bold,
  },
  viewTransactionButton: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.surfaceBorder,
    borderRadius: BORDER_RADIUS.lg,
    paddingVertical: SPACING.md,
    alignItems: 'center',
  },
  viewTransactionButtonText: {
    color: COLORS.text,
    fontSize: FONT_SIZE.md,
    fontFamily: FONT_FAMILY.bold,
  },
  customerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.surfaceBorder,
    borderRadius: BORDER_RADIUS.lg,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
    marginBottom: SPACING.md,
  },
  customerIconWrap: {
    width: 36,
    height: 36,
    borderRadius: BORDER_RADIUS.full,
    backgroundColor: COLORS.cream,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: SPACING.md,
  },
  customerTextWrap: {flex: 1},
  customerLabel: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.xs,
    fontFamily: FONT_FAMILY.medium,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  customerName: {
    color: COLORS.text,
    fontSize: FONT_SIZE.md,
    fontFamily: FONT_FAMILY.medium,
    marginTop: 2,
  },
  customerChangeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
  },
  customerChangeText: {
    color: COLORS.accent,
    fontSize: FONT_SIZE.sm,
    fontFamily: FONT_FAMILY.bold,
    marginRight: 2,
  },
});
