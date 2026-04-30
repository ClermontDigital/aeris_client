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
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {COLORS, SPACING, FONT_SIZE, BORDER_RADIUS} from '../constants/theme';
import ApiClient from '../services/ApiClient';
import type {Sale} from '../types/api.types';
import type {TransactionsStackParamList} from '../types/navigation.types';

type NavigationProp = NativeStackNavigationProp<TransactionsStackParamList>;

type DateFilter = 'today' | 'week' | 'all';

const formatCurrency = (cents: number) => '$' + (cents / 100).toFixed(2);

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
        setError(msg);
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
        setIsLoadingMore(false);
      }
    },
    [dateFilter],
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

  const handleFilterChange = useCallback((filter: DateFilter) => {
    setDateFilter(filter);
    setPage(1);
  }, []);

  const handleRowPress = useCallback(
    (sale: Sale) => {
      navigation.navigate('Receipt', {saleId: sale.id});
    },
    [navigation],
  );

  const renderTransaction = ({item}: {item: Sale}) => (
    <TouchableOpacity
      style={styles.transactionRow}
      onPress={() => handleRowPress(item)}
      activeOpacity={0.7}>
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
    </TouchableOpacity>
  );

  const renderFooter = () => {
    if (!isLoadingMore) return null;
    return (
      <View style={styles.footerLoader}>
        <ActivityIndicator color={COLORS.accent} size="small" />
      </View>
    );
  };

  const renderEmpty = () => {
    if (isLoading) return null;
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>No transactions found</Text>
        <Text style={styles.emptySubtext}>
          {dateFilter === 'today'
            ? 'No sales recorded today'
            : dateFilter === 'week'
            ? 'No sales this week'
            : 'No transaction history'}
        </Text>
      </View>
    );
  };

  const FILTERS: {key: DateFilter; label: string}[] = [
    {key: 'today', label: 'Today'},
    {key: 'week', label: 'This Week'},
    {key: 'all', label: 'All'},
  ];

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right', 'bottom']}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Transactions</Text>
      </View>

      {/* Date Filter */}
      <View style={styles.filterRow}>
        {FILTERS.map(f => (
          <TouchableOpacity
            key={f.key}
            style={[
              styles.filterButton,
              dateFilter === f.key && styles.filterButtonActive,
            ]}
            onPress={() => handleFilterChange(f.key)}>
            <Text
              style={[
                styles.filterButtonText,
                dateFilter === f.key && styles.filterButtonTextActive,
              ]}>
              {f.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Error */}
      {error && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity onPress={() => fetchTransactions(1)}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}

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
  filterRow: {
    flexDirection: 'row',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    gap: SPACING.sm,
  },
  filterButton: {
    flex: 1,
    paddingVertical: SPACING.sm,
    borderRadius: BORDER_RADIUS.md,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.surfaceBorder,
    alignItems: 'center',
  },
  filterButtonActive: {
    backgroundColor: COLORS.crimson,
    borderColor: COLORS.crimson,
  },
  filterButtonText: {
    color: COLORS.text,
    fontSize: FONT_SIZE.sm,
    fontWeight: '600',
  },
  filterButtonTextActive: {
    color: COLORS.white,
  },
  errorBanner: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: COLORS.danger,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    marginHorizontal: SPACING.md,
    marginTop: SPACING.sm,
    borderRadius: BORDER_RADIUS.md,
  },
  errorText: {
    color: COLORS.white,
    fontSize: FONT_SIZE.sm,
    flex: 1,
  },
  retryText: {
    color: COLORS.white,
    fontSize: FONT_SIZE.sm,
    fontWeight: '700',
    marginLeft: SPACING.md,
    textDecorationLine: 'underline',
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
    padding: SPACING.md,
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
  },
  saleDate: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.xs,
    marginTop: 2,
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
  },
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
  emptyContainer: {
    alignItems: 'center',
    paddingTop: SPACING.xxl,
  },
  emptyText: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.lg,
    fontWeight: '600',
  },
  emptySubtext: {
    color: COLORS.textDim,
    fontSize: FONT_SIZE.sm,
    marginTop: SPACING.sm,
  },
  footerLoader: {
    paddingVertical: SPACING.lg,
    alignItems: 'center',
  },
});
