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
import {useCartStore} from '../stores/cartStore';
import {useHaptics} from '../hooks/useHaptics';
import {useResponsiveLayout} from '../hooks/useResponsiveLayout';
import ApiClient from '../services/ApiClient';
import PrintService from '../services/PrintService';
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

const DEFAULT_PAYMENT_METHODS: PaymentMethod[] = [
  {code: 'cash', name: 'Cash', requires_reference: false},
  {code: 'card', name: 'Card', requires_reference: false},
  {code: 'account', name: 'Account', requires_reference: false},
];

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
  const [isPrinting, setIsPrinting] = useState(false);

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

  const canComplete =
    paymentMethodsState === 'live' &&
    selectedMethod !== null &&
    (selectedMethod !== 'cash' || tenderedCents >= totalCents);

  // Synchronous double-tap guard. `setIsSubmitting(true)` is async — between
  // the press and the next render a fast double-tap on iOS can fire this
  // handler twice. Each invocation generates its own idempotency key inside
  // createSale, so two sales would post. The ref flips before any awaits.
  const submitLockRef = useRef(false);

  const handleCompleteSale = useCallback(async () => {
    if (!selectedMethod) return;
    if (submitLockRef.current) return;
    submitLockRef.current = true;

    haptics.medium();
    setIsSubmitting(true);
    setError(null);

    try {
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
      });

      haptics.success();
      // Broadcast a "sale just landed" timestamp so the Dashboard's
      // useFocusEffect refetches its summary on the next focus and the
      // operator doesn't see a stale "Quiet so far" empty state.
      markSaleCompleted();
      setSaleResult(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Sale failed';
      haptics.error();
      setError(msg);
    } finally {
      setIsSubmitting(false);
      submitLockRef.current = false;
    }
  }, [selectedMethod, items, totalCents, customerId, discountCents, notes, haptics, markSaleCompleted]);

  const handlePrintReceipt = useCallback(async () => {
    if (!saleResult) return;
    setIsPrinting(true);
    try {
      const receipt = await ApiClient.getReceipt(saleResult.sale_id);
      const html = buildReceiptHtml(receipt);
      await PrintService.printHtml(html);
    } catch {
      haptics.error();
      setError('Failed to print receipt');
    } finally {
      setIsPrinting(false);
    }
  }, [saleResult, haptics]);

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
            return (
              <TouchableOpacity
                key={method.code}
                style={[
                  styles.methodButton,
                  selected && styles.methodButtonActive,
                  tabletMethodTileCap,
                ]}
                accessibilityRole="button"
                accessibilityLabel={`Payment method ${method.name}`}
                accessibilityState={{selected}}
                onPress={() => {
                  setSelectedMethod(method.code);
                  setAmountTendered('');
                }}>
                <Text
                  style={[
                    styles.methodButtonText,
                    selected && styles.methodButtonTextActive,
                  ]}>
                  {method.name}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Cash: Amount Tendered */}
        {selectedMethod === 'cash' && (
          <View style={styles.cashSection}>
            <EyebrowLabel>Amount tendered</EyebrowLabel>
            <TextInput
              style={styles.amountInput}
              value={amountTendered}
              onChangeText={setAmountTendered}
              keyboardType="decimal-pad"
              placeholder="0.00"
              placeholderTextColor={COLORS.textDim}
            />
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
      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildReceiptHtml(receipt: {
  business_name: string;
  sale_number: string;
  date: string;
  items: Array<{name: string; quantity: number; unit_price: string; line_total: string}>;
  subtotal: string;
  tax: string;
  total: string;
  payments: Array<{method: string; amount: string}>;
  served_by: string | null;
}): string {
  const itemRows = receipt.items
    .map(
      i =>
        `<tr><td>${escapeHtml(i.name)}</td><td>${i.quantity}</td><td>${escapeHtml(i.unit_price)}</td><td>${escapeHtml(i.line_total)}</td></tr>`,
    )
    .join('');

  const paymentRows = receipt.payments
    .map(p => `<p>${escapeHtml(p.method)}: ${escapeHtml(p.amount)}</p>`)
    .join('');

  return `
    <html>
    <head><style>
      body { font-family: monospace; font-size: 12px; padding: 10px; }
      h2 { text-align: center; margin-bottom: 4px; }
      .info { text-align: center; font-size: 11px; color: #666; }
      table { width: 100%; border-collapse: collapse; margin: 8px 0; }
      td { padding: 2px 4px; }
      .sep { border-top: 1px dashed #333; margin: 6px 0; }
      .totals td:first-child { font-weight: bold; }
      .total-row td { font-size: 14px; font-weight: bold; }
    </style></head>
    <body>
      <h2>${escapeHtml(receipt.business_name)}</h2>
      <p class="info">Sale #${escapeHtml(receipt.sale_number)}</p>
      <p class="info">${escapeHtml(receipt.date)}</p>
      <div class="sep"></div>
      <table>
        <tr><th>Item</th><th>Qty</th><th>Price</th><th>Total</th></tr>
        ${itemRows}
      </table>
      <div class="sep"></div>
      <table class="totals">
        <tr><td>Subtotal</td><td>${escapeHtml(receipt.subtotal)}</td></tr>
        <tr><td>Tax</td><td>${escapeHtml(receipt.tax)}</td></tr>
        <tr class="total-row"><td>Total</td><td>${escapeHtml(receipt.total)}</td></tr>
      </table>
      <div class="sep"></div>
      ${paymentRows}
      ${receipt.served_by ? `<p class="info">Served by: ${escapeHtml(receipt.served_by)}</p>` : ''}
    </body>
    </html>
  `;
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
  cashSection: {
    marginBottom: SPACING.lg,
  },
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
