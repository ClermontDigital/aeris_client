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
import {Ionicons} from '@expo/vector-icons';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {COLORS, SPACING, FONT_SIZE, BORDER_RADIUS} from '../constants/theme';
import {useCartStore} from '../stores/cartStore';
import {useProductCacheStore} from '../stores/productCacheStore';
import {useHaptics} from '../hooks/useHaptics';
import ApiClient from '../services/ApiClient';
import type {Product, Category} from '../types/api.types';
import type {QuickSaleStackParamList} from '../types/navigation.types';
import {formatCurrency} from '../utils/format';

type NavigationProp = NativeStackNavigationProp<QuickSaleStackParamList>;

export default function QuickSaleScreen() {
  const navigation = useNavigation<NavigationProp>();
  const haptics = useHaptics();
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
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const handleRefresh = useCallback(async () => {
    await syncProducts();
  }, [syncProducts]);

  const handleAddToCart = useCallback(
    (product: Product) => {
      haptics.light();
      addItem(product);
    },
    [addItem, haptics],
  );

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
        onPress={() => handleCategoryPress(null)}>
        <Text
          style={[
            styles.categoryPillText,
            selectedCategory === null && styles.categoryPillTextActive,
          ]}>
          All
        </Text>
      </TouchableOpacity>
      {categories.map((cat: Category) => (
        <TouchableOpacity
          key={cat.id}
          style={[
            styles.categoryPill,
            selectedCategory === cat.id && styles.categoryPillActive,
          ]}
          onPress={() => handleCategoryPress(cat.id)}>
          <Text
            style={[
              styles.categoryPillText,
              selectedCategory === cat.id && styles.categoryPillTextActive,
            ]}>
            {cat.name}
          </Text>
        </TouchableOpacity>
      ))}
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
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>
          {searchQuery
            ? 'No products match your search'
            : 'No products available'}
        </Text>
        <Text style={styles.emptySubtext}>
          Pull down to refresh the product catalog
        </Text>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right', 'bottom']}>
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
        <Ionicons
          name="search"
          size={18}
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
          returnKeyType="search"
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity
            onPress={() => setSearchQuery('')}
            style={styles.clearBtn}>
            <Ionicons name="close-circle" size={18} color={COLORS.textMuted} />
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
          <Ionicons name="barcode-outline" size={22} color={COLORS.crimson} />
        </TouchableOpacity>
      </View>

      {/* Category Pills */}
      {renderCategoryPills()}

      {/* Error */}
      {error && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {/* Loading */}
      {(isSearching || isSyncing) && (
        <ActivityIndicator
          color={COLORS.accent}
          size="large"
          style={styles.loader}
        />
      )}

      {/* Product Grid */}
      <FlatList
        data={displayProducts}
        renderItem={renderProductTile}
        keyExtractor={item => String(item.id)}
        numColumns={2}
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
            refreshing={isSyncing}
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
            <Ionicons name="chevron-forward" size={16} color={COLORS.white} />
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
    fontWeight: '700',
  },
  headerSubtitle: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.sm,
    fontWeight: '500',
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
    fontWeight: '500',
  },
  categoryPillTextActive: {
    color: COLORS.white,
    fontWeight: '600',
  },
  errorBanner: {
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
    fontWeight: '600',
    marginBottom: SPACING.sm,
    minHeight: 38,
    lineHeight: 19,
  },
  productPrice: {
    color: COLORS.crimson,
    fontSize: FONT_SIZE.lg,
    fontWeight: '700',
    marginBottom: SPACING.xs,
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
    fontWeight: '700',
  },
  cartBarActionRow: {flexDirection: 'row', alignItems: 'center'},
  cartBarAction: {
    color: COLORS.white,
    fontSize: FONT_SIZE.md,
    fontWeight: '600',
    marginRight: SPACING.xs,
  },
});
