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
import Icon from '../components/Icon';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
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
import {useProductCacheStore} from '../stores/productCacheStore';
import type {Product} from '../types/api.types';
import type {ItemsStackParamList} from '../types/navigation.types';
import {formatCurrency} from '../utils/format';
import StatCard, {pickStatRowFontSize} from '../components/StatCard';
import EmptyState from '../components/EmptyState';
import ErrorBanner from '../components/ErrorBanner';
import PillButton from '../components/PillButton';

type Nav = NativeStackNavigationProp<ItemsStackParamList>;

const PER_PAGE = 50;
const SEARCH_DEBOUNCE_MS = 300;
const LOW_STOCK_THRESHOLD = 10;

type StockFilter = 'all' | 'low' | 'out';

const ItemsScreen: React.FC = () => {
  const navigation = useNavigation<Nav>();
  const haptics = useHaptics();
  const {isTablet} = useResponsiveLayout();
  // On iPad, cap content (stat strip, search row, list, banner) at 720pt
  // and centre. Phone layout untouched.
  const tabletColumnCap = isTablet
    ? ({maxWidth: 720, alignSelf: 'center', width: '100%'} as const)
    : null;
  // Cached catalog (filled by productCacheStore.syncProducts on cold start
  // via App.tsx restoreCache, refreshed by QuickSale's pull-to-refresh).
  // Drives the Low / Out tile counts so they reflect the WHOLE catalog,
  // not just the pages the operator has scrolled into view on this screen.
  // `lastSynced` lets the empty-state copy distinguish "no cache yet" from
  // "really zero low-stock items".
  //
  // DEFENSIVE: the selector returns the live `products` slot, but a
  // refocus that races a syncProducts() rehydrate can briefly expose
  // intermediate states. Coercing to `[]` here guarantees the `.filter`
  // calls in `visibleItems` / `stats` below never see undefined and
  // crash the screen with "undefined is not a function" during a tab
  // re-tap from ProductDetail. This was the root cause of the "Something
  // went wrong" boundary firing on the Items tab.
  const cachedProducts = useProductCacheStore(s => s.products) ?? [];
  const cacheLastSynced = useProductCacheStore(s => s.lastSynced);
  const syncProducts = useProductCacheStore(s => s.syncProducts);
  const isSyncingCache = useProductCacheStore(s => s.isSyncing);

  const [search, setSearch] = useState('');
  const [stockFilter, setStockFilter] = useState<StockFilter>('all');
  const [items, setItems] = useState<Product[]>([]);
  const [page, setPage] = useState(1);
  const [lastPage, setLastPage] = useState(1);
  // Server's aggregate item count from the relay's pagination meta —
  // distinct from items.length, which only counts loaded pages.
  const [totalCount, setTotalCount] = useState(0);
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
        setTotalCount(result.meta.total);
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
    // Only paginate when the visible list is sourced from `items` (i.e.
    // we're on "All" with no search, OR any filter WITH a search). When a
    // Low/Out filter is active without search, visibleItems is sourced
    // from the full cache and pulling more pages over the wire would be
    // wasted bandwidth + leave the appended rows invisible behind the
    // cache filter.
    const searching = search.trim().length > 0;
    const usingItemsArray = stockFilter === 'all' || searching;
    if (!usingItemsArray) return;
    if (!isLoadingMore && page < lastPage) {
      fetchPage(page + 1, true, search);
    }
  }, [isLoadingMore, page, lastPage, search, fetchPage, stockFilter]);

  // Total comes from the server's pagination meta (stable across scrolling).
  // Low / Out are computed across the FULL cached catalog so the tiles
  // surface accurate counts at first paint — previously they only counted
  // the currently-loaded pages and ticked upward as the user scrolled,
  // which read as broken (a fresh screen would show "0 low stock" even
  // when the catalog has dozens of low-stock SKUs). When the cache hasn't
  // synced yet we fall back to the loaded-pages count so the tiles aren't
  // permanently blank; the cacheReady flag adapts copy so the operator
  // knows whether the number is preliminary.
  const cacheReady = cachedProducts.length > 0 && cacheLastSynced !== null;
  const stats = useMemo(() => {
    // DEFENSIVE: belt-and-braces. cachedProducts is already nullish-
    // coalesced at the selector boundary, but the for-of loop below
    // would throw "undefined is not iterable" if either source were
    // ever falsy — keeping the screen render-safe is cheap insurance.
    const source = cacheReady
      ? (Array.isArray(cachedProducts) ? cachedProducts : [])
      : (Array.isArray(items) ? items : []);
    let lowStock = 0;
    let outOfStock = 0;
    for (const it of source) {
      if (it.stock_on_hand === 0) outOfStock += 1;
      else if (it.stock_on_hand < LOW_STOCK_THRESHOLD) lowStock += 1;
    }
    // Prefer the server-side meta.total over the cache length for "Total"
    // unless we have a fresher cache (e.g. user added items elsewhere and
    // the cache caught it but the relay paginator is still serving stale).
    const total =
      totalCount > 0 ? totalCount : cacheReady ? cachedProducts.length : 0;
    return {total, lowStock, outOfStock};
  }, [cacheReady, cachedProducts, items, totalCount]);

  // Kick off a catalog sync on first mount if the cache is empty. This
  // populates the tile counts within a few seconds of the screen
  // appearing without waiting for the user to pull-to-refresh on a
  // sibling screen. Re-sync if the cache is older than 5 minutes so the
  // counters stay current as inventory moves throughout a busy day.
  useEffect(() => {
    if (isSyncingCache) return;
    const CACHE_TTL_MS = 5 * 60 * 1000;
    const last = cacheLastSynced ? Date.parse(cacheLastSynced) : 0;
    const stale = !cacheLastSynced || Date.now() - last > CACHE_TTL_MS;
    if (stale) {
      // Fire and forget — the store sets isSyncing internally and the
      // counts re-derive when the products array lands.
      void syncProducts();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tile filter — when "Low" or "Out" is active and there's no search,
  // source from the FULL product cache so the visible list matches the
  // stat-tile count. Filtering only the loaded pages caused a confusing
  // mismatch: tile said "Low stock 21" but the list showed 3 because only
  // the first page was loaded. The cache is already populated for the
  // stats, so there's no extra fetch — we just reuse it.
  //
  // For "All" (no filter), stay with the paginated `items` array so the
  // user keeps progressive scroll-to-load behavior on large catalogs
  // instead of rendering the entire cache at once. For search, also stay
  // with paginated items — server-side search is the source of truth.
  const visibleItems = useMemo(() => {
    // DEFENSIVE: re-coerce to arrays at the memo boundary. The state
    // hooks above already guarantee these are arrays in practice, but
    // a cache rehydrate racing a tab re-focus has historically managed
    // to surface an intermediate undefined value here, crashing the
    // screen with "undefined is not a function" inside the ErrorBoundary
    // when the user taps the Items tab from ProductDetail.
    const safeItems = Array.isArray(items) ? items : [];
    const safeCache = Array.isArray(cachedProducts) ? cachedProducts : [];
    const trimmedSearch = search.trim();
    if (stockFilter === 'all') return safeItems;
    const filteredItems =
      stockFilter === 'low'
        ? safeItems.filter(
            it => it.stock_on_hand > 0 && it.stock_on_hand < LOW_STOCK_THRESHOLD,
          )
        : safeItems.filter(it => it.stock_on_hand <= 0);
    // When searching, we can't safely apply the cache (the cache doesn't
    // know about the search term). Fall back to filtered loaded pages.
    if (trimmedSearch || !cacheReady) return filteredItems;
    return stockFilter === 'low'
      ? safeCache.filter(
          it => it.stock_on_hand > 0 && it.stock_on_hand < LOW_STOCK_THRESHOLD,
        )
      : safeCache.filter(it => it.stock_on_hand <= 0);
  }, [items, cachedProducts, cacheReady, stockFilter, search]);

  const toggleFilter = useCallback(
    (next: StockFilter) => {
      haptics.selection();
      // Tapping the currently-active tile clears the filter — saves a
      // round-trip to "All" when the user just wants to step back.
      setStockFilter(prev => (prev === next ? 'all' : next));
    },
    [haptics],
  );

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
      <Icon
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
    if (search) {
      return (
        <EmptyState
          title="No items match your search"
          description="Try a different name or SKU."
          icon="cube-outline"
        />
      );
    }
    if (stockFilter === 'low') {
      return (
        <EmptyState
          title="No low-stock items on the loaded pages"
          description="Scroll the list to load more, or tap Total to clear the filter."
          icon="alert-circle-outline"
        />
      );
    }
    if (stockFilter === 'out') {
      return (
        <EmptyState
          title="No out-of-stock items on the loaded pages"
          description="Scroll the list to load more, or tap Total to clear the filter."
          icon="close-circle-outline"
        />
      );
    }
    return (
      <EmptyState
        title="No items found"
        description="Add your first product on the Aeris web console."
        icon="cube-outline"
      />
    );
  };

  return (
    <SafeAreaView
      style={styles.container}
      edges={['left', 'right']}>
      <View style={[styles.header, tabletColumnCap]}>
        <Text style={styles.headerTitle}>Items</Text>
        <PillButton
          label="New item"
          icon="plus"
          variant="solid"
          onPress={() => {
            haptics.light();
            navigation.navigate('ProductEdit');
          }}
          accessibilityLabel="Create a new item"
        />
      </View>

      {(() => {
        const totalStr = String(stats.total);
        const lowStr = String(stats.lowStock);
        const outStr = String(stats.outOfStock);
        const fs = pickStatRowFontSize([totalStr, lowStr, outStr]);
        return (
          <View style={[styles.statsStrip, tabletColumnCap]}>
            <View
              style={[
                styles.statCell,
                stockFilter === 'all' && styles.statCellActive,
              ]}>
              <StatCard
                label="Total"
                value={totalStr}
                icon="cube-outline"
                valueFontSize={fs}
                onPress={() => toggleFilter('all')}
              />
            </View>
            <View
              style={[
                styles.statCell,
                stockFilter === 'low' && styles.statCellActive,
              ]}>
              <StatCard
                label="Low stock"
                value={lowStr}
                icon="alert-circle-outline"
                tone={stats.lowStock > 0 ? 'warning' : 'default'}
                valueFontSize={fs}
                onPress={() => toggleFilter('low')}
              />
            </View>
            <View
              style={[
                styles.statCell,
                stockFilter === 'out' && styles.statCellActive,
              ]}>
              <StatCard
                label="Out"
                value={outStr}
                icon="close-circle-outline"
                tone={stats.outOfStock > 0 ? 'danger' : 'default'}
                valueFontSize={fs}
                onPress={() => toggleFilter('out')}
              />
            </View>
          </View>
        );
      })()}

      <View style={[styles.searchRow, tabletColumnCap]}>
        <Icon
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
            <Icon
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
          <Icon
            name="barcode-outline"
            size={ICON_SIZE.hero}
            color={COLORS.crimson}
          />
        </TouchableOpacity>
      </View>

      {error ? (
        <View style={[styles.bannerWrap, tabletColumnCap]}>
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
          data={visibleItems}
          renderItem={renderItem}
          keyExtractor={item => String(item.id)}
          // tabletColumnCap goes on `style` (outer scroll container), not
          // `contentContainerStyle` — the latter sits inside the scroll
          // container and has its own width=100% behaviour that overrides
          // maxWidth, leaving the list full-bleed while the chrome above
          // is centred at 720pt (visually broken on iPad landscape).
          style={tabletColumnCap}
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.md,
    paddingBottom: SPACING.sm,
  },
  headerTitle: {
    color: COLORS.text,
    fontSize: FONT_SIZE.xxl,
    fontFamily: FONT_FAMILY.bold,
    // Let the title shrink before the New Item pill on narrow phones.
    flexShrink: 1,
    marginRight: SPACING.sm,
  },
  statsStrip: {
    flexDirection: 'row',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.md,
    marginBottom: SPACING.sm,
  },
  statCell: {flex: 1},
  // Highlight the active filter tile with a crimson border ring. The
  // wrapper View takes the border so we don't fight StatCard's internal
  // border/shadow tokens. 2px so the active state reads at arm's length
  // without making the inactive cells look "missing" a border.
  statCellActive: {
    borderRadius: BORDER_RADIUS.xxl + 2,
    borderWidth: 2,
    borderColor: COLORS.crimson,
  },
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
  rowName: {color: COLORS.text, fontSize: FONT_SIZE.md, fontFamily: FONT_FAMILY.medium},
  rowMeta: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.xs,
    marginTop: 2,
  },
  rowRight: {alignItems: 'flex-end'},
  rowPrice: {
    color: COLORS.crimson,
    fontSize: FONT_SIZE.md,
    fontFamily: FONT_FAMILY.bold,
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

export default ItemsScreen;
