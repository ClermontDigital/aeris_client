import React, {useState, useEffect, useCallback} from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {useNavigation, useRoute} from '@react-navigation/native';
import type {RouteProp} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {Ionicons} from '@expo/vector-icons';
import {COLORS, SPACING, FONT_SIZE, BORDER_RADIUS} from '../constants/theme';
import ApiClient from '../services/ApiClient';
import {useHaptics} from '../hooks/useHaptics';
import type {SaleDetail, Sale} from '../types/api.types';
import type {TransactionsStackParamList} from '../types/navigation.types';
import {formatCurrency} from '../utils/format';

type SaleDetailRouteProp = RouteProp<TransactionsStackParamList, 'SaleDetail'>;
type Nav = NativeStackNavigationProp<TransactionsStackParamList>;

function formatDateTime(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getStatusColor(status: Sale['status']): string {
  switch (status) {
    case 'completed':
      return COLORS.success;
    case 'refunded':
      return COLORS.danger;
    case 'voided':
      return COLORS.warning;
    default:
      return COLORS.textDim;
  }
}

export default function SaleDetailScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<SaleDetailRouteProp>();
  const haptics = useHaptics();
  const {saleId} = route.params;

  const [sale, setSale] = useState<SaleDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isUnavailable, setIsUnavailable] = useState(false);
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    setIsUnavailable(false);
    setNotFound(false);
    try {
      const data = await ApiClient.getTransactionDetail(saleId);
      if (data == null) {
        setNotFound(true);
      } else {
        setSale(data);
      }
    } catch {
      setIsUnavailable(true);
    } finally {
      setIsLoading(false);
    }
  }, [saleId]);

  useEffect(() => {
    load();
  }, [load]);

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container} edges={['left', 'right', 'bottom']}>
        <View style={styles.center}>
          <ActivityIndicator color={COLORS.accent} size="large" />
        </View>
      </SafeAreaView>
    );
  }

  if (isUnavailable) {
    return (
      <SafeAreaView style={styles.container} edges={['left', 'right', 'bottom']}>
        <View style={styles.center}>
          <Text style={styles.errorTitle}>Detail view is not available yet</Text>
          <Text style={styles.errorBody}>
            We couldn&apos;t load this sale right now. Please try again in a
            moment.
          </Text>
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={() => {
              haptics.light();
              load();
            }}>
            <Text style={styles.primaryBtnText}>Retry</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => {
              haptics.light();
              navigation.goBack();
            }}>
            <Text style={styles.linkText}>Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (notFound || !sale) {
    return (
      <SafeAreaView style={styles.container} edges={['left', 'right', 'bottom']}>
        <View style={styles.center}>
          <Text style={styles.errorTitle}>Sale not found</Text>
          <TouchableOpacity
            onPress={() => {
              haptics.light();
              navigation.goBack();
            }}>
            <Text style={styles.linkText}>Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const customerName = sale.customer?.name || sale.customer_name || 'Walk-in';

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right', 'bottom']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.card}>
          <View style={styles.headerRow}>
            <View style={styles.headerLeft}>
              <Text style={styles.saleNumber}>{sale.sale_number}</Text>
              <Text style={styles.saleDate}>
                {formatDateTime(sale.created_at)}
              </Text>
            </View>
            <View
              style={[
                styles.statusChip,
                {backgroundColor: getStatusColor(sale.status)},
              ]}>
              <Text style={styles.statusText}>{sale.status}</Text>
            </View>
          </View>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Customer</Text>
            <Text style={styles.rowValue}>{customerName}</Text>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Items</Text>
          {sale.items.length === 0 ? (
            <Text style={styles.emptyText}>No items</Text>
          ) : (
            sale.items.map((item, idx) => (
              <View key={idx} style={styles.itemRow}>
                <View style={styles.itemLeft}>
                  <Text style={styles.itemName} numberOfLines={2}>
                    {item.product_name}
                  </Text>
                  <Text style={styles.itemMeta}>
                    {item.quantity} × {formatCurrency(item.unit_price_cents)}
                  </Text>
                </View>
                <Text style={styles.itemTotal}>
                  {formatCurrency(item.line_total_cents)}
                </Text>
              </View>
            ))
          )}
        </View>

        <View style={styles.card}>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Subtotal</Text>
            <Text style={styles.totalValue}>
              {formatCurrency(sale.subtotal_cents)}
            </Text>
          </View>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Tax</Text>
            <Text style={styles.totalValue}>
              {formatCurrency(sale.tax_cents)}
            </Text>
          </View>
          {sale.discount_cents !== 0 ? (
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Discount</Text>
              <Text style={styles.totalValue}>
                −{formatCurrency(sale.discount_cents)}
              </Text>
            </View>
          ) : null}
          <View style={[styles.totalRow, styles.grandTotalRow]}>
            <Text style={styles.grandTotalLabel}>Total</Text>
            <Text style={styles.grandTotalValue}>
              {formatCurrency(sale.total_cents)}
            </Text>
          </View>
        </View>

        {sale.payments.length > 0 ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Payments</Text>
            {sale.payments.map((p, idx) => (
              <View key={idx} style={styles.paymentRow}>
                <Text style={styles.paymentMethod}>{p.method}</Text>
                <Text style={styles.paymentAmount}>
                  {formatCurrency(p.amount_cents)}
                </Text>
              </View>
            ))}
          </View>
        ) : null}

        <View style={styles.actions}>
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={() => {
              haptics.light();
              navigation.navigate('Receipt', {saleId: sale.id});
            }}>
            <Text style={styles.primaryBtnText}>View Receipt</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => {
              haptics.light();
              navigation.goBack();
            }}>
            <Ionicons
              name="chevron-back"
              size={20}
              color={COLORS.white}
              style={styles.backBtnIcon}
            />
            <Text style={styles.backBtnText}>Back</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: COLORS.background},
  scroll: {padding: SPACING.md, paddingBottom: SPACING.xxl},
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING.lg,
  },
  card: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.surfaceBorder,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.sm,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.sm,
  },
  headerLeft: {flex: 1, marginRight: SPACING.md},
  saleNumber: {
    color: COLORS.text,
    fontSize: FONT_SIZE.lg,
    fontWeight: '700',
  },
  saleDate: {color: COLORS.textMuted, fontSize: FONT_SIZE.sm, marginTop: 2},
  statusChip: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: 4,
    borderRadius: BORDER_RADIUS.full,
  },
  statusText: {
    color: COLORS.white,
    fontSize: FONT_SIZE.xs,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  sectionTitle: {
    color: COLORS.text,
    fontSize: FONT_SIZE.md,
    fontWeight: '700',
    marginBottom: SPACING.sm,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: SPACING.sm,
    borderTopWidth: 1,
    borderTopColor: COLORS.surfaceBorder,
  },
  rowLabel: {color: COLORS.textMuted, fontSize: FONT_SIZE.md},
  rowValue: {
    color: COLORS.text,
    fontSize: FONT_SIZE.md,
    fontWeight: '600',
  },
  itemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingVertical: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.surfaceBorder,
  },
  itemLeft: {flex: 1, marginRight: SPACING.md},
  itemName: {color: COLORS.text, fontSize: FONT_SIZE.md, fontWeight: '600'},
  itemMeta: {color: COLORS.textMuted, fontSize: FONT_SIZE.sm, marginTop: 2},
  itemTotal: {
    color: COLORS.text,
    fontSize: FONT_SIZE.md,
    fontWeight: '700',
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: SPACING.xs,
  },
  totalLabel: {color: COLORS.textMuted, fontSize: FONT_SIZE.md},
  totalValue: {color: COLORS.text, fontSize: FONT_SIZE.md},
  grandTotalRow: {
    marginTop: SPACING.xs,
    paddingTop: SPACING.sm,
    borderTopWidth: 1,
    borderTopColor: COLORS.surfaceBorder,
  },
  grandTotalLabel: {
    color: COLORS.text,
    fontSize: FONT_SIZE.lg,
    fontWeight: '700',
  },
  grandTotalValue: {
    color: COLORS.crimson,
    fontSize: FONT_SIZE.xl,
    fontWeight: '700',
  },
  paymentRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: SPACING.xs,
  },
  paymentMethod: {
    color: COLORS.textLight,
    fontSize: FONT_SIZE.md,
    textTransform: 'capitalize',
  },
  paymentAmount: {color: COLORS.text, fontSize: FONT_SIZE.md, fontWeight: '600'},
  emptyText: {color: COLORS.textMuted, fontSize: FONT_SIZE.sm},
  actions: {
    marginTop: SPACING.sm,
  },
  primaryBtn: {
    backgroundColor: COLORS.crimson,
    paddingVertical: SPACING.md,
    borderRadius: BORDER_RADIUS.lg,
    alignItems: 'center',
    marginBottom: SPACING.sm,
  },
  primaryBtnText: {color: COLORS.white, fontWeight: '700', fontSize: FONT_SIZE.md},
  backBtn: {
    flexDirection: 'row',
    backgroundColor: COLORS.text,
    paddingVertical: SPACING.md,
    borderRadius: BORDER_RADIUS.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backBtnIcon: {marginRight: SPACING.xs},
  backBtnText: {
    color: COLORS.white,
    fontSize: FONT_SIZE.md,
    fontWeight: '600',
  },
  errorTitle: {
    color: COLORS.text,
    fontSize: FONT_SIZE.lg,
    fontWeight: '700',
    marginBottom: SPACING.sm,
    textAlign: 'center',
  },
  errorBody: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.md,
    textAlign: 'center',
    marginBottom: SPACING.lg,
  },
  linkText: {color: COLORS.accent, fontSize: FONT_SIZE.md},
});
