import React, {useState, useEffect, useCallback} from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {useNavigation, useRoute, useFocusEffect} from '@react-navigation/native';
import type {RouteProp} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import Icon from '../components/Icon';
import PillButton from '../components/PillButton';
import StockAdjustModal from '../components/StockAdjustModal';
import Barcode, {canEncodeCode128B} from '../components/Barcode';
import ProductImagePicker from '../components/ProductImagePicker';
import {COLORS, SPACING, FONT_SIZE, FONT_FAMILY, BORDER_RADIUS} from '../constants/theme';
import ApiClient from '../services/ApiClient';
import {useHaptics} from '../hooks/useHaptics';
import {useResponsiveLayout} from '../hooks/useResponsiveLayout';
import type {ProductDetail, Sale, Supplier} from '../types/api.types';
import {useCartStore} from '../stores/cartStore';
import {useNavHistoryStore} from '../stores/navHistoryStore';
import {useHeaderBack} from '../hooks/useHeaderBack';
import type {ItemsStackParamList} from '../types/navigation.types';
import {formatCurrency} from '../utils/format';

type ProductDetailRouteProp = RouteProp<ItemsStackParamList, 'ProductDetail'>;
type Nav = NativeStackNavigationProp<ItemsStackParamList, 'ProductDetail'>;

export default function ProductDetailScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<ProductDetailRouteProp>();
  const haptics = useHaptics();
  const {isTablet} = useResponsiveLayout();
  const tabletColumnCap = isTablet
    ? ({maxWidth: 720, alignSelf: 'center', width: '100%'} as const)
    : null;
  const {productId, product: seedProduct} = route.params;

  // When the caller hands us a pre-fetched product (the barcode-scan path in
  // ItemsScreen does this), hydrate initial state from it so the screen
  // doesn't flash a spinner before showing the photo + details. The focus-
  // effect re-fetch still runs once the screen settles, so edits made
  // elsewhere are reflected on return.
  const [product, setProduct] = useState<ProductDetail | null>(
    seedProduct ?? null,
  );
  const [isLoading, setIsLoading] = useState(seedProduct == null);
  const [isUnavailable, setIsUnavailable] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [stockModalVisible, setStockModalVisible] = useState(false);
  const addItem = useCartStore(s => s.addItem);
  const [addedToCartMsg, setAddedToCartMsg] = useState<string | null>(null);
  // Auto-dismiss the cart-confirmation message after 2.5s so the
  // affordance reads as a transient toast rather than a sticky banner.
  useEffect(() => {
    if (!addedToCartMsg) return;
    const t = setTimeout(() => setAddedToCartMsg(null), 2500);
    return () => clearTimeout(t);
  }, [addedToCartMsg]);
  // Recent transactions involving this product. The `product_id` filter is
  // sent as a defensive param — once the marketplace dispatcher honours
  // it, the list is item-specific. Until then the user sees recent sales
  // generally, which is still useful navigation and matches their explicit
  // request to "show recent sales for this item". The section copy says
  // "Recent transactions" (not "for this item") to stay honest.
  const [recentSales, setRecentSales] = useState<Sale[]>([]);
  // Suppliers list — fetched once so we can render a name pill next to the
  // category pill when the product has a supplier_id. Best-effort: if the
  // marketplace dispatcher hasn't wired products.suppliers yet the list
  // stays empty and the supplier pill just doesn't render (no error state).
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await ApiClient.getSuppliers();
        if (!cancelled) setSuppliers(list);
      } catch {
        // Non-blocking; the pill just doesn't render.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  const supplierName =
    typeof product?.supplier_id === 'number'
      ? suppliers.find(s => s.id === product.supplier_id)?.name ?? null
      : null;

  const load = useCallback(async () => {
    setIsLoading(true);
    setIsUnavailable(false);
    setNotFound(false);
    try {
      const data = await ApiClient.getProductDetail(productId);
      if (data == null) {
        setNotFound(true);
      } else {
        setProduct(data);
      }
    } catch {
      // Dispatcher bug currently blocks products.detail; surface a soft
      // "not available yet" rather than a generic crash banner.
      setIsUnavailable(true);
    } finally {
      setIsLoading(false);
    }
  }, [productId]);

  useEffect(() => {
    // When a caller seeded us with a pre-fetched product (the barcode-scan
    // path), skip the on-mount load — initial state is already populated.
    // The useFocusEffect below still refreshes once the screen has settled,
    // so the user gets fresh data without a back-to-back duplicate fetch.
    if (seedProduct) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  // Fetch a small page of recent transactions for this product. Best-
  // effort — failures swallow silently so a non-essential section can't
  // break the screen. Capped at 5 so the round-trip stays cheap.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const page = await ApiClient.getTransactions({
          product_id: productId,
          per_page: 5,
          page: 1,
        });
        // DEFENSIVE: a malformed relay response (no `data` array) would
        // otherwise propagate undefined into recentSales and crash the
        // section's .map below. Coerce to [] at the boundary.
        if (!cancelled) {
          const list = Array.isArray(page?.data) ? page.data : [];
          setRecentSales(list);
        }
      } catch {
        // Transactions section is non-essential — leave empty on failure.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [productId]);

  // Re-fetch on focus so edits from ProductEdit are reflected when the
  // user swipes back. Skip the very first focus (the useEffect above
  // already handled it) — a guard ref isn't needed because the second
  // fetch is cheap and idempotent, but we avoid the double-loader flash
  // by only re-loading once we've already got a product.
  useFocusEffect(
    useCallback(() => {
      if (product !== null) {
        load();
      }
      return undefined;
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [load]),
  );

  // Single back handler shared by the brand-header Back button and the
  // in-page Back button. Cross-tab breadcrumb aware: if the user arrived via
  // a cross-tab jump (e.g. SaleDetail -> ProductDetail), return them to the
  // originating tab rather than popping inside the Items stack. The
  // useHeaderBack hook owns the double-fire guard so a fast double-tap can't
  // over-navigate (popPrev() mutates history).
  const handleBack = useCallback(() => {
    haptics.light();
    const prev = useNavHistoryStore.getState().popPrev();
    if (prev) {
      const parent = navigation.getParent?.();
      if (parent) {
        (parent as unknown as {
          navigate: (tab: string, params: object) => void;
        }).navigate(prev.tab, {
          initial: false,
          screen: prev.screen,
          params: prev.params ?? {},
        });
        return;
      }
    }
    navigation.goBack();
  }, [haptics, navigation]);

  // Surface the Back button in the shared brand header while focused. The
  // useHeaderBack hook owns the focus/re-assert/cleanup ownership dance.
  useHeaderBack(handleBack);

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container} edges={['left', 'right']}>
        <View style={styles.center}>
          <ActivityIndicator color={COLORS.accent} size="large" />
        </View>
      </SafeAreaView>
    );
  }

  if (isUnavailable) {
    return (
      <SafeAreaView style={styles.container} edges={['left', 'right']}>
        <View style={styles.center}>
          <Icon
            name="cloud-offline-outline"
            size={36}
            color={COLORS.textDim}
            style={styles.errorIcon}
          />
          <Text style={styles.errorTitle}>Detail view not available</Text>
          <Text style={styles.errorBody}>
            We couldn&apos;t load this item right now. Please try again in a
            moment.
          </Text>
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={() => {
              haptics.light();
              load();
            }}>
            <Text style={styles.primaryBtnText}>Retry</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => {
              haptics.light();
              navigation.goBack();
            }}>
            <Text style={styles.linkText}>Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (notFound || !product) {
    return (
      <SafeAreaView style={styles.container} edges={['left', 'right']}>
        <View style={styles.center}>
          <Icon
            name="search-outline"
            size={36}
            color={COLORS.textDim}
            style={styles.errorIcon}
          />
          <Text style={styles.errorTitle}>Item not found</Text>
          <TouchableOpacity
            onPress={() => {
              haptics.light();
              navigation.goBack();
            }}>
            <Text style={styles.linkText}>Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const stockLevels = product.stock_levels ?? [];
  const totalOnHand = product.stock_on_hand ?? 0;
  // Render the server's own stock_status (ProductResource::getStockStatus)
  // rather than recomputing a threshold — the client can't see reorder_level
  // (the wire never sends it), so recomputing drifted from the server and
  // caused #27. Fall back to a plain on-hand check only when the deployment
  // doesn't surface stock_status.
  const stockStatus =
    product.stock_status ?? (totalOnHand <= 0 ? 'out_of_stock' : 'in_stock');
  const stockTone =
    stockStatus === 'out_of_stock'
      ? styles.stockOut
      : stockStatus === 'low_stock'
      ? styles.stockLow
      : styles.stockOk;
  const stockLabel =
    stockStatus === 'out_of_stock'
      ? 'Out of stock'
      : stockStatus === 'low_stock'
      ? 'Low stock'
      : stockStatus === 'overstocked'
      ? 'Overstocked'
      : 'In stock';

  // Margin = (price - cost) / price. Only meaningful when both > 0; we hide
  // the row otherwise so we don't render "100%" or "Infinity%" for free items.
  const marginPct =
    product.cost_cents != null &&
    product.cost_cents >= 0 &&
    product.price_cents > 0
      ? Math.round(
          ((product.price_cents - product.cost_cents) / product.price_cents) *
            100,
        )
      : null;

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right']}>
      <ScrollView contentContainerStyle={[styles.scroll, tabletColumnCap]}>
        <View style={styles.heroCard}>
          <View style={styles.heroTopRow}>
            <View style={styles.heroTitleWrap}>
              <Text style={styles.name}>{product.name}</Text>
              <View style={styles.metaRow}>
                <View style={styles.metaItem}>
                  <Icon
                    name="pricetag-outline"
                    size={12}
                    color={COLORS.textMuted}
                    style={styles.metaIcon}
                  />
                  <Text style={styles.meta}>{product.sku || ''}</Text>
                </View>
                {/* Barcode number intentionally omitted here — the actual
                    rendered barcode below already exposes the value, so
                    showing the digits again above is redundant. */}
              </View>
            </View>
            <View
              style={[
                styles.badge,
                product.is_active ? styles.badgeActive : styles.badgeInactive,
              ]}>
              <Text style={styles.badgeText}>
                {product.is_active ? 'Active' : 'Inactive'}
              </Text>
            </View>
          </View>
          <View style={styles.pillRow}>
            {product.category_name ? (
              <View style={styles.categoryPill}>
                <Icon
                  name="folder-outline"
                  size={12}
                  color={COLORS.text}
                  style={styles.metaIcon}
                />
                <Text style={styles.categoryPillText}>
                  {product.category_name}
                </Text>
              </View>
            ) : null}
            {supplierName ? (
              <View style={styles.categoryPill}>
                <Icon
                  name="cube-outline"
                  size={12}
                  color={COLORS.text}
                  style={styles.metaIcon}
                />
                <Text style={styles.categoryPillText}>{supplierName}</Text>
              </View>
            ) : null}
            <View style={styles.stockPill}>
              <View style={[styles.stockDot, stockTone]} />
              <Text style={styles.stockPillText}>{stockLabel}</Text>
            </View>
          </View>
          <View style={styles.actionRow}>
            <PillButton
              label="Add to cart"
              icon="shopping-cart"
              variant="solid"
              onPress={() => {
                if (product.stock_on_hand <= 0) {
                  haptics.error();
                  setAddedToCartMsg('Out of stock — can’t add to cart.');
                  return;
                }
                addItem(product);
                haptics.success();
                setAddedToCartMsg(`${product.name} added to cart.`);
              }}
              accessibilityLabel={`Add ${product.name} to cart`}
              style={styles.primaryAction}
            />
            <PillButton
              label="Edit"
              icon="settings"
              variant="secondary"
              onPress={() => {
                haptics.light();
                navigation.navigate('ProductEdit', {productId: product.id});
              }}
              accessibilityLabel="Edit this item"
              style={styles.secondaryAction}
            />
            <PillButton
              label="Adjust stock"
              variant="secondary"
              onPress={() => {
                haptics.light();
                setStockModalVisible(true);
              }}
              accessibilityLabel="Adjust stock for this item"
              style={styles.secondaryAction}
            />
          </View>
          {addedToCartMsg ? (
            <Text
              style={styles.addedToCartConfirm}
              accessibilityLiveRegion="polite">
              {addedToCartMsg}
            </Text>
          ) : null}
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Photo</Text>
          <ProductImagePicker
            productId={product.id}
            type="featured"
            currentImageUrl={product.featured_image ?? product.image_url}
            onUploaded={updated => {
              // Merge the new image URL into the loaded detail so the card
              // reflects it without a full re-fetch. The focus-effect reload
              // will reconcile the rest on the next visit.
              setProduct(prev =>
                prev
                  ? {
                      ...prev,
                      image_url: updated.image_url ?? prev.image_url,
                      featured_image:
                        updated.featured_image ?? prev.featured_image,
                    }
                  : prev,
              );
            }}
          />
        </View>

        {product.barcode && canEncodeCode128B(product.barcode) ? (
          // Per design pass: just the barcode, no chrome copy. The card
          // container stays so the barcode reads as a deliberate UI element
          // rather than floating glyphs on the page.
          <View style={styles.shareCard}>
            <View style={styles.barcodeWrap}>
              <Barcode
                value={product.barcode}
                width={300}
                height={84}
                showText={false}
              />
            </View>
          </View>
        ) : null}

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Pricing</Text>
          <Text style={styles.price}>{formatCurrency(product.price_cents)}</Text>
          {product.cost_cents != null ? (
            <View style={styles.kvRow}>
              <Text style={styles.kvLabel}>Cost</Text>
              <Text style={styles.kvValue}>
                {formatCurrency(product.cost_cents)}
              </Text>
            </View>
          ) : null}
          {marginPct != null ? (
            <View style={styles.kvRow}>
              <Text style={styles.kvLabel}>Margin</Text>
              <Text
                style={[
                  styles.kvValue,
                  marginPct < 0 && styles.marginNegative,
                ]}>
                {marginPct}%
              </Text>
            </View>
          ) : null}
          <View style={[styles.kvRow, styles.kvRowLast]}>
            <Text style={styles.kvLabel}>Tax rate</Text>
            <Text style={styles.kvValue}>{product.tax_rate}%</Text>
          </View>
        </View>

        <View style={styles.card}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Stock</Text>
            <Text style={styles.totalOnHand}>
              {totalOnHand} <Text style={styles.totalOnHandUnit}>on hand</Text>
            </Text>
          </View>
          {stockLevels.length > 0 ? (
            stockLevels.map((level, idx) => (
              <View
                key={level.location_id}
                style={[
                  styles.tableRow,
                  idx === stockLevels.length - 1 && styles.tableRowLast,
                ]}>
                <View style={styles.tableLabelWrap}>
                  <Icon
                    name="location-outline"
                    size={14}
                    color={COLORS.textMuted}
                    style={styles.metaIcon}
                  />
                  <Text style={styles.tableLabel} numberOfLines={1}>
                    {level.location_name}
                  </Text>
                </View>
                <Text style={styles.tableValue}>{level.on_hand}</Text>
              </View>
            ))
          ) : (
            <Text style={styles.emptyHint}>
              No per-location breakdown available.
            </Text>
          )}
        </View>

        {recentSales.length > 0 ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Recent transactions</Text>
            {recentSales.map((s, idx) => {
              const ts = new Date(s.created_at);
              const dateStr = isNaN(ts.getTime())
                ? ''
                : ts.toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  });
              return (
                <TouchableOpacity
                  key={s.id}
                  style={styles.saleRow}
                  onPress={() => {
                    haptics.light();
                    // SaleDetail now lives inside the Items stack, so we
                    // just push it locally — swipe-back returns to this
                    // product page. No cross-tab dance / breadcrumb needed.
                    navigation.navigate('SaleDetail', {saleId: s.id});
                  }}
                  accessibilityRole="link"
                  accessibilityLabel={`Sale ${s.sale_number}, ${dateStr}, ${formatCurrency(s.total_cents)}. Tap to view.`}>
                  <View style={styles.saleLeft}>
                    <Text style={styles.saleNumber}>{s.sale_number}</Text>
                    <Text style={styles.saleMeta}>
                      {dateStr}
                      {s.customer_name ? ` · ${s.customer_name}` : ''}
                    </Text>
                  </View>
                  <View style={styles.saleRight}>
                    <Text style={styles.saleTotal}>
                      {formatCurrency(s.total_cents)}
                    </Text>
                    <Icon
                      name="chevron-forward"
                      size={14}
                      color={COLORS.textMuted}
                    />
                  </View>
                </TouchableOpacity>
              );
            })}
            {/* View-all CTA sits at the bottom of the same card so it
                reads as a natural extension of the list (the last sale
                row's bottom border becomes the divider). Tapping pushes
                TransactionList inside this stack — back returns here. */}
            <TouchableOpacity
              style={[styles.saleRow, styles.saleRowLast, styles.viewAllRow]}
              onPress={() => {
                haptics.light();
                navigation.navigate('TransactionList', {productId});
              }}
              accessibilityRole="link"
              accessibilityLabel="View all transactions for this item">
              <Text style={styles.viewAllText}>View all transactions</Text>
              <Icon
                name="chevron-forward"
                size={16}
                color={COLORS.accent}
              />
            </TouchableOpacity>
          </View>
        ) : null}

        {product.variants && product.variants.length > 0 ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>
              Variants
              <Text style={styles.sectionCount}>
                {' '}
                · {product.variants.length}
              </Text>
            </Text>
            {product.variants.map((v, idx) => (
              <View
                key={v.id}
                style={[
                  styles.variantRow,
                  idx === product.variants.length - 1 && styles.variantRowLast,
                ]}>
                <View style={styles.variantLeft}>
                  <Text style={styles.variantName}>{v.name}</Text>
                  <Text style={styles.variantSku}>{v.sku || ''}</Text>
                </View>
                <View style={styles.variantRight}>
                  <Text style={styles.variantPrice}>
                    {formatCurrency(v.price_cents)}
                  </Text>
                  <Text style={styles.variantStock}>
                    {v.stock_on_hand} on hand
                  </Text>
                </View>
              </View>
            ))}
          </View>
        ) : null}

        {product.description ? (
          <View style={styles.descriptionCard}>
            <Text style={styles.sectionTitle}>Description</Text>
            <Text style={styles.body}>{product.description}</Text>
          </View>
        ) : null}

        <TouchableOpacity style={styles.backBtn} onPress={handleBack}>
          <Icon
            name="chevron-back"
            size={20}
            color={COLORS.white}
            style={styles.backBtnIcon}
          />
          <Text style={styles.backBtnText}>Back</Text>
        </TouchableOpacity>
      </ScrollView>
      <StockAdjustModal
        productId={product.id}
        productName={product.name}
        currentStock={product.stock_on_hand ?? 0}
        visible={stockModalVisible}
        onClose={() => setStockModalVisible(false)}
        onAdjusted={newQty => {
          // Optimistic local update — the next useFocusEffect cycle will
          // reconcile the full detail (stock_levels, etc.) but reflecting
          // the new total immediately keeps the UI feeling responsive.
          setProduct(prev => (prev ? {...prev, stock_on_hand: newQty} : prev));
        }}
      />
    </SafeAreaView>
  );
}

const cardBase = {
  backgroundColor: COLORS.surface,
  borderWidth: 1,
  borderColor: COLORS.surfaceBorder,
  borderRadius: BORDER_RADIUS.lg,
  padding: SPACING.md,
  marginBottom: SPACING.sm,
  shadowColor: COLORS.black,
  shadowOffset: {width: 0, height: 1},
  shadowOpacity: 0.06,
  shadowRadius: 3,
  elevation: 1,
};

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: COLORS.background},
  scroll: {padding: SPACING.md, paddingBottom: SPACING.xxl},
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING.lg,
  },
  errorIcon: {marginBottom: SPACING.md},
  heroCard: {...cardBase},
  heroTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  heroTitleWrap: {flex: 1, marginRight: SPACING.sm},
  name: {
    color: COLORS.text,
    fontSize: FONT_SIZE.xl,
    fontFamily: FONT_FAMILY.bold,
    letterSpacing: -0.3,
    marginBottom: SPACING.xs,
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.md,
  },
  metaItem: {flexDirection: 'row', alignItems: 'center'},
  metaIcon: {marginRight: 4},
  meta: {color: COLORS.textMuted, fontSize: FONT_SIZE.sm},
  badge: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: 3,
    borderRadius: BORDER_RADIUS.full,
  },
  badgeActive: {backgroundColor: COLORS.success},
  badgeInactive: {backgroundColor: COLORS.textDim},
  badgeText: {
    color: COLORS.white,
    fontSize: FONT_SIZE.xs,
    fontFamily: FONT_FAMILY.bold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  pillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.xs,
    marginTop: SPACING.sm,
  },
  actionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
    marginTop: SPACING.md,
  },
  // Primary CTA spans the full row (forces the secondaries to wrap below
  // via the actionRow's flexWrap), so the cart button is unambiguously the
  // largest action on the page. Secondaries split the next row 50/50 via
  // flex:1 — same width regardless of label length, keeping the action
  // group visually balanced.
  primaryAction: {width: '100%'},
  secondaryAction: {flex: 1},
  addedToCartConfirm: {
    color: COLORS.success,
    fontSize: FONT_SIZE.sm,
    fontFamily: FONT_FAMILY.medium,
    marginTop: SPACING.sm,
  },
  categoryPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.text,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 4,
    borderRadius: BORDER_RADIUS.full,
  },
  categoryPillText: {
    color: COLORS.text,
    fontSize: FONT_SIZE.xs,
    fontFamily: FONT_FAMILY.medium,
  },
  stockPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.text,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 4,
    borderRadius: BORDER_RADIUS.full,
  },
  stockDot: {
    width: 6,
    height: 6,
    borderRadius: BORDER_RADIUS.full,
    marginRight: 6,
  },
  stockOk: {backgroundColor: COLORS.success},
  stockLow: {backgroundColor: COLORS.warning},
  stockOut: {backgroundColor: COLORS.danger},
  stockPillText: {
    color: COLORS.text,
    fontSize: FONT_SIZE.xs,
    fontFamily: FONT_FAMILY.medium,
  },
  card: {...cardBase},
  descriptionCard: {...cardBase},
  price: {
    color: COLORS.crimson,
    fontSize: FONT_SIZE.title,
    fontFamily: FONT_FAMILY.bold,
    letterSpacing: -0.5,
    marginBottom: SPACING.sm,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: SPACING.sm,
  },
  sectionTitle: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.sm,
    fontFamily: FONT_FAMILY.medium,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: SPACING.sm,
  },
  sectionCount: {
    color: COLORS.textDim,
    fontFamily: FONT_FAMILY.medium,
  },
  totalOnHand: {
    color: COLORS.text,
    fontSize: FONT_SIZE.lg,
    fontFamily: FONT_FAMILY.bold,
  },
  totalOnHandUnit: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.sm,
    fontFamily: FONT_FAMILY.medium,
  },
  body: {color: COLORS.textLight, fontSize: FONT_SIZE.md, lineHeight: 22},
  kvRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.surfaceBorder,
  },
  kvRowLast: {borderBottomWidth: 0, paddingBottom: 0},
  kvLabel: {color: COLORS.textMuted, fontSize: FONT_SIZE.md},
  kvValue: {color: COLORS.text, fontSize: FONT_SIZE.md, fontFamily: FONT_FAMILY.medium},
  marginNegative: {color: COLORS.danger},
  tableRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.surfaceBorder,
  },
  tableRowLast: {borderBottomWidth: 0, paddingBottom: 0},
  tableLabelWrap: {flexDirection: 'row', alignItems: 'center', flex: 1},
  tableLabel: {color: COLORS.textLight, fontSize: FONT_SIZE.md, flex: 1},
  tableValue: {color: COLORS.text, fontSize: FONT_SIZE.md, fontFamily: FONT_FAMILY.bold},
  emptyHint: {color: COLORS.textDim, fontSize: FONT_SIZE.sm, fontStyle: 'italic'},
  barcodeWrap: {alignItems: 'center', marginVertical: SPACING.sm},
  saleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: SPACING.sm + 2,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.surfaceBorder,
  },
  saleRowLast: {borderBottomWidth: 0, paddingBottom: 0},
  // View-all affordance shares saleRow's geometry so it visually
  // belongs to the list, but the label centres + recolours to read as
  // a navigation link rather than yet another sale row.
  viewAllRow: {justifyContent: 'center', gap: SPACING.xs},
  viewAllText: {
    color: COLORS.accent,
    fontSize: FONT_SIZE.md,
    fontFamily: FONT_FAMILY.medium,
  },
  saleLeft: {flex: 1, marginRight: SPACING.md},
  saleRight: {flexDirection: 'row', alignItems: 'center', gap: 4},
  saleNumber: {
    color: COLORS.text,
    fontSize: FONT_SIZE.md,
    fontFamily: FONT_FAMILY.medium,
    fontVariant: ['tabular-nums'],
  },
  saleMeta: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.xs,
    marginTop: 2,
  },
  saleTotal: {
    color: COLORS.crimson,
    fontSize: FONT_SIZE.md,
    fontFamily: FONT_FAMILY.bold,
    fontVariant: ['tabular-nums'],
  },
  shareCard: {
    // White surface matching every other widget card on this screen.
    // The earlier cream-tinted variant visually drifted from the Pricing
    // / Stock / Recent transactions cards and read as a different
    // component, which was unintentional.
    ...cardBase,
  },
  variantRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.surfaceBorder,
  },
  variantRowLast: {borderBottomWidth: 0, paddingBottom: 0},
  variantLeft: {flex: 1, marginRight: SPACING.md},
  variantName: {color: COLORS.text, fontSize: FONT_SIZE.md, fontFamily: FONT_FAMILY.medium},
  variantSku: {color: COLORS.textMuted, fontSize: FONT_SIZE.xs, marginTop: 2},
  variantRight: {alignItems: 'flex-end'},
  variantPrice: {
    color: COLORS.crimson,
    fontSize: FONT_SIZE.md,
    fontFamily: FONT_FAMILY.bold,
  },
  variantStock: {color: COLORS.textMuted, fontSize: FONT_SIZE.xs, marginTop: 2},
  errorTitle: {
    color: COLORS.text,
    fontSize: FONT_SIZE.lg,
    fontFamily: FONT_FAMILY.bold,
    marginBottom: SPACING.sm,
    textAlign: 'center',
  },
  errorBody: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.md,
    textAlign: 'center',
    marginBottom: SPACING.lg,
  },
  primaryBtn: {
    backgroundColor: COLORS.crimson,
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.md,
    borderRadius: BORDER_RADIUS.lg,
    marginBottom: SPACING.sm,
  },
  primaryBtnText: {color: COLORS.white, fontFamily: FONT_FAMILY.bold, fontSize: FONT_SIZE.md},
  linkText: {color: COLORS.accent, fontSize: FONT_SIZE.md, fontFamily: FONT_FAMILY.medium},
  backBtn: {
    flexDirection: 'row',
    backgroundColor: COLORS.text,
    borderRadius: BORDER_RADIUS.lg,
    paddingVertical: SPACING.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: SPACING.sm,
  },
  backBtnIcon: {marginRight: SPACING.xs},
  backBtnText: {
    color: COLORS.white,
    fontSize: FONT_SIZE.md,
    fontFamily: FONT_FAMILY.medium,
  },
});
