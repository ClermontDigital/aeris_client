import React, {useState, useEffect, useCallback} from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {useNavigation, useRoute} from '@react-navigation/native';
import type {RouteProp} from '@react-navigation/native';
import Icon from '../components/Icon';
import {
  COLORS,
  SPACING,
  FONT_SIZE,
  FONT_FAMILY,
  BORDER_RADIUS,
  ICON_SIZE,
} from '../constants/theme';
import ApiClient from '../services/ApiClient';
import ErrorBanner from '../components/ErrorBanner';
import {useResponsiveLayout} from '../hooks/useResponsiveLayout';
import {usePrintReceipt} from '../hooks/usePrintReceipt';
import type {ReceiptData} from '../types/api.types';
import type {TransactionsStackParamList} from '../types/navigation.types';

type ReceiptRouteProp = RouteProp<TransactionsStackParamList, 'Receipt'>;

export default function ReceiptViewerScreen() {
  const navigation = useNavigation();
  const route = useRoute<ReceiptRouteProp>();
  const {isTablet} = useResponsiveLayout();
  // Receipts are narrow by convention (printable). On iPad cap at 480pt
  // so we don't stretch the card across half a screen.
  const tabletReceiptCap = isTablet
    ? ({maxWidth: 480, alignSelf: 'center', width: '100%'} as const)
    : null;
  const {saleId} = route.params;

  const [receipt, setReceipt] = useState<ReceiptData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Shared receipt-print flow (same hook CheckoutScreen uses post-sale).
  // Branches on PDF_PRINT_ENABLED, handles cloud vs direct mode, signed-
  // URL TTL + retry, double-tap guard, and Android share-sheet fallback.
  const {isPrinting, printReceipt} = usePrintReceipt();
  const [printError, setPrintError] = useState<string | null>(null);

  useEffect(() => {
    loadReceipt();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saleId]);

  const loadReceipt = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await ApiClient.getReceipt(saleId);
      setReceipt(data);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to load receipt';
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  }, [saleId]);

  const handlePrint = useCallback(async () => {
    setPrintError(null);
    try {
      await printReceipt(saleId);
    } catch {
      setPrintError('Failed to print receipt');
    }
  }, [saleId, printReceipt]);

  // Loading state
  if (isLoading) {
    return (
      <SafeAreaView style={styles.container} edges={['left', 'right']}>
        <View style={styles.centerContent}>
          <ActivityIndicator color={COLORS.accent} size="large" />
          <Text style={styles.loadingText}>Loading receipt...</Text>
        </View>
      </SafeAreaView>
    );
  }

  // Error state
  if (error || !receipt) {
    return (
      <SafeAreaView style={styles.container} edges={['left', 'right']}>
        <View style={styles.errorWrap}>
          <ErrorBanner
            message={error || 'Receipt not found'}
            onRetry={loadReceipt}
          />
        </View>
        <View style={styles.centerContent}>
          <TouchableOpacity
            style={styles.backButtonAlt}
            onPress={() => navigation.goBack()}>
            <Text style={styles.backButtonAltText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right']}>
      <ScrollView contentContainerStyle={[styles.scrollContent, tabletReceiptCap]}>
        {/* Receipt Card */}
        <View style={styles.receiptCard}>
          {/* Business Name */}
          <Text style={styles.businessName}>{receipt.business_name}</Text>
          {receipt.business_address ? (
            <Text style={styles.businessAddress}>
              {receipt.business_address}
            </Text>
          ) : null}

          {/* Sale Info */}
          <View style={styles.saleInfo}>
            <Text style={styles.saleNumber}>Sale #{receipt.sale_number}</Text>
            <Text style={styles.saleDate}>{receipt.date}</Text>
          </View>

          {/* Separator */}
          <View style={styles.separator} />

          {/* Items */}
          <View style={styles.itemsSection}>
            {/* Items Header */}
            <View style={styles.itemHeaderRow}>
              <Text style={[styles.itemHeaderText, {flex: 2}]}>Item</Text>
              <Text style={[styles.itemHeaderText, {flex: 0.5, textAlign: 'center'}]}>
                Qty
              </Text>
              <Text style={[styles.itemHeaderText, {flex: 1, textAlign: 'right'}]}>
                Price
              </Text>
              <Text style={[styles.itemHeaderText, {flex: 1, textAlign: 'right'}]}>
                Total
              </Text>
            </View>

            {receipt.items.map((item, index) => (
              <View key={index} style={styles.itemRow}>
                <Text
                  style={[styles.itemText, {flex: 2}]}
                  numberOfLines={2}>
                  {item.name}
                </Text>
                <Text
                  style={[
                    styles.itemText,
                    {flex: 0.5, textAlign: 'center'},
                  ]}>
                  {item.quantity}
                </Text>
                <Text
                  style={[styles.itemText, {flex: 1, textAlign: 'right'}]}>
                  {item.unit_price}
                </Text>
                <Text
                  style={[
                    styles.itemText,
                    styles.itemTotalText,
                    {flex: 1, textAlign: 'right'},
                  ]}>
                  {item.line_total}
                </Text>
              </View>
            ))}
          </View>

          {/* Separator */}
          <View style={styles.separator} />

          {/* Totals */}
          <View style={styles.totalsSection}>
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Subtotal</Text>
              <Text style={styles.totalValue}>{receipt.subtotal}</Text>
            </View>
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Tax</Text>
              <Text style={styles.totalValue}>{receipt.tax}</Text>
            </View>
            <View style={[styles.totalRow, styles.grandTotalRow]}>
              <Text style={styles.grandTotalLabel}>Total</Text>
              <Text style={styles.grandTotalValue}>{receipt.total}</Text>
            </View>
          </View>

          {/* Separator */}
          <View style={styles.separator} />

          {/* Payments */}
          <View style={styles.paymentsSection}>
            <Text style={styles.paymentTitle}>Payment</Text>
            {receipt.payments.map((payment, index) => (
              <View key={index} style={styles.paymentRow}>
                <Text style={styles.paymentMethod}>{payment.method}</Text>
                <Text style={styles.paymentAmount}>{payment.amount}</Text>
              </View>
            ))}
          </View>

          {/* Served By */}
          {receipt.served_by && (
            <Text style={styles.servedBy}>
              Served by: {receipt.served_by}
            </Text>
          )}
        </View>

        {/* Print-only error — receipt itself loaded fine, but a reprint
            attempt failed. Inline so the user keeps seeing the receipt
            and can retry without losing context. */}
        {printError ? (
          <View style={styles.printErrorWrap}>
            <ErrorBanner message={printError} onRetry={handlePrint} />
          </View>
        ) : null}

        {/* Action Buttons — Back (secondary) + Print (primary, full-width
            on phones, side-by-side on tablets). The Print path mirrors
            the post-sale flow on CheckoutScreen exactly. */}
        <View style={styles.actionButtons}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => navigation.goBack()}>
            <Icon
              name="chevron-back"
              size={ICON_SIZE.action}
              color={COLORS.white}
              style={styles.backButtonIcon}
            />
            <Text style={styles.backButtonText}>Back</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.printButton, isPrinting && styles.printButtonBusy]}
            onPress={handlePrint}
            disabled={isPrinting}
            accessibilityState={{disabled: isPrinting}}
            accessibilityLabel="Print receipt">
            {isPrinting ? (
              <ActivityIndicator color={COLORS.white} size="small" />
            ) : (
              <>
                <Icon
                  name="printer"
                  size={ICON_SIZE.action}
                  color={COLORS.white}
                  style={styles.backButtonIcon}
                />
                <Text style={styles.backButtonText}>Print</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  scrollContent: {
    padding: SPACING.md,
    paddingBottom: SPACING.xxl,
  },
  centerContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.lg,
  },
  loadingText: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.md,
    marginTop: SPACING.md,
  },
  errorWrap: {
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.md,
  },
  backButtonAlt: {
    paddingVertical: SPACING.sm,
  },
  backButtonAltText: {
    color: COLORS.accent,
    fontSize: FONT_SIZE.md,
  },
  // Receipt Card — light "paper" look
  receiptCard: {
    backgroundColor: COLORS.white,
    borderRadius: BORDER_RADIUS.xl,
    padding: SPACING.lg,
    marginBottom: SPACING.lg,
    shadowColor: COLORS.black,
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
  businessName: {
    color: COLORS.primary,
    fontSize: FONT_SIZE.xl,
    fontFamily: FONT_FAMILY.bold,
    textAlign: 'center',
    marginBottom: SPACING.xs,
  },
  businessAddress: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.sm,
    textAlign: 'center',
    marginBottom: SPACING.md,
  },
  saleInfo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: SPACING.md,
  },
  saleNumber: {
    color: COLORS.text,
    fontSize: FONT_SIZE.sm,
    fontFamily: FONT_FAMILY.medium,
    fontVariant: ['tabular-nums'],
  },
  saleDate: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.sm,
  },
  separator: {
    height: 1,
    backgroundColor: COLORS.surfaceBorder,
    marginVertical: SPACING.md,
  },
  // Items
  itemsSection: {},
  itemHeaderRow: {
    flexDirection: 'row',
    marginBottom: SPACING.sm,
  },
  itemHeaderText: {
    color: COLORS.textDim,
    fontSize: FONT_SIZE.xs,
    fontFamily: FONT_FAMILY.medium,
    textTransform: 'uppercase',
  },
  itemRow: {
    flexDirection: 'row',
    marginBottom: SPACING.sm,
    alignItems: 'flex-start',
    borderBottomWidth: 1,
    borderBottomColor: COLORS.surfaceBorder,
    paddingBottom: SPACING.sm,
  },
  itemText: {
    color: COLORS.text,
    fontSize: FONT_SIZE.sm,
    fontVariant: ['tabular-nums'],
  },
  itemTotalText: {
    color: COLORS.text,
    fontFamily: FONT_FAMILY.medium,
  },
  // Totals
  totalsSection: {},
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: SPACING.xs,
  },
  totalLabel: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.md,
  },
  totalValue: {
    color: COLORS.text,
    fontSize: FONT_SIZE.md,
    fontVariant: ['tabular-nums'],
  },
  grandTotalRow: {
    marginTop: SPACING.sm,
    paddingTop: SPACING.sm,
    borderTopWidth: 1,
    borderTopColor: COLORS.surfaceBorder,
  },
  grandTotalLabel: {
    color: COLORS.text,
    fontSize: FONT_SIZE.lg,
    fontFamily: FONT_FAMILY.bold,
  },
  grandTotalValue: {
    color: COLORS.text,
    fontSize: FONT_SIZE.xl,
    fontFamily: FONT_FAMILY.bold,
    fontVariant: ['tabular-nums'],
  },
  // Payments
  paymentsSection: {},
  paymentTitle: {
    color: COLORS.textDim,
    fontSize: FONT_SIZE.xs,
    fontFamily: FONT_FAMILY.medium,
    textTransform: 'uppercase',
    marginBottom: SPACING.sm,
  },
  paymentRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: SPACING.xs,
  },
  paymentMethod: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.md,
    textTransform: 'capitalize',
  },
  paymentAmount: {
    color: COLORS.text,
    fontSize: FONT_SIZE.md,
    fontVariant: ['tabular-nums'],
  },
  servedBy: {
    color: COLORS.textDim,
    fontSize: FONT_SIZE.sm,
    textAlign: 'center',
    marginTop: SPACING.md,
  },
  // Action Buttons — flex row of two equal-width buttons (Back +
  // Print). Gap matches the inter-card spacing on the rest of the
  // receipt view so the row reads as a deliberate pair, not a stack.
  actionButtons: {
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  backButton: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: COLORS.text,
    borderRadius: BORDER_RADIUS.lg,
    paddingVertical: SPACING.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backButtonIcon: {marginRight: SPACING.xs},
  backButtonText: {
    color: COLORS.white,
    fontSize: FONT_SIZE.md,
    fontFamily: FONT_FAMILY.medium,
  },
  // Primary print CTA — crimson (Red Dirt Red, per brand spec) so it
  // reads as the affirmative action sitting next to the navy Back.
  printButton: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: COLORS.crimson,
    borderRadius: BORDER_RADIUS.lg,
    paddingVertical: SPACING.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  printButtonBusy: {
    opacity: 0.7,
  },
  printErrorWrap: {
    marginBottom: SPACING.md,
  },
});
