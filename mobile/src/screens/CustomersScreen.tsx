import React, {useState, useEffect, useCallback, useMemo, useRef} from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {Ionicons} from '@expo/vector-icons';
import {COLORS, SPACING, FONT_SIZE, BORDER_RADIUS} from '../constants/theme';
import ApiClient from '../services/ApiClient';
import type {Customer} from '../types/api.types';

const PER_PAGE = 50;

const formatCurrency = (cents: number): string => '$' + (cents / 100).toFixed(2);

// Client-side filter on the loaded pages. NOTE: customers.search via the
// relay is currently blocked by the marketplace dispatcher's
// path-placeholder bug ({term} substitution), and the customers.list /
// CustomerController::index endpoint on Aeris2 doesn't honour a `search`
// query string. As a workaround we filter the loaded pages locally —
// works for typical retail customer counts, will need server-side search
// for very large customer bases.
function localFilter(items: Customer[], q: string): Customer[] {
  const trimmed = q.trim().toLowerCase();
  if (!trimmed) return items;
  return items.filter(c => {
    return (
      c.name.toLowerCase().includes(trimmed) ||
      (c.email ?? '').toLowerCase().includes(trimmed) ||
      (c.phone ?? '').toLowerCase().includes(trimmed)
    );
  });
}

const CustomersScreen: React.FC = () => {
  const [search, setSearch] = useState('');
  const [items, setItems] = useState<Customer[]>([]);
  const [page, setPage] = useState(1);
  const [lastPage, setLastPage] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestSeq = useRef(0);

  const fetchPage = useCallback(async (pageNum: number, append: boolean) => {
    const seq = ++requestSeq.current;
    if (pageNum === 1 && !append) {
      setIsLoading(true);
    } else {
      setIsLoadingMore(true);
    }
    setError(null);
    try {
      const result = await ApiClient.listCustomers(pageNum, PER_PAGE);
      if (seq !== requestSeq.current) return;
      setItems(prev => (append ? [...prev, ...result.data] : result.data));
      setPage(result.meta.current_page);
      setLastPage(result.meta.last_page);
    } catch (e) {
      if (seq !== requestSeq.current) return;
      setError(e instanceof Error ? e.message : 'Failed to load customers');
    } finally {
      if (seq === requestSeq.current) {
        setIsLoading(false);
        setIsRefreshing(false);
        setIsLoadingMore(false);
      }
    }
  }, []);

  useEffect(() => {
    fetchPage(1, false);
  }, [fetchPage]);

  const handleRefresh = useCallback(() => {
    setIsRefreshing(true);
    fetchPage(1, false);
  }, [fetchPage]);

  const handleLoadMore = useCallback(() => {
    // Only auto-paginate when not actively filtering — otherwise the
    // user is looking at a filtered slice and infinite-scrolling
    // unrelated pages is confusing.
    if (search.trim()) return;
    if (!isLoadingMore && page < lastPage) {
      fetchPage(page + 1, true);
    }
  }, [search, isLoadingMore, page, lastPage, fetchPage]);

  const visible = useMemo(() => localFilter(items, search), [items, search]);

  const renderItem = ({item}: {item: Customer}) => (
    <View style={styles.row}>
      <View style={styles.rowLeft}>
        <Text style={styles.rowName} numberOfLines={1}>
          {item.name || '(unnamed)'}
        </Text>
        <Text style={styles.rowMeta} numberOfLines={1}>
          {[item.email, item.phone].filter(Boolean).join(' · ') || '—'}
        </Text>
      </View>
      <View style={styles.rowRight}>
        <Text
          style={[
            styles.rowBalance,
            item.account_balance_cents > 0 && styles.rowBalanceOwed,
          ]}>
          {formatCurrency(item.account_balance_cents)}
        </Text>
        <Text style={styles.rowBalanceLabel}>balance</Text>
      </View>
    </View>
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
        <Text style={styles.emptyText}>
          {search ? 'No customers match your search' : 'No customers found'}
        </Text>
      </View>
    );
  };

  return (
    <SafeAreaView
      style={styles.container}
      edges={['left', 'right', 'bottom']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Customers</Text>
      </View>

      <View style={styles.searchRow}>
        <Ionicons
          name="search"
          size={18}
          color={COLORS.textMuted}
          style={styles.searchIcon}
        />
        <TextInput
          style={styles.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder="Search customers by name, email, or phone"
          placeholderTextColor={COLORS.inputPlaceholder}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
        />
        {search ? (
          <TouchableOpacity onPress={() => setSearch('')} style={styles.clearBtn}>
            <Ionicons name="close-circle" size={18} color={COLORS.textMuted} />
          </TouchableOpacity>
        ) : null}
      </View>

      {error ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity onPress={() => fetchPage(1, false)}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {isLoading && !isRefreshing && items.length === 0 ? (
        <ActivityIndicator
          color={COLORS.accent}
          size="large"
          style={styles.loader}
        />
      ) : (
        <FlatList
          data={visible}
          renderItem={renderItem}
          keyExtractor={item => String(item.id)}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={renderEmpty}
          ListFooterComponent={renderFooter}
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.3}
          keyboardShouldPersistTaps="handled"
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
};

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: COLORS.background},
  header: {
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.md,
    paddingBottom: SPACING.sm,
  },
  headerTitle: {
    color: COLORS.text,
    fontSize: FONT_SIZE.xxl,
    fontWeight: '700',
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: SPACING.md,
    marginBottom: SPACING.sm,
    paddingHorizontal: SPACING.md,
    backgroundColor: COLORS.inputBg,
    borderWidth: 1,
    borderColor: COLORS.inputBorder,
    borderRadius: BORDER_RADIUS.md,
    height: 44,
  },
  searchIcon: {marginRight: SPACING.sm},
  searchInput: {flex: 1, color: COLORS.text, fontSize: FONT_SIZE.md},
  clearBtn: {paddingHorizontal: SPACING.xs},
  errorBanner: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: COLORS.danger,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    marginHorizontal: SPACING.md,
    marginBottom: SPACING.sm,
    borderRadius: BORDER_RADIUS.md,
  },
  errorText: {color: COLORS.white, fontSize: FONT_SIZE.sm, flex: 1},
  retryText: {
    color: COLORS.white,
    fontSize: FONT_SIZE.sm,
    fontWeight: '700',
    marginLeft: SPACING.md,
    textDecorationLine: 'underline',
  },
  loader: {marginTop: SPACING.xl},
  listContent: {
    paddingHorizontal: SPACING.md,
    paddingBottom: SPACING.xxl,
  },
  row: {
    flexDirection: 'row',
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.surfaceBorder,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.sm,
  },
  rowLeft: {flex: 1, marginRight: SPACING.md},
  rowName: {color: COLORS.text, fontSize: FONT_SIZE.md, fontWeight: '600'},
  rowMeta: {color: COLORS.textMuted, fontSize: FONT_SIZE.xs, marginTop: 2},
  rowRight: {alignItems: 'flex-end'},
  rowBalance: {color: COLORS.text, fontSize: FONT_SIZE.md, fontWeight: '600'},
  rowBalanceOwed: {color: COLORS.crimson},
  rowBalanceLabel: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.xs,
    marginTop: 2,
  },
  footerLoader: {paddingVertical: SPACING.lg, alignItems: 'center'},
  emptyContainer: {alignItems: 'center', paddingTop: SPACING.xxl},
  emptyText: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.md,
    fontWeight: '500',
  },
});

export default CustomersScreen;
