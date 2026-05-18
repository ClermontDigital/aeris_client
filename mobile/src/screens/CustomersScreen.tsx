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
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {
  COLORS,
  SPACING,
  FONT_SIZE,
  BORDER_RADIUS,
  ICON_SIZE,
} from '../constants/theme';
import ApiClient from '../services/ApiClient';
import {useHaptics} from '../hooks/useHaptics';
import type {Customer} from '../types/api.types';
import type {CustomersStackParamList} from '../types/navigation.types';
import {formatCurrency} from '../utils/format';
import StatCard from '../components/StatCard';
import EmptyState from '../components/EmptyState';
import ErrorBanner from '../components/ErrorBanner';

type Nav = NativeStackNavigationProp<CustomersStackParamList>;

const PER_PAGE = 50;

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
  const navigation = useNavigation<Nav>();
  const haptics = useHaptics();
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

  // Stat strip metrics derive from currently-loaded pages.
  const stats = useMemo(() => {
    let withEmail = 0;
    let withPhone = 0;
    for (const c of items) {
      if (c.email && c.email.trim()) withEmail += 1;
      if ((c.phone && c.phone.trim()) || (c.mobile && c.mobile.trim())) {
        withPhone += 1;
      }
    }
    return {total: items.length, withEmail, withPhone};
  }, [items]);

  const renderItem = ({item}: {item: Customer}) => (
    <TouchableOpacity
      style={styles.row}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={`${item.name || item.email || 'Customer'}, ${item.email ? item.email + ', ' : ''}${item.phone || ''}. Tap to view.`}
      onPress={() => {
        haptics.light();
        navigation.navigate('CustomerDetail', {customerId: item.id});
      }}>
      <View style={styles.rowLeft}>
        <Text style={styles.rowName} numberOfLines={1}>
          {item.name || '(unnamed)'}
        </Text>
        <Text style={styles.rowMeta} numberOfLines={1}>
          {[item.email, item.phone].filter(Boolean).join(' · ') || '—'}
        </Text>
      </View>
      <View style={styles.rowRight}>
        {item.account_balance_cents != null ? (
          <View style={styles.balanceCol}>
            <Text
              style={[
                styles.rowBalance,
                item.account_balance_cents > 0 && styles.rowBalanceOwed,
              ]}>
              {formatCurrency(item.account_balance_cents)}
            </Text>
            <Text style={styles.rowBalanceLabel}>balance</Text>
          </View>
        ) : null}
        <Ionicons
          name="chevron-forward"
          size={ICON_SIZE.action}
          color={COLORS.textMuted}
          style={styles.chevron}
        />
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
      <EmptyState
        title={search ? 'No customers match your search' : 'No customers found'}
        description={
          search
            ? 'Try a different name, email, or phone number.'
            : 'Customers added in the Aeris web console will appear here.'
        }
        icon="people-outline"
      />
    );
  };

  return (
    <SafeAreaView
      style={styles.container}
      edges={['left', 'right']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Customers</Text>
      </View>

      <View style={styles.statsStrip}>
        <View style={styles.statCell}>
          <StatCard
            label="Total"
            value={String(stats.total)}
            icon="people-outline"
          />
        </View>
        <View style={styles.statCell}>
          <StatCard
            label="With Email"
            value={String(stats.withEmail)}
            icon="mail-outline"
          />
        </View>
        <View style={styles.statCell}>
          <StatCard
            label="With Phone"
            value={String(stats.withPhone)}
            icon="call-outline"
          />
        </View>
      </View>

      <View style={styles.searchRow}>
        <Ionicons
          name="search"
          size={ICON_SIZE.action}
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
            <Ionicons
              name="close-circle"
              size={ICON_SIZE.action}
              color={COLORS.textMuted}
            />
          </TouchableOpacity>
        ) : null}
      </View>

      {error ? (
        <View style={styles.bannerWrap}>
          <ErrorBanner
            message={error}
            onRetry={() => fetchPage(1, false)}
            onDismiss={() => setError(null)}
          />
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
  statsStrip: {
    flexDirection: 'row',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.md,
    marginBottom: SPACING.sm,
  },
  statCell: {flex: 1},
  bannerWrap: {
    paddingHorizontal: SPACING.md,
    marginBottom: SPACING.sm,
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
  loader: {marginTop: SPACING.xl},
  listContent: {
    paddingHorizontal: SPACING.md,
    paddingBottom: SPACING.xxl,
  },
  // Compact-row look: vertical SPACING.sm, horizontal SPACING.md
  row: {
    flexDirection: 'row',
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.surfaceBorder,
    borderRadius: BORDER_RADIUS.lg,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
    marginBottom: SPACING.sm,
  },
  rowLeft: {flex: 1, marginRight: SPACING.md},
  rowName: {color: COLORS.text, fontSize: FONT_SIZE.md, fontWeight: '600'},
  rowMeta: {color: COLORS.textMuted, fontSize: FONT_SIZE.xs, marginTop: 2},
  rowRight: {flexDirection: 'row', alignItems: 'center'},
  balanceCol: {alignItems: 'flex-end'},
  chevron: {marginLeft: SPACING.sm},
  rowBalance: {
    color: COLORS.text,
    fontSize: FONT_SIZE.md,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  rowBalanceOwed: {color: COLORS.crimson},
  rowBalanceLabel: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.xs,
    marginTop: 2,
  },
  footerLoader: {paddingVertical: SPACING.lg, alignItems: 'center'},
});

export default CustomersScreen;
