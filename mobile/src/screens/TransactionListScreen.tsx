import React, {useState, useEffect, useCallback} from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
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
  SHADOW,
} from '../constants/theme';
import ApiClient from '../services/ApiClient';
import {useHaptics} from '../hooks/useHaptics';
import {useResponsiveLayout} from '../hooks/useResponsiveLayout';
import EmptyState from '../components/EmptyState';
import ErrorBanner from '../components/ErrorBanner';
import type {Sale} from '../types/api.types';
import type {TransactionsStackParamList} from '../types/navigation.types';
import {formatCurrency} from '../utils/format';

type NavigationProp = NativeStackNavigationProp<TransactionsStackParamList>;
type TransactionListRouteProp = RouteProp<
  TransactionsStackParamList,
  'TransactionList'
>;

type DateFilter = 'today' | 'week' | 'all';

function getDateRange(filter: DateFilter): {
  date_from?: string;
  date_to?: string;
} {
  const now = new Date();
  const formatDate = (d: Date) => d.toISOString().split('T')[0];

  if (filter === 'today') {
    const today = formatDate(now);
    return {date_from: today, date_to: today};
  }

  if (filter === 'week') {
    const weekAgo = new Date(now);
    weekAgo.setDate(weekAgo.getDate() - 7);
    return {date_from: formatDate(weekAgo), date_to: formatDate(now)};
  }

  return {};
}

function formatDateTime(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
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

export default function TransactionListScreen() {
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<TransactionListRouteProp>();
  const routeProductId = route.params?.productId;
  const haptics = useHaptics();
  const {isTablet} = useResponsiveLayout();
  const tabletColumnCap = isTablet
    ? ({maxWidth: 720, alignSelf: 'center', width: '100%'} as const)
    : null;

  const [transactions, setTransactions] = useState<Sale[]>([]);
  // Default to 'all' so the screen renders populated on first open. Filters
  // to 'today' / 'week' are one tap away on the chip row; the previous
  // 'today' default landed the user on an empty list whenever they hadn't
  // sold anything that day, which read as "the app is broken".
  const [dateFilter, setDateFilter] = useState<DateFilter>('all');
  // Seeded from the route param; tapping the ✕ on the filter chip clears
  // it without leaving the screen. Re-entering the screen with a fresh
  // productId param re-seeds via the effect below.
  const [productId, setProductId] = useState<number | undefined>(routeProductId);
  const [productName, setProductName] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [lastPage, setLastPage] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-seed the filter when a fresh navigation lands here with a new
  // productId param (e.g. tapping "View all" on a different ProductDetail).
  useEffect(() => {
    setProductId(routeProductId);
  }, [routeProductId]);

  // Best-effort name lookup so the chip can show the product's display
  // name. Falls back to "this product" on failure; the section is
  // non-essential and must never break the list.
  useEffect(() => {
    if (productId == null) {
      setProductName(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const detail = await ApiClient.getProductDetail(productId);
        if (!cancelled) {
          setProductName(detail?.name ?? 'this product');
        }
      } catch {
        if (!cancelled) setProductName('this product');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [productId]);

  const fetchTransactions = useCallback(
    async (pageNum: number, append: boolean = false) => {
      if (pageNum === 1) {
        setIsLoading(true);
      } else {
        setIsLoadingMore(true);
      }
      setError(null);

      try {
        const dateRange = getDateRange(dateFilter);
        const response = await ApiClient.getTransactions({
          page: pageNum,
          per_page: 20,
          ...dateRange,
          ...(productId != null ? {product_id: productId} : {}),
        });

        if (append) {
          setTransactions(prev => [...prev, ...response.data]);
        } else {
          setTransactions(response.data);
        }
        setPage(response.meta.current_page);
        setLastPage(response.meta.last_page);
      } catch (e) {
        const msg =
          e instanceof Error ? e.message : 'Failed to load transactions';
        haptics.error();
        setError(msg);
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
        setIsLoadingMore(false);
      }
    },
    [dateFilter, productId, haptics],
  );

  useEffect(() => {
    fetchTransactions(1);
  }, [fetchTransactions]);

  const handleClearProductFilter = useCallback(() => {
    haptics.selection();
    setProductId(undefined);
    setPage(1);
  }, [haptics]);

  const handleRefresh = useCallback(() => {
    setIsRefreshing(true);
    fetchTransactions(1);
  }, [fetchTransactions]);

  const handleLoadMore = useCallback(() => {
    if (!isLoadingMore && page < lastPage) {
      fetchTransactions(page + 1, true);
    }
  }, [isLoadingMore, page, lastPage, fetchTransactions]);

  const handleFilterChange = useCallback(
    (filter: DateFilter) => {
      haptics.selection();
      setDateFilter(filter);
      setPage(1);
    },
    [haptics],
  );

  const handleRowPress = useCallback(
    (sale: Sale) => {
      haptics.light();
      navigation.navigate('SaleDetail', {saleId: sale.id});
    },
    [navigation, haptics],
  );

  const renderTransaction = ({item}: {item: Sale}) => (
    <TouchableOpacity
      style={styles.transactionRow}
      onPress={() => handleRowPress(item)}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={`Sale ${item.sale_number}, ${formatDateTime(item.created_at)}, ${formatCurrency(item.total_cents)}. Tap to view.`}>
      <View style={styles.rowLeft}>
        <Text style={styles.saleNumber}>{item.sale_number}</Text>
        <Text style={styles.saleDate}>{formatDateTime(item.created_at)}</Text>
        <Text style={item.customer_name ? styles.customerName : styles.customerNameWalkin}>
          {item.customer_name || 'Walk-in'}
        </Text>
      </View>
      <View style={styles.rowRight}>
        <Text style={styles.saleTotal}>{formatCurrency(item.total_cents)}</Text>
        <View
          style={[
            styles.statusChip,
            {backgroundColor: getStatusColor(item.status)},
          ]}>
          <Text style={styles.statusText}>{item.status}</Text>
        </View>
      </View>
      <Icon
        name="chevron-forward"
        size={ICON_SIZE.action}
        color={COLORS.textMuted}
        style={styles.rowChevron}
      />
    </TouchableOpacity>
  );

  const renderFooter = () => {
    if (isLoadingMore) {
      return (
        <View style={styles.footerLoader}>
          <ActivityIndicator color={COLORS.accent} size="small" />
        </View>
      );
    }
    if (error && transactions.length > 0) {
      return (
        <TouchableOpacity
          style={styles.footerRetry}
          onPress={() => fetchTransactions(page + 1, true)}
          accessibilityRole="button"
          accessibilityLabel="Retry loading next page">
          <Text style={styles.footerRetryText}>Tap to retry</Text>
        </TouchableOpacity>
      );
    }
    if (transactions.length > 0 && page >= lastPage) {
      return (
        <View style={styles.footerEnd}>
          <Text style={styles.footerEndText}>End of list</Text>
        </View>
      );
    }
    return null;
  };

  const renderEmpty = () => {
    if (isLoading) return null;
    const description =
      dateFilter === 'today'
        ? 'No sales recorded today'
        : dateFilter === 'week'
          ? 'No sales this week'
          : 'No transaction history';
    return (
      <EmptyState
        icon="receipt-outline"
        title="No transactions found"
        description={description}
      />
    );
  };

  const FILTERS: {key: DateFilter; label: string; icon: React.ComponentProps<typeof Icon>['name']}[] = [
    {key: 'today', label: 'Today', icon: 'today-outline'},
    {key: 'week', label: 'This week', icon: 'calendar-outline'},
    {key: 'all', label: 'All', icon: 'list-outline'},
  ];

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right']}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Transactions</Text>
      </View>

      {/* Stat strip removed in v1.3.26 — the Sales today / Revenue today
          tiles duplicated information already on the Dashboard. The list
          + date filters carry the page on their own. */}

      {/* Product filter chip — present only when a productId is set
          (typically deep-linked from ProductDetail's "View all sales"
          affordance). Tapping the ✕ clears the filter in-place; we
          don't pop the screen because the user explicitly chose
          Transactions and may still want to use the date filter row. */}
      {productId != null && (
        <View style={[styles.productFilterRow, tabletColumnCap]}>
          <TouchableOpacity
            style={styles.productFilterChip}
            onPress={handleClearProductFilter}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={`Filtered by ${productName ?? 'this product'}. Tap to clear.`}>
            <Icon
              name="filter"
              size={ICON_SIZE.action}
              color={COLORS.white}
              style={styles.productFilterIcon}
            />
            <Text style={styles.productFilterText} numberOfLines={1}>
              Filtered by: {productName ?? 'this product'}
            </Text>
            <Icon
              name="close-circle"
              size={ICON_SIZE.action}
              color={COLORS.white}
              style={styles.productFilterClose}
            />
          </TouchableOpacity>
        </View>
      )}

      {/* Date Filter — pill style mirroring desktop's .aeris-nav-active */}
      <View style={[styles.filterRow, tabletColumnCap]}>
        {FILTERS.map(f => {
          const active = dateFilter === f.key;
          return (
            <TouchableOpacity
              key={f.key}
              style={[
                styles.filterButton,
                active && styles.filterButtonActive,
              ]}
              onPress={() => handleFilterChange(f.key)}
              accessibilityRole="button"
              accessibilityLabel={`Filter ${f.label}`}
              accessibilityState={{selected: active}}>
              <Icon
                name={f.icon}
                size={ICON_SIZE.action}
                color={active ? COLORS.cream : COLORS.textMuted}
                style={styles.filterIcon}
              />
              <Text
                style={[
                  styles.filterButtonText,
                  active && styles.filterButtonTextActive,
                ]}>
                {f.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Error */}
      {error ? (
        <View style={[styles.errorWrap, tabletColumnCap]}>
          <ErrorBanner message={error} onRetry={() => fetchTransactions(1)} />
        </View>
      ) : null}

      {/* Loading */}
      {isLoading && !isRefreshing && (
        <ActivityIndicator
          color={COLORS.accent}
          size="large"
          style={styles.loader}
        />
      )}

      {/* Transaction List */}
      {!isLoading && (
        <FlatList
          data={transactions}
          renderItem={renderTransaction}
          keyExtractor={item => String(item.id)}
          // tabletColumnCap on `style` (outer scroll container), not
          // `contentContainerStyle` — see ItemsScreen for the rationale.
          style={tabletColumnCap}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={renderEmpty}
          ListFooterComponent={renderFooter}
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.3}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={handleRefresh}
              tintColor={COLORS.accent}
            />
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  headerTitle: {
    color: COLORS.text,
    fontSize: FONT_SIZE.xxl,
    fontFamily: FONT_FAMILY.bold,
  },
  filterRow: {
    flexDirection: 'row',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    gap: SPACING.sm,
  },
  productFilterRow: {
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.sm,
  },
  // Visually loud — solid crimson pill so it reads as an active filter
  // the user is responsible for clearing. Sits above the date row and
  // spans the full content width so the product name has room.
  productFilterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.crimson,
    borderRadius: BORDER_RADIUS.full,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
    minHeight: 44,
    ...SHADOW.card,
  },
  productFilterIcon: {marginRight: SPACING.xs},
  productFilterText: {
    flex: 1,
    color: COLORS.white,
    fontSize: FONT_SIZE.sm,
    fontFamily: FONT_FAMILY.semibold,
    letterSpacing: 0.2,
  },
  productFilterClose: {marginLeft: SPACING.sm},
  // Pill: inactive = white surface with a navy outline + navy text so it
  // reads clearly against the cream body bg; active = solid Red Dirt Red
  // pill with white text. Pre-v1.3.22 the inactive state was a
  // transparent fill which blended into the cream body and looked beige.
  filterButton: {
    flex: 1,
    flexDirection: 'row',
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.sm,
    borderRadius: BORDER_RADIUS.full,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.navy,
    alignItems: 'center',
    justifyContent: 'center',
    // Apple HIG / Material both require 44pt minimum tap target.
    minHeight: 44,
    // Soft elevation so the chips lift off the cream surface — matches
    // the StatCard treatment a couple of rows above.
    ...SHADOW.card,
  },
  filterButtonActive: {
    backgroundColor: COLORS.crimson,
    borderColor: COLORS.crimson,
  },
  filterIcon: {marginRight: SPACING.xs},
  filterButtonText: {
    color: COLORS.navy,
    fontSize: FONT_SIZE.sm,
    fontFamily: FONT_FAMILY.semibold,
    letterSpacing: 0.2,
  },
  filterButtonTextActive: {
    color: COLORS.white,
  },
  errorWrap: {
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.sm,
  },
  loader: {
    marginTop: SPACING.xl,
  },
  listContent: {
    padding: SPACING.md,
    paddingBottom: SPACING.xxl,
  },
  transactionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.surfaceBorder,
    borderRadius: BORDER_RADIUS.lg,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    marginBottom: SPACING.sm,
  },
  rowLeft: {
    flex: 1,
    marginRight: SPACING.md,
  },
  saleNumber: {
    color: COLORS.text,
    fontSize: FONT_SIZE.md,
    fontFamily: FONT_FAMILY.medium,
    fontVariant: ['tabular-nums'],
  },
  saleDate: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.xs,
    marginTop: 2,
    fontVariant: ['tabular-nums'],
  },
  customerName: {
    color: COLORS.textLight,
    fontSize: FONT_SIZE.sm,
    marginTop: 2,
  },
  customerNameWalkin: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.sm,
    marginTop: 2,
    fontStyle: 'italic',
  },
  rowRight: {
    alignItems: 'flex-end',
  },
  saleTotal: {
    color: COLORS.textLight,
    fontSize: FONT_SIZE.lg,
    fontFamily: FONT_FAMILY.bold,
    marginBottom: SPACING.xs,
    fontVariant: ['tabular-nums'],
  },
  rowChevron: {marginLeft: SPACING.sm},
  statusChip: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: 2,
    borderRadius: BORDER_RADIUS.full,
  },
  statusText: {
    color: COLORS.white,
    fontSize: FONT_SIZE.xs,
    fontFamily: FONT_FAMILY.medium,
    textTransform: 'capitalize',
  },
  footerLoader: {
    paddingVertical: SPACING.lg,
    alignItems: 'center',
  },
  footerEnd: {
    paddingVertical: SPACING.lg,
    alignItems: 'center',
  },
  footerEndText: {
    color: COLORS.textDim,
    fontSize: FONT_SIZE.xs,
    fontFamily: FONT_FAMILY.medium,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  footerRetry: {
    paddingVertical: SPACING.lg,
    alignItems: 'center',
  },
  footerRetryText: {
    color: COLORS.crimson,
    fontSize: FONT_SIZE.sm,
    fontFamily: FONT_FAMILY.bold,
    textDecorationLine: 'underline',
  },
});
