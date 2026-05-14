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
import type {Product} from '../types/api.types';
import type {ItemsStackParamList} from '../types/navigation.types';
import {formatCurrency} from '../utils/format';
import StatCard from '../components/StatCard';
import EmptyState from '../components/EmptyState';
import ErrorBanner from '../components/ErrorBanner';

type Nav = NativeStackNavigationProp<ItemsStackParamList>;

const PER_PAGE = 50;
const SEARCH_DEBOUNCE_MS = 300;
const LOW_STOCK_THRESHOLD = 10;

const ItemsScreen: React.FC = () => {
  const navigation = useNavigation<Nav>();
  const haptics = useHaptics();
  const [search, setSearch] = useState('');
  const [items, setItems] = useState<Product[]>([]);
  const [page, setPage] = useState(1);
  const [lastPage, setLastPage] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Tracks the latest in-flight request key so out-of-order responses
  // (e.g. user types fast) don't clobber a newer query with stale data.
  const requestSeq = useRef(0);

  const fetchPage = useCallback(
    async (pageNum: number, append: boolean, searchQuery: string) => {
      const seq = ++requestSeq.current;
      if (pageNum === 1 && !append) {
        setIsLoading(true);
      } else {
        setIsLoadingMore(true);
      }
      setError(null);
      try {
        const trimmed = searchQuery.trim();
        const result = trimmed
          ? await ApiClient.searchProducts(trimmed, pageNum, PER_PAGE)
          : await ApiClient.listProducts(pageNum, PER_PAGE);
        if (seq !== requestSeq.current) return; // stale response
        setItems(prev => (append ? [...prev, ...result.data] : result.data));
        setPage(result.meta.current_page);
        setLastPage(result.meta.last_page);
      } catch (e) {
        if (seq !== requestSeq.current) return;
        haptics.error();
        setError(e instanceof Error ? e.message : 'Failed to load items');
      } finally {
        if (seq === requestSeq.current) {
          setIsLoading(false);
          setIsRefreshing(false);
          setIsLoadingMore(false);
        }
      }
    },
    [haptics],
  );

  // Initial load + debounced search
  useEffect(() => {
    const t = setTimeout(() => {
      fetchPage(1, false, search);
    }, search ? SEARCH_DEBOUNCE_MS : 0);
    return () => clearTimeout(t);
  }, [search, fetchPage]);

  const handleRefresh = useCallback(() => {
    setIsRefreshing(true);
    fetchPage(1, false, search);
  }, [search, fetchPage]);

  const handleLoadMore = useCallback(() => {
    if (!isLoadingMore && page < lastPage) {
      fetchPage(page + 1, true, search);
    }
  }, [isLoadingMore, page, lastPage, search, fetchPage]);

  // Stat strip metrics derive from currently-loaded pages — relay meta
  // doesn't expose aggregate stock counts.
  const stats = useMemo(() => {
    let lowStock = 0;
    let outOfStock = 0;
    for (const it of items) {
      if (it.stock_on_hand === 0) outOfStock += 1;
      else if (it.stock_on_hand < LOW_STOCK_THRESHOLD) lowStock += 1;
    }
    return {total: items.length, lowStock, outOfStock};
  }, [items]);

  const renderItem = ({item}: {item: Product}) => (
    <TouchableOpacity
      style={styles.row}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={`${item.name}, ${formatCurrency(item.price_cents)}, ${item.stock_on_hand} on hand. Tap to view.`}
      onPress={() => {
        haptics.light();
        navigation.navigate('ProductDetail', {productId: item.id});
      }}>
      <View style={styles.rowLeft}>
        <Text style={styles.rowName} numberOfLines={1}>
          {item.name}
        </Text>
        <Text style={styles.rowMeta}>
          {item.sku || '—'}
          {item.category_name ? ` · ${item.category_name}` : ''}
        </Text>
      </View>
      <View style={styles.rowRight}>
        <Text style={styles.rowPrice}>{formatCurrency(item.price_cents)}</Text>
        <Text
          style={[
            styles.rowStock,
            item.stock_on_hand <= 0 && styles.rowStockOut,
          ]}>
          {item.stock_on_hand <= 0
            ? 'Out of stock'
            : `${item.stock_on_hand} on hand`}
        </Text>
      </View>
      <Ionicons
        name="chevron-forward"
        size={ICON_SIZE.action}
        color={COLORS.textMuted}
        style={styles.chevron}
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
    if (error && items.length > 0) {
      return (
        <TouchableOpacity
          style={styles.footerRetry}
          onPress={() => fetchPage(page + 1, true, search)}
          accessibilityRole="button"
          accessibilityLabel="Retry loading next page">
          <Text style={styles.footerRetryText}>Tap to retry</Text>
        </TouchableOpacity>
      );
    }
    if (items.length > 0 && page >= lastPage) {
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
    return (
      <EmptyState
        title={search ? 'No items match your search' : 'No items found'}
        description={
          search
            ? 'Try a different name or SKU.'
            : 'Add your first product on the Aeris web console.'
        }
        icon="cube-outline"
      />
    );
  };

  return (
    <SafeAreaView
      style={styles.container}
      edges={['left', 'right']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Items</Text>
      </View>

      <View style={styles.statsStrip}>
        <View style={styles.statCell}>
          <StatCard
            label="Total"
            value={String(stats.total)}
            icon="cube-outline"
          />
        </View>
        <View style={styles.statCell}>
          <StatCard
            label="Low Stock"
            value={String(stats.lowStock)}
            icon="alert-circle-outline"
            tone={stats.lowStock > 0 ? 'warning' : 'default'}
          />
        </View>
        <View style={styles.statCell}>
          <StatCard
            label="Out"
            value={String(stats.outOfStock)}
            icon="close-circle-outline"
            tone={stats.outOfStock > 0 ? 'danger' : 'default'}
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
          placeholder="Search items by name or SKU"
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
        <TouchableOpacity
          onPress={() => {
            haptics.light();
            navigation.navigate('Scanner', {mode: 'detail'});
          }}
          style={styles.scanBtn}
          accessibilityRole="button"
          accessibilityLabel="Scan barcode"
          hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}>
          <Ionicons
            name="barcode-outline"
            size={ICON_SIZE.hero}
            color={COLORS.crimson}
          />
        </TouchableOpacity>
      </View>

      {error ? (
        <View style={styles.bannerWrap}>
          <ErrorBanner
            message={error}
            onRetry={() => fetchPage(1, false, search)}
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
          data={items}
          renderItem={renderItem}
          keyExtractor={item => String(item.id)}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={renderEmpty}
          ListFooterComponent={renderFooter}
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.3}
          // Tapping a row while the search keyboard is open should not
          // dismiss without action — keep the row tap responsive.
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
  searchInput: {
    flex: 1,
    color: COLORS.text,
    fontSize: FONT_SIZE.md,
  },
  clearBtn: {paddingHorizontal: SPACING.xs},
  scanBtn: {paddingLeft: SPACING.sm},
  loader: {marginTop: SPACING.xl},
  listContent: {
    paddingHorizontal: SPACING.md,
    paddingBottom: SPACING.xxl,
  },
  // Compact-row look: vertical SPACING.sm, horizontal SPACING.md
  row: {
    flexDirection: 'row',
    alignItems: 'center',
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
  rowMeta: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.xs,
    marginTop: 2,
  },
  rowRight: {alignItems: 'flex-end'},
  rowPrice: {
    color: COLORS.crimson,
    fontSize: FONT_SIZE.md,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  rowStock: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.xs,
    marginTop: 2,
    fontVariant: ['tabular-nums'],
  },
  rowStockOut: {color: COLORS.warning},
  chevron: {marginLeft: SPACING.sm},
  footerLoader: {paddingVertical: SPACING.lg, alignItems: 'center'},
  footerEnd: {paddingVertical: SPACING.lg, alignItems: 'center'},
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

export default ItemsScreen;
