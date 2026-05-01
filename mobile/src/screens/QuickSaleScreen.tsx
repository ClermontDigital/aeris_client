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
import * as Haptics from 'expo-haptics';
import {COLORS, SPACING, FONT_SIZE, BORDER_RADIUS} from '../constants/theme';
import {useCartStore} from '../stores/cartStore';
import {useProductCacheStore} from '../stores/productCacheStore';
import ApiClient from '../services/ApiClient';
import type {Product, Category} from '../types/api.types';
import type {QuickSaleStackParamList} from '../types/navigation.types';

type NavigationProp = NativeStackNavigationProp<QuickSaleStackParamList>;

const formatCurrency = (cents: number) => '$' + (cents / 100).toFixed(2);

export default function QuickSaleScreen() {
  const navigation = useNavigation<NavigationProp>();
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
      setError(msg);
    } finally {
      setIsSearching(false);
    }
  }, [cachedProducts, searchQuery, selectedCategory, searchLocal]);

  const handleRefresh = useCallback(async () => {
    await syncProducts();
  }, [syncProducts]);

  const handleAddToCart = useCallback(
    (product: Product) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      addItem(product);
    },
    [addItem],
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
      {/* Search Bar + Scan shortcut */}
      <View style={styles.searchContainer}>
        <Text style={styles.searchIcon}>Search</Text>
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
          <TouchableOpacity onPress={() => setSearchQuery('')}>
            <Text style={styles.clearButton}>Clear</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={styles.scanButton}
          onPress={() => navigation.navigate('Scanner')}
          accessibilityRole="button"
          accessibilityLabel="Scan barcode">
          <Ionicons name="barcode" size={22} color={COLORS.cream} />
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
        contentContainerStyle={styles.gridContent}
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
          activeOpacity={0.8}>
          <Text style={styles.cartBarText}>
            {itemCount} {itemCount === 1 ? 'item' : 'items'} &mdash;{' '}
            {formatCurrency(totalCents)}
          </Text>
          <Text style={styles.cartBarAction}>View Cart &gt;</Text>
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
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.inputBg,
    borderWidth: 1,
    borderColor: COLORS.inputBorder,
    borderRadius: BORDER_RADIUS.lg,
    marginHorizontal: SPACING.md,
    marginTop: SPACING.sm,
    paddingHorizontal: SPACING.md,
    height: 44,
  },
  searchIcon: {
    color: COLORS.textDim,
    fontSize: FONT_SIZE.sm,
    marginRight: SPACING.sm,
  },
  searchInput: {
    flex: 1,
    color: COLORS.text,
    fontSize: FONT_SIZE.md,
    height: 44,
  },
  clearButton: {
    color: COLORS.accent,
    fontSize: FONT_SIZE.sm,
    paddingLeft: SPACING.sm,
  },
  scanButton: {
    // Apple HIG minimum tap target is 44×44.
    width: 44,
    height: 44,
    borderRadius: BORDER_RADIUS.md,
    backgroundColor: COLORS.crimson,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: SPACING.sm,
  },
  categoryStrip: {
    maxHeight: 48,
    marginTop: SPACING.sm,
  },
  categoryContent: {
    paddingHorizontal: SPACING.md,
    gap: SPACING.sm,
  },
  categoryPill: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
    borderRadius: BORDER_RADIUS.full,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.surfaceBorder,
    marginRight: SPACING.sm,
  },
  categoryPillActive: {
    backgroundColor: COLORS.crimson,
    borderColor: COLORS.crimson,
  },
  categoryPillText: {
    color: COLORS.text,
    fontSize: FONT_SIZE.sm,
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
    padding: SPACING.md,
    paddingBottom: 100,
  },
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
  },
  productName: {
    color: COLORS.text,
    fontSize: FONT_SIZE.md,
    fontWeight: '600',
    marginBottom: SPACING.xs,
    minHeight: 36,
  },
  productPrice: {
    color: COLORS.accent,
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
  cartBar: {
    position: 'absolute',
    bottom: SPACING.lg,
    left: SPACING.md,
    right: SPACING.md,
    backgroundColor: COLORS.accent,
    borderRadius: BORDER_RADIUS.lg,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.lg,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    shadowColor: COLORS.black,
    shadowOffset: {width: 0, height: 4},
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  cartBarText: {
    color: COLORS.white,
    fontSize: FONT_SIZE.md,
    fontWeight: '700',
  },
  cartBarAction: {
    color: COLORS.white,
    fontSize: FONT_SIZE.md,
    fontWeight: '600',
  },
});
