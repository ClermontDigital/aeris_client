import React, {useState, useEffect, useCallback, useMemo} from 'react';
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
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {Ionicons} from '@expo/vector-icons';
import {
  COLORS,
  SPACING,
  FONT_SIZE,
  BORDER_RADIUS,
  ICON_SIZE,
} from '../constants/theme';
import ApiClient from '../services/ApiClient';
import {useHaptics} from '../hooks/useHaptics';
import StatCard, {pickStatRowFontSize} from '../components/StatCard';
import EmptyState from '../components/EmptyState';
import ErrorBanner from '../components/ErrorBanner';
import type {Sale} from '../types/api.types';
import type {TransactionsStackParamList} from '../types/navigation.types';
import {formatCurrency} from '../utils/format';

type NavigationProp = NativeStackNavigationProp<TransactionsStackParamList>;

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

function isToday(iso: string): boolean {
  const today = new Date().toISOString().split('T')[0];
  return iso.startsWith(today);
}

export default function TransactionListScreen() {
  const navigation = useNavigation<NavigationProp>();
  const haptics = useHaptics();

  const [transactions, setTransactions] = useState<Sale[]>([]);
  const [dateFilter, setDateFilter] = useState<DateFilter>('today');
  const [page, setPage] = useState(1);
  const [lastPage, setLastPage] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    [dateFilter, haptics],
  );

  useEffect(() => {
    fetchTransactions(1);
  }, [fetchTransactions]);

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

  // Stat strip aggregates derived client-side from the visible page.
  const stats = useMemo(() => {
    const todayTx = transactions.filter(t => isToday(t.created_at));
    const todayCount = todayTx.length;
    const todayRevenueCents = todayTx.reduce(
      (sum, t) => sum + (t.total_cents || 0),
      0,
    );
    const visibleCount = transactions.length;
    const visibleSum = transactions.reduce(
      (sum, t) => sum + (t.total_cents || 0),
      0,
    );
    const avgCents = visibleCount > 0 ? Math.round(visibleSum / visibleCount) : 0;
    return {todayCount, todayRevenueCents, avgCents};
  }, [transactions]);

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
      <Ionicons
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

  const FILTERS: {key: DateFilter; label: string; icon: keyof typeof Ionicons.glyphMap}[] = [
    {key: 'today', label: 'Today', icon: 'today-outline'},
    {key: 'week', label: 'This Week', icon: 'calendar-outline'},
    {key: 'all', label: 'All', icon: 'list-outline'},
  ];

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right']}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Transactions</Text>
      </View>

      {/* Stat strip — derived from the currently-loaded page so the values
          stay coherent with the visible list rows. Single shared font
          size across all three cells so "0" vs "$1,234.56" doesn't render
          at visually different scales. */}
      {(() => {
        const todayCountStr = String(stats.todayCount);
        const todayRevStr = formatCurrency(stats.todayRevenueCents);
        const avgStr = formatCurrency(stats.avgCents);
        const fs = pickStatRowFontSize([todayCountStr, todayRevStr, avgStr]);
        return (
          <View style={styles.statStrip}>
            <View style={styles.statCell}>
              <StatCard
                label="Today"
                value={todayCountStr}
                sublabel="sales"
                valueFontSize={fs}
              />
            </View>
            <View style={styles.statCell}>
              <StatCard
                label="Today Revenue"
                value={todayRevStr}
                valueFontSize={fs}
              />
            </View>
            <View style={styles.statCell}>
              <StatCard
                label="Avg Sale"
                value={avgStr}
                sublabel="visible"
                valueFontSize={fs}
              />
            </View>
          </View>
        );
      })()}

      {/* Date Filter — pill style mirroring desktop's .aeris-nav-active */}
      <View style={styles.filterRow}>
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
              <Ionicons
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
        <View style={styles.errorWrap}>
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
    fontWeight: '700',
  },
  statStrip: {
    flexDirection: 'row',
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.md,
    gap: SPACING.sm,
  },
  statCell: {flex: 1},
  filterRow: {
    flexDirection: 'row',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    gap: SPACING.sm,
  },
  // Pill: inactive transparent + muted text + surface border;
  // active solid crimson + cream text + crimson border (mirrors
  // desktop's .aeris-nav-active state).
  filterButton: {
    flex: 1,
    flexDirection: 'row',
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.sm,
    borderRadius: BORDER_RADIUS.lg,
    backgroundColor: COLORS.transparent,
    borderWidth: 1,
    borderColor: COLORS.surfaceBorder,
    alignItems: 'center',
    justifyContent: 'center',
    // Apple HIG / Material both require 44pt minimum tap target. The visual
    // padding stays at SPACING.sm — minHeight just enforces the floor.
    minHeight: 44,
  },
  filterButtonActive: {
    backgroundColor: COLORS.crimson,
    borderColor: COLORS.crimson,
  },
  filterIcon: {marginRight: SPACING.xs},
  filterButtonText: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.sm,
    fontWeight: '600',
  },
  filterButtonTextActive: {
    color: COLORS.cream,
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
    fontWeight: '600',
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
    fontWeight: '700',
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
    fontWeight: '600',
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
    fontWeight: '500',
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
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
});
