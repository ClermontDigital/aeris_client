import React, {useState, useEffect, useCallback} from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import * as Haptics from 'expo-haptics';
import {COLORS, SPACING, FONT_SIZE, BORDER_RADIUS} from '../constants/theme';
import {useCartStore} from '../stores/cartStore';
import ApiClient from '../services/ApiClient';
import PrintService from '../services/PrintService';
import type {PaymentMethod} from '../types/api.types';
import type {QuickSaleStackParamList} from '../types/navigation.types';

type NavigationProp = NativeStackNavigationProp<QuickSaleStackParamList>;

const formatCurrency = (cents: number) => '$' + (cents / 100).toFixed(2);

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
  const {items, customerId, discountCents, notes, getTotalCents, getItemCount, clear} =
    useCartStore();

  const totalCents = getTotalCents();
  const itemCount = getItemCount();

  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>(
    DEFAULT_PAYMENT_METHODS,
  );
  const [selectedMethod, setSelectedMethod] = useState<string | null>(null);
  const [amountTendered, setAmountTendered] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saleResult, setSaleResult] = useState<SaleResult | null>(null);
  const [isPrinting, setIsPrinting] = useState(false);

  // Load payment methods
  useEffect(() => {
    (async () => {
      try {
        const methods = await ApiClient.getPaymentMethods();
        if (methods.length > 0) {
          setPaymentMethods(methods);
        }
      } catch {
        // Fall back to defaults
      }
    })();
  }, []);

  const tenderedCents = Math.round(parseFloat(amountTendered || '0') * 100);
  const changeCents =
    selectedMethod === 'cash' && tenderedCents > totalCents
      ? tenderedCents - totalCents
      : 0;

  const canComplete =
    selectedMethod !== null &&
    (selectedMethod !== 'cash' || tenderedCents >= totalCents);

  const handleCompleteSale = useCallback(async () => {
    if (!selectedMethod) return;

    setIsSubmitting(true);
    setError(null);

    try {
      const saleItems = items.map(item => ({
        product_id: item.product.id,
        quantity: item.quantity,
        unit_price_cents: item.unit_price_cents,
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

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setSaleResult(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Sale failed';
      setError(msg);
    } finally {
      setIsSubmitting(false);
    }
  }, [selectedMethod, items, totalCents, customerId, discountCents, notes]);

  const handlePrintReceipt = useCallback(async () => {
    if (!saleResult) return;
    setIsPrinting(true);
    try {
      const receipt = await ApiClient.getReceipt(saleResult.sale_id);
      const html = buildReceiptHtml(receipt);
      await PrintService.printHtml(html);
    } catch {
      setError('Failed to print receipt');
    } finally {
      setIsPrinting(false);
    }
  }, [saleResult]);

  const handleNewSale = useCallback(() => {
    clear();
    navigation.navigate('ProductGrid');
  }, [clear, navigation]);

  // Success view
  if (saleResult) {
    return (
      <SafeAreaView style={styles.container} edges={['left', 'right', 'bottom']}>
        <ScrollView contentContainerStyle={styles.successContainer}>
          <View style={styles.successCard}>
            <Text style={styles.successIcon}>&#10003;</Text>
            <Text style={styles.successTitle}>Sale Complete</Text>
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
              disabled={isPrinting}>
              {isPrinting ? (
                <ActivityIndicator color={COLORS.white} size="small" />
              ) : (
                <Text style={styles.printButtonText}>Print Receipt</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.newSaleButton}
              onPress={handleNewSale}>
              <Text style={styles.newSaleButtonText}>New Sale</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right', 'bottom']}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
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
        <Text style={styles.sectionTitle}>Payment Method</Text>
        <View style={styles.methodGrid}>
          {paymentMethods.map(method => (
            <TouchableOpacity
              key={method.code}
              style={[
                styles.methodButton,
                selectedMethod === method.code && styles.methodButtonActive,
              ]}
              onPress={() => {
                setSelectedMethod(method.code);
                setAmountTendered('');
              }}>
              <Text
                style={[
                  styles.methodButtonText,
                  selectedMethod === method.code &&
                    styles.methodButtonTextActive,
                ]}>
                {method.name}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Cash: Amount Tendered */}
        {selectedMethod === 'cash' && (
          <View style={styles.cashSection}>
            <Text style={styles.sectionTitle}>Amount Tendered</Text>
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
        {error && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {/* Complete Sale Button */}
        <TouchableOpacity
          style={[
            styles.completeSaleButton,
            !canComplete && styles.completeSaleButtonDisabled,
          ]}
          onPress={handleCompleteSale}
          disabled={!canComplete || isSubmitting}>
          {isSubmitting ? (
            <ActivityIndicator color={COLORS.white} size="small" />
          ) : (
            <Text style={styles.completeSaleText}>Complete Sale</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
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
        `<tr><td>${i.name}</td><td>${i.quantity}</td><td>${i.unit_price}</td><td>${i.line_total}</td></tr>`,
    )
    .join('');

  const paymentRows = receipt.payments
    .map(p => `<p>${p.method}: ${p.amount}</p>`)
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
      <h2>${receipt.business_name}</h2>
      <p class="info">Sale #${receipt.sale_number}</p>
      <p class="info">${receipt.date}</p>
      <div class="sep"></div>
      <table>
        <tr><th>Item</th><th>Qty</th><th>Price</th><th>Total</th></tr>
        ${itemRows}
      </table>
      <div class="sep"></div>
      <table class="totals">
        <tr><td>Subtotal</td><td>${receipt.subtotal}</td></tr>
        <tr><td>Tax</td><td>${receipt.tax}</td></tr>
        <tr class="total-row"><td>Total</td><td>${receipt.total}</td></tr>
      </table>
      <div class="sep"></div>
      ${paymentRows}
      ${receipt.served_by ? `<p class="info">Served by: ${receipt.served_by}</p>` : ''}
    </body>
    </html>
  `;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
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
    fontWeight: '700',
  },
  summaryItems: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.md,
    marginTop: SPACING.xs,
  },
  sectionTitle: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.sm,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: SPACING.sm,
  },
  methodGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
    marginBottom: SPACING.lg,
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
    fontWeight: '600',
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
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: SPACING.sm,
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
    color: COLORS.success,
    fontSize: FONT_SIZE.lg,
    fontWeight: '700',
  },
  insufficientText: {
    color: COLORS.warning,
    fontSize: FONT_SIZE.sm,
    textAlign: 'center',
  },
  errorBanner: {
    backgroundColor: COLORS.danger,
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md,
    marginBottom: SPACING.md,
  },
  errorText: {
    color: COLORS.white,
    fontSize: FONT_SIZE.sm,
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
    fontWeight: '700',
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
  successIcon: {
    fontSize: 48,
    color: COLORS.success,
    marginBottom: SPACING.md,
  },
  successTitle: {
    color: COLORS.text,
    fontSize: FONT_SIZE.xxl,
    fontWeight: '700',
    marginBottom: SPACING.sm,
  },
  saleNumber: {
    color: COLORS.accent,
    fontSize: FONT_SIZE.xl,
    fontWeight: '700',
  },
  saleTotal: {
    color: COLORS.accent,
    fontSize: FONT_SIZE.xxl,
    fontWeight: '700',
    marginTop: SPACING.sm,
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
    fontWeight: '700',
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
    fontWeight: '700',
  },
});
