import React, {useState, useCallback, useEffect, useRef} from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  TouchableOpacity,
  ScrollView,
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
import {useCartStore} from '../stores/cartStore';
import {useNavHistoryStore} from '../stores/navHistoryStore';
import {useProductCacheStore} from '../stores/productCacheStore';
import {useHaptics} from '../hooks/useHaptics';
import {useResponsiveLayout} from '../hooks/useResponsiveLayout';
import ApiClient from '../services/ApiClient';
import EmptyState from '../components/EmptyState';
import ErrorBanner from '../components/ErrorBanner';
import type {Product, Category} from '../types/api.types';
import type {QuickSaleStackParamList} from '../types/navigation.types';
import {formatCurrency} from '../utils/format';
import {isLikelyBarcode} from '../utils/barcode';

type NavigationProp = NativeStackNavigationProp<QuickSaleStackParamList>;

export default function QuickSaleScreen() {
  const navigation = useNavigation<NavigationProp>();
  const haptics = useHaptics();
  const {widthClass} = useResponsiveLayout();
  const numColumns = widthClass === 'wide' ? 4 : widthClass === 'regular' ? 3 : 2;
  const {addItem, getItemCount, getTotalCents} = useCartStore();
  const {
    products: cachedProducts,
    categories,
    isSyncing,
    syncProducts,
    searchLocal,
  } = useProductCacheStore();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<number | null>(null);
  const [displayProducts, setDisplayProducts] = useState<Product[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stockNotice, setStockNotice] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stockNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const itemCount = getItemCount();
  const totalCents = getTotalCents();

  // Load products on mount or when category/search changes
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(() => {
      loadProducts();
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery, selectedCategory, cachedProducts]);

  const loadProducts = useCallback(async () => {
    setError(null);

    // Try local cache first
    if (cachedProducts.length > 0) {
      let results = searchQuery
        ? searchLocal(searchQuery)
        : cachedProducts;

      if (selectedCategory !== null) {
        results = results.filter(p => p.category_id === selectedCategory);
      }

      setDisplayProducts(results);
      return;
    }

    // Fallback to API search
    setIsSearching(true);
    try {
      const trimmed = searchQuery.trim();
      const response = trimmed
        ? await ApiClient.searchProducts(
            trimmed,
            1,
            50,
            selectedCategory ?? undefined,
          )
        : await ApiClient.listProducts(1, 50, selectedCategory ?? undefined);
      setDisplayProducts(response.data);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to load products';
      haptics.error();
      setError(msg);
    } finally {
      setIsSearching(false);
    }
  }, [cachedProducts, searchQuery, selectedCategory, searchLocal, haptics]);

  // Track user-pulled-to-refresh separately from the background `isSyncing`
  // flag. The cache sync paginates the whole catalog (can take 30-60s on
  // larger workspaces) and we don't want the spinner showing for every
  // background refresh — only when the cashier explicitly pulled down.
  const [userRefreshing, setUserRefreshing] = useState(false);
  const handleRefresh = useCallback(async () => {
    setUserRefreshing(true);
    try {
      await syncProducts();
    } finally {
      setUserRefreshing(false);
    }
  }, [syncProducts]);

  // Treat absent track_stock as "tracked" so the gate matches the cashier's
  // expectation; explicit false (untracked items) bypasses the stock check.
  const isOutOfStock = useCallback((product: Product): boolean => {
    const tracked = (product as Product & {track_stock?: boolean}).track_stock;
    if (tracked === false) return false;
    return product.stock_on_hand <= 0;
  }, []);

  const handleAddToCart = useCallback(
    (product: Product) => {
      if (isOutOfStock(product)) {
        haptics.error();
        if (stockNoticeTimerRef.current) clearTimeout(stockNoticeTimerRef.current);
        setStockNotice(`${product.name} is out of stock.`);
        // Auto-dismiss after 2.5s; cashier doesn't need to chase a close button.
        stockNoticeTimerRef.current = setTimeout(() => {
          setStockNotice(null);
          stockNoticeTimerRef.current = null;
        }, 2500);
        return;
      }
      haptics.light();
      addItem(product);
    },
    [addItem, haptics, isOutOfStock],
  );

  // Bluetooth HID barcode scanners type the scan into whatever TextInput
  // is focused, then send Enter/CR. We hook the search bar's onSubmitEditing
  // and if the buffer looks like a barcode, try a direct product lookup +
  // add-to-cart. Cache-first (instant), then fall back to the relay.
  const [isBtScanning, setIsBtScanning] = useState(false);
  const handleSearchSubmit = useCallback(async () => {
    const trimmed = searchQuery.trim();
    if (!isLikelyBarcode(trimmed) || isBtScanning) return;
    setIsBtScanning(true);
    try {
      let found: Product | null = null;
      // Cache hit first — cheaper + instant for stocked SKUs the cashier
      // sees most often.
      const cacheHit = cachedProducts.find(
        p => typeof p.barcode === 'string' && p.barcode === trimmed,
      );
      if (cacheHit) {
        found = cacheHit;
      } else {
        const detail = await ApiClient.getProductByBarcode(trimmed);
        if (detail) found = detail;
      }
      if (found) {
        handleAddToCart(found);
        setSearchQuery('');
      } else {
        haptics.error();
        // Clear the buffer + reuse the stockNotice banner. Without this
        // the screen would hold the scanned barcode in the search box
        // and slide into the "No products match your search" empty
        // state, which reads like the app is asking the cashier to
        // create a new item.
        setSearchQuery('');
        if (stockNoticeTimerRef.current) {
          clearTimeout(stockNoticeTimerRef.current);
        }
        setStockNotice(`Barcode ${trimmed} not found.`);
        stockNoticeTimerRef.current = setTimeout(() => {
          setStockNotice(null);
          stockNoticeTimerRef.current = null;
        }, 2500);
      }
    } catch {
      haptics.error();
    } finally {
      setIsBtScanning(false);
    }
  }, [searchQuery, isBtScanning, cachedProducts, handleAddToCart, haptics]);

  // Clean up the auto-dismiss timer on unmount so a tap-then-leave doesn't
  // setState on an unmounted component.
  useEffect(() => {
    return () => {
      if (stockNoticeTimerRef.current) {
        clearTimeout(stockNoticeTimerRef.current);
        stockNoticeTimerRef.current = null;
      }
    };
  }, []);

  const handleCategoryPress = useCallback((categoryId: number | null) => {
    setSelectedCategory(categoryId);
  }, []);

  const renderCategoryPills = () => (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.categoryStrip}
      contentContainerStyle={styles.categoryContent}>
      <TouchableOpacity
        style={[
          styles.categoryPill,
          selectedCategory === null && styles.categoryPillActive,
        ]}
        accessibilityRole="button"
        accessibilityLabel="Category All"
        accessibilityState={{selected: selectedCategory === null}}
        onPress={() => handleCategoryPress(null)}>
        <Text
          style={[
            styles.categoryPillText,
            selectedCategory === null && styles.categoryPillTextActive,
          ]}>
          All
        </Text>
      </TouchableOpacity>
      {categories.map((cat: Category) => {
        const selected = selectedCategory === cat.id;
        return (
          <TouchableOpacity
            key={cat.id}
            style={[
              styles.categoryPill,
              selected && styles.categoryPillActive,
            ]}
            accessibilityRole="button"
            accessibilityLabel={`Category ${cat.name}`}
            accessibilityState={{selected}}
            onPress={() => handleCategoryPress(cat.id)}>
            <Text
              style={[
                styles.categoryPillText,
                selected && styles.categoryPillTextActive,
              ]}>
              {cat.name}
            </Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );

  const renderProductTile = ({item}: {item: Product}) => {
    const stockColor =
      item.stock_on_hand > 10
        ? COLORS.success
        : item.stock_on_hand > 0
        ? COLORS.warning
        : COLORS.danger;

    return (
      <TouchableOpacity
        style={styles.productTile}
        onPress={() => handleAddToCart(item)}
        onLongPress={() => {
          haptics.medium();
          // Drop a breadcrumb so Back from ProductDetail returns the user
          // to the QuickSale grid rather than the Items list. Cross-tab
          // navigate to Items → ProductDetail using `initial: false` so
          // ProductDetail appends onto the Items stack (a later Items-tab
          // tap then pops cleanly back to ItemsList).
          useNavHistoryStore.getState().push({
            tab: 'QuickSale',
            screen: 'ProductGrid',
            params: {},
          });
          const parent = navigation.getParent?.();
          if (!parent) return;
          (
            parent as unknown as {
              navigate: (tab: string, params: object) => void;
            }
          ).navigate('Items', {
            initial: false,
            screen: 'ProductDetail',
            params: {productId: item.id},
          });
        }}
        activeOpacity={0.7}>
        <Text style={styles.productName} numberOfLines={2}>
          {item.name}
        </Text>
        <Text style={styles.productPrice}>
          {formatCurrency(item.price_cents)}
        </Text>
        <View style={styles.stockRow}>
          <View style={[styles.stockDot, {backgroundColor: stockColor}]} />
          <Text style={styles.stockText}>
            {item.stock_on_hand > 0
              ? `${item.stock_on_hand} in stock`
              : 'Out of stock'}
          </Text>
        </View>
      </TouchableOpacity>
    );
  };

  const renderEmpty = () => {
    if (isSearching || isSyncing) return null;
    return (
      <EmptyState
        icon={searchQuery ? 'search-outline' : 'cube-outline'}
        title={
          searchQuery ? 'No products match your search' : 'No products available'
        }
        description="Pull down to refresh the product catalog"
      />
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right']}>
      {/* Header — matches Items/Customers/Transactions for visual consistency */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Sale</Text>
        {itemCount > 0 ? (
          <Text style={styles.headerSubtitle}>
            {itemCount} {itemCount === 1 ? 'item' : 'items'} in cart
          </Text>
        ) : null}
      </View>

      {/* Search Bar + inline Scan shortcut */}
      <View style={styles.searchContainer}>
        <Icon
          name="search"
          size={ICON_SIZE.action}
          color={COLORS.textMuted}
          style={styles.searchIcon}
        />
        <TextInput
          style={styles.searchInput}
          placeholder="Search products..."
          placeholderTextColor={COLORS.inputPlaceholder}
          value={searchQuery}
          onChangeText={setSearchQuery}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          onSubmitEditing={handleSearchSubmit}
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity
            onPress={() => setSearchQuery('')}
            style={styles.clearBtn}>
            <Icon
              name="close-circle"
              size={ICON_SIZE.action}
              color={COLORS.textMuted}
            />
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={styles.scanButton}
          onPress={() => {
            haptics.light();
            navigation.navigate('Scanner');
          }}
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

      {/* Category Pills */}
      {renderCategoryPills()}

      {/* Error */}
      {error ? (
        <View style={styles.errorWrap}>
          <ErrorBanner message={error} onRetry={loadProducts} />
        </View>
      ) : null}

      {/* Out-of-stock notice — auto-dismisses after 2.5s. */}
      {stockNotice ? (
        <View style={styles.errorWrap}>
          <ErrorBanner message={stockNotice} tone="warning" />
        </View>
      ) : null}

      {/* Loading — first-time only. When products are already on screen
          and the user pulls to refresh, the RefreshControl below handles
          the spinner; rendering this big ActivityIndicator on top of it
          stacked two loaders in the same gesture (the user's complaint:
          one for products, one for categories, but it was actually this
          and the pull-to-refresh spinner together). */}
      {(isSearching || isSyncing) && displayProducts.length === 0 && (
        <ActivityIndicator
          color={COLORS.accent}
          size="large"
          style={styles.loader}
        />
      )}

      {/* Product Grid */}
      <FlatList
        // FlatList memoises the column count internally — when the device
        // rotates (or iPad multitasking resizes the window) numColumns
        // changes; remounting via key avoids the "Changing numColumns on
        // the fly is not supported" warning.
        key={`grid-${numColumns}`}
        data={displayProducts}
        renderItem={renderProductTile}
        keyExtractor={item => String(item.id)}
        numColumns={numColumns}
        columnWrapperStyle={styles.gridRow}
        // Tighter bottom padding when the cart bar isn't visible — its
        // 100pt clearance was leaving a dead band of cream space above
        // the tab bar when the cart was empty.
        contentContainerStyle={[
          styles.gridContent,
          itemCount > 0 ? styles.gridContentWithCart : styles.gridContentNoCart,
        ]}
        ListEmptyComponent={renderEmpty}
        refreshControl={
          <RefreshControl
            refreshing={userRefreshing}
            onRefresh={handleRefresh}
            tintColor={COLORS.accent}
          />
        }
      />

      {/* Floating Cart Summary Bar */}
      {itemCount > 0 && (
        <TouchableOpacity
          style={styles.cartBar}
          onPress={() => navigation.navigate('Cart')}
          activeOpacity={0.85}>
          <Text style={styles.cartBarText}>
            {itemCount} {itemCount === 1 ? 'item' : 'items'} · {formatCurrency(totalCents)}
          </Text>
          <View style={styles.cartBarActionRow}>
            <Text style={styles.cartBarAction}>View Cart</Text>
            <Icon
            name="chevron-forward"
            size={ICON_SIZE.action}
            color={COLORS.white}
          />
          </View>
        </TouchableOpacity>
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
    paddingTop: SPACING.md,
    paddingBottom: SPACING.sm,
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  headerTitle: {
    color: COLORS.text,
    fontSize: FONT_SIZE.xxl,
    fontFamily: FONT_FAMILY.bold,
  },
  headerSubtitle: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.sm,
    fontFamily: FONT_FAMILY.medium,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.inputBg,
    borderWidth: 1,
    borderColor: COLORS.inputBorder,
    borderRadius: BORDER_RADIUS.lg,
    marginHorizontal: SPACING.md,
    marginBottom: SPACING.xs,
    paddingHorizontal: SPACING.md,
    height: 44,
  },
  searchIcon: {
    marginRight: SPACING.sm,
  },
  searchInput: {
    flex: 1,
    color: COLORS.text,
    fontSize: FONT_SIZE.md,
    height: 44,
  },
  clearBtn: {paddingHorizontal: SPACING.xs},
  // Inline barcode icon — sits inside the search container at the right
  // edge. Borderless / crimson tint so it reads as part of the input row
  // rather than a separate floating button. Tap target via hitSlop.
  scanButton: {paddingLeft: SPACING.sm},
  categoryStrip: {
    maxHeight: 56,
    paddingVertical: SPACING.sm,
  },
  categoryContent: {
    paddingHorizontal: SPACING.md,
    alignItems: 'center',
  },
  // Wider horizontal padding + taller vertical padding so each pill has
  // breathing room and a real tap target. The previous SPACING.xs vertical
  // pad made the row feel "squished" against the search bar above and the
  // grid below.
  categoryPill: {
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
    borderRadius: BORDER_RADIUS.full,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.surfaceBorder,
    marginRight: SPACING.sm,
    minHeight: 36,
    justifyContent: 'center',
  },
  categoryPillActive: {
    backgroundColor: COLORS.crimson,
    borderColor: COLORS.crimson,
  },
  categoryPillText: {
    color: COLORS.text,
    fontSize: FONT_SIZE.sm,
    fontFamily: FONT_FAMILY.medium,
  },
  categoryPillTextActive: {
    color: COLORS.white,
    fontFamily: FONT_FAMILY.medium,
  },
  errorWrap: {
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.sm,
  },
  loader: {
    marginTop: SPACING.lg,
  },
  gridContent: {
    paddingHorizontal: SPACING.sm,
    paddingTop: SPACING.xs,
  },
  gridContentWithCart: {paddingBottom: 96},
  gridContentNoCart: {paddingBottom: SPACING.md},
  gridRow: {
    justifyContent: 'space-between',
  },
  productTile: {
    flex: 1,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.surfaceBorder,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.sm,
    marginHorizontal: SPACING.xs,
    shadowColor: COLORS.black,
    shadowOffset: {width: 0, height: 1},
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 1,
  },
  productName: {
    color: COLORS.text,
    fontSize: FONT_SIZE.md,
    fontFamily: FONT_FAMILY.medium,
    marginBottom: SPACING.sm,
    minHeight: 38,
    lineHeight: 19,
  },
  productPrice: {
    color: COLORS.crimson,
    fontSize: FONT_SIZE.lg,
    fontFamily: FONT_FAMILY.bold,
    marginBottom: SPACING.xs,
    fontVariant: ['tabular-nums'],
  },
  stockRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  stockDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: SPACING.xs,
  },
  stockText: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.xs,
  },
  // Sits ABOVE the bottom tab bar (which is ~49pt + bottom safe area on
  // iOS). 12pt of clearance keeps it from kissing the tab bar edge while
  // still feeling docked.
  cartBar: {
    position: 'absolute',
    bottom: SPACING.sm,
    left: SPACING.md,
    right: SPACING.md,
    backgroundColor: COLORS.crimson,
    borderRadius: BORDER_RADIUS.lg,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.lg,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    shadowColor: COLORS.black,
    shadowOffset: {width: 0, height: 6},
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 8,
  },
  cartBarText: {
    color: COLORS.white,
    fontSize: FONT_SIZE.md,
    fontFamily: FONT_FAMILY.bold,
    fontVariant: ['tabular-nums'],
  },
  cartBarActionRow: {flexDirection: 'row', alignItems: 'center'},
  cartBarAction: {
    color: COLORS.white,
    fontSize: FONT_SIZE.md,
    fontFamily: FONT_FAMILY.medium,
    marginRight: SPACING.xs,
  },
});
