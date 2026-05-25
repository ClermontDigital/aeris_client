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
import {useHaptics} from '../hooks/useHaptics';
import {useResponsiveLayout} from '../hooks/useResponsiveLayout';
import EmptyState from '../components/EmptyState';
import ErrorBanner from '../components/ErrorBanner';
import type {SaleDetail, Sale} from '../types/api.types';
import type {TransactionsStackParamList} from '../types/navigation.types';
import {formatCurrency} from '../utils/format';
import {useNavHistoryStore} from '../stores/navHistoryStore';

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
  const {isTablet} = useResponsiveLayout();
  const tabletColumnCap = isTablet
    ? ({maxWidth: 720, alignSelf: 'center', width: '100%'} as const)
    : null;
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

  // Cross-tab navigators: tap a customer name → Customers tab, CustomerDetail.
  // Tap a line-item → Items tab, ProductDetail. Both jump out of the
  // Transactions stack via the parent tab navigator.
  //
  // CRITICAL: these `useCallback`s MUST live above the early-return guards
  // below. React hooks must run in the same order on every render — the
  // previous shape (callbacks declared *after* the isLoading/isUnavailable/
  // notFound returns) called fewer hooks on the loading frame than on the
  // committed frame, which crashes the screen with "rendered more hooks
  // than previous render" the moment the user taps a transaction row.
  //
  // Cross-tab nav also pushes a breadcrumb so the back button on the
  // destination screen can return here, not bounce to ItemsList/CustomersList.
  const pushCrumb = useNavHistoryStore(s => s.push);
  const openCustomer = useCallback(
    (id: number) => {
      haptics.light();
      const parent = navigation.getParent?.();
      if (!parent) return;
      pushCrumb({
        tab: 'Transactions',
        screen: 'SaleDetail',
        params: {saleId},
      });
      (parent as unknown as {
        navigate: (tab: string, params: object) => void;
      }).navigate('Customers', {
        // initial: false APPENDS CustomerDetail onto the inner stack
        // with CustomersList as the underlying screen — so a subsequent
        // tap on the Customers tab can pop-to-root back to the list.
        // The default (initial: true) replaces the stack with just the
        // target screen, leaving nothing to pop to. Counter-intuitive
        // boolean per React Navigation v7 nested-navigator semantics —
        // verified against `getActionFromState`.
        initial: false,
        screen: 'CustomerDetail',
        params: {customerId: id},
      });
    },
    [navigation, haptics, pushCrumb, saleId],
  );
  const openProduct = useCallback(
    (id: number) => {
      haptics.light();
      const parent = navigation.getParent?.();
      if (!parent) return;
      pushCrumb({
        tab: 'Transactions',
        screen: 'SaleDetail',
        params: {saleId},
      });
      (parent as unknown as {
        navigate: (tab: string, params: object) => void;
      }).navigate('Items', {
        // initial: false — see openCustomer above. Keeps ItemsList
        // beneath ProductDetail so the Items tab can pop-to-root.
        initial: false,
        screen: 'ProductDetail',
        params: {productId: id},
      });
    },
    [navigation, haptics, pushCrumb, saleId],
  );

  // Back button: consult the breadcrumb trail first, fall through to
  // native stack pop. This is what lets a deep TransactionList → SaleA →
  // ProductX → SaleB → ProductY journey unwind one hop at a time.
  const popPrev = useNavHistoryStore(s => s.popPrev);
  const handleBack = useCallback(() => {
    haptics.light();
    const prev = popPrev();
    if (prev) {
      const parent = navigation.getParent?.();
      if (parent) {
        (parent as unknown as {
          navigate: (tab: string, params: object) => void;
        }).navigate(prev.tab, {
          // initial: false keeps the destination tab's list mounted
          // beneath the breadcrumb target so a later tab-tap reset
          // still works.
          initial: false,
          screen: prev.screen,
          params: prev.params ?? {},
        });
        return;
      }
    }
    navigation.goBack();
  }, [navigation, haptics, popPrev]);

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container} edges={['left', 'right']}>
        <View style={styles.center}>
          <ActivityIndicator color={COLORS.accent} size="large" />
        </View>
      </SafeAreaView>
    );
  }

  if (isUnavailable) {
    return (
      <SafeAreaView style={styles.container} edges={['left', 'right']}>
        <View style={styles.errorWrap}>
          <ErrorBanner
            message="Detail view is not available right now. Please try again in a moment."
            onRetry={() => {
              haptics.light();
              load();
            }}
          />
        </View>
        <View style={styles.center}>
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
      <SafeAreaView style={styles.container} edges={['left', 'right']}>
        <EmptyState
          icon="receipt-outline"
          title="Sale not found"
          description="This sale may have been deleted or is unavailable."
          action={{
            label: 'Back',
            onPress: () => {
              haptics.light();
              navigation.goBack();
            },
          }}
        />
      </SafeAreaView>
    );
  }

  const customerName = sale.customer?.name || sale.customer_name || 'Walk-in';
  const customerId = sale.customer?.id ?? sale.customer_id ?? null;

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right']}>
      <ScrollView contentContainerStyle={[styles.scroll, tabletColumnCap]}>
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
          {customerId !== null ? (
            <TouchableOpacity
              style={styles.row}
              onPress={() => openCustomer(customerId)}
              accessibilityRole="link"
              accessibilityLabel={`Customer ${customerName}. Tap to open profile.`}>
              <Text style={styles.rowLabel}>Customer</Text>
              <View style={styles.rowValueWithChevron}>
                <Text style={[styles.rowValue, styles.rowValueLink]}>
                  {customerName}
                </Text>
                <Icon
                  name="chevron-forward"
                  size={ICON_SIZE.action}
                  color={COLORS.crimson}
                />
              </View>
            </TouchableOpacity>
          ) : (
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Customer</Text>
              <Text style={styles.rowValue}>{customerName}</Text>
            </View>
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Items</Text>
          {sale.items.length === 0 ? (
            <Text style={styles.emptyText}>No items</Text>
          ) : (
            sale.items.map((item, idx) =>
              item.product_id ? (
                <TouchableOpacity
                  key={idx}
                  style={styles.itemRow}
                  onPress={() => openProduct(item.product_id)}
                  accessibilityRole="link"
                  accessibilityLabel={`${item.product_name}, ${item.quantity} at ${formatCurrency(item.unit_price_cents)}. Tap to open item.`}>
                  <View style={styles.itemLeft}>
                    <Text
                      style={[styles.itemName, styles.itemNameLink]}
                      numberOfLines={2}>
                      {item.product_name}
                    </Text>
                    <Text style={styles.itemMeta}>
                      {item.quantity} × {formatCurrency(item.unit_price_cents)}
                    </Text>
                  </View>
                  <View style={styles.itemRight}>
                    <Text style={styles.itemTotal}>
                      {formatCurrency(item.line_total_cents)}
                    </Text>
                    <Icon
                      name="chevron-forward"
                      size={14}
                      color={COLORS.textMuted}
                    />
                  </View>
                </TouchableOpacity>
              ) : (
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
              ),
            )
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
          <TouchableOpacity style={styles.backBtn} onPress={handleBack}>
            <Icon
              name="chevron-back"
              size={ICON_SIZE.action}
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
    fontFamily: FONT_FAMILY.bold,
    fontVariant: ['tabular-nums'],
  },
  saleDate: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.sm,
    marginTop: 2,
    fontVariant: ['tabular-nums'],
  },
  statusChip: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: 4,
    borderRadius: BORDER_RADIUS.full,
  },
  statusText: {
    color: COLORS.white,
    fontSize: FONT_SIZE.xs,
    fontFamily: FONT_FAMILY.medium,
    textTransform: 'capitalize',
  },
  sectionTitle: {
    color: COLORS.text,
    fontSize: FONT_SIZE.md,
    fontFamily: FONT_FAMILY.bold,
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
    fontFamily: FONT_FAMILY.medium,
  },
  rowValueWithChevron: {flexDirection: 'row', alignItems: 'center'},
  rowValueLink: {color: COLORS.crimson, marginRight: SPACING.xs},
  itemRight: {flexDirection: 'row', alignItems: 'center', gap: 4},
  itemNameLink: {color: COLORS.crimson},
  itemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingVertical: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.surfaceBorder,
  },
  itemLeft: {flex: 1, marginRight: SPACING.md},
  itemName: {color: COLORS.text, fontSize: FONT_SIZE.md, fontFamily: FONT_FAMILY.medium},
  itemMeta: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.sm,
    marginTop: 2,
    fontVariant: ['tabular-nums'],
  },
  itemTotal: {
    color: COLORS.text,
    fontSize: FONT_SIZE.md,
    fontFamily: FONT_FAMILY.bold,
    fontVariant: ['tabular-nums'],
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: SPACING.xs,
  },
  totalLabel: {color: COLORS.textMuted, fontSize: FONT_SIZE.md},
  totalValue: {
    color: COLORS.text,
    fontSize: FONT_SIZE.md,
    fontVariant: ['tabular-nums'],
  },
  grandTotalRow: {
    marginTop: SPACING.xs,
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
    color: COLORS.crimson,
    fontSize: FONT_SIZE.xl,
    fontFamily: FONT_FAMILY.bold,
    fontVariant: ['tabular-nums'],
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
  paymentAmount: {
    color: COLORS.text,
    fontSize: FONT_SIZE.md,
    fontFamily: FONT_FAMILY.medium,
    fontVariant: ['tabular-nums'],
  },
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
  primaryBtnText: {color: COLORS.white, fontFamily: FONT_FAMILY.bold, fontSize: FONT_SIZE.md},
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
    fontFamily: FONT_FAMILY.medium,
  },
  errorWrap: {
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.md,
  },
  linkText: {color: COLORS.accent, fontSize: FONT_SIZE.md},
});
