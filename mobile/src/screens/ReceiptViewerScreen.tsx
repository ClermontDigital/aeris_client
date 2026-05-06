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
import {Ionicons} from '@expo/vector-icons';
import {COLORS, SPACING, FONT_SIZE, BORDER_RADIUS} from '../constants/theme';
import ApiClient from '../services/ApiClient';
import type {ReceiptData} from '../types/api.types';
import type {TransactionsStackParamList} from '../types/navigation.types';

type ReceiptRouteProp = RouteProp<TransactionsStackParamList, 'Receipt'>;

export default function ReceiptViewerScreen() {
  const navigation = useNavigation();
  const route = useRoute<ReceiptRouteProp>();
  const {saleId} = route.params;

  const [receipt, setReceipt] = useState<ReceiptData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  // Loading state
  if (isLoading) {
    return (
      <SafeAreaView style={styles.container} edges={['left', 'right', 'bottom']}>
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
      <SafeAreaView style={styles.container} edges={['left', 'right', 'bottom']}>
        <View style={styles.centerContent}>
          <Text style={styles.errorTitle}>Failed to Load Receipt</Text>
          <Text style={styles.errorMessage}>{error || 'Receipt not found'}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={loadReceipt}>
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
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
    <SafeAreaView style={styles.container} edges={['left', 'right', 'bottom']}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
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

        {/* Action Buttons */}
        <View style={styles.actionButtons}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => navigation.goBack()}>
            <Ionicons
              name="chevron-back"
              size={20}
              color={COLORS.white}
              style={styles.backButtonIcon}
            />
            <Text style={styles.backButtonText}>Back</Text>
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
  errorTitle: {
    color: COLORS.text,
    fontSize: FONT_SIZE.xl,
    fontWeight: '700',
    marginBottom: SPACING.sm,
  },
  errorMessage: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.md,
    textAlign: 'center',
    marginBottom: SPACING.lg,
  },
  retryButton: {
    backgroundColor: COLORS.accent,
    borderRadius: BORDER_RADIUS.lg,
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.md,
    marginBottom: SPACING.sm,
  },
  retryButtonText: {
    color: COLORS.white,
    fontSize: FONT_SIZE.md,
    fontWeight: '600',
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
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: SPACING.xs,
  },
  businessAddress: {
    color: '#6b7280',
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
    color: '#374151',
    fontSize: FONT_SIZE.sm,
    fontWeight: '600',
  },
  saleDate: {
    color: '#6b7280',
    fontSize: FONT_SIZE.sm,
  },
  separator: {
    height: 1,
    backgroundColor: '#e5e7eb',
    marginVertical: SPACING.md,
  },
  // Items
  itemsSection: {},
  itemHeaderRow: {
    flexDirection: 'row',
    marginBottom: SPACING.sm,
  },
  itemHeaderText: {
    color: '#9ca3af',
    fontSize: FONT_SIZE.xs,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  itemRow: {
    flexDirection: 'row',
    marginBottom: SPACING.sm,
    alignItems: 'flex-start',
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
    paddingBottom: SPACING.sm,
  },
  itemText: {
    color: '#374151',
    fontSize: FONT_SIZE.sm,
  },
  itemTotalText: {
    color: '#111827',
    fontWeight: '600',
  },
  // Totals
  totalsSection: {},
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: SPACING.xs,
  },
  totalLabel: {
    color: '#6b7280',
    fontSize: FONT_SIZE.md,
  },
  totalValue: {
    color: '#374151',
    fontSize: FONT_SIZE.md,
  },
  grandTotalRow: {
    marginTop: SPACING.sm,
    paddingTop: SPACING.sm,
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
  },
  grandTotalLabel: {
    color: '#111827',
    fontSize: FONT_SIZE.lg,
    fontWeight: '700',
  },
  grandTotalValue: {
    color: '#111827',
    fontSize: FONT_SIZE.xl,
    fontWeight: '700',
  },
  // Payments
  paymentsSection: {},
  paymentTitle: {
    color: '#9ca3af',
    fontSize: FONT_SIZE.xs,
    fontWeight: '600',
    textTransform: 'uppercase',
    marginBottom: SPACING.sm,
  },
  paymentRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: SPACING.xs,
  },
  paymentMethod: {
    color: '#6b7280',
    fontSize: FONT_SIZE.md,
    textTransform: 'capitalize',
  },
  paymentAmount: {
    color: '#374151',
    fontSize: FONT_SIZE.md,
  },
  servedBy: {
    color: '#9ca3af',
    fontSize: FONT_SIZE.sm,
    textAlign: 'center',
    marginTop: SPACING.md,
  },
  // Action Buttons
  actionButtons: {
    flexDirection: 'row',
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
    fontWeight: '600',
  },
});
