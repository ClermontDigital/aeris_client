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
import {useNavigation, useRoute} from '@react-navigation/native';
import type {RouteProp} from '@react-navigation/native';
import {Ionicons} from '@expo/vector-icons';
import {COLORS, SPACING, FONT_SIZE, BORDER_RADIUS} from '../constants/theme';
import ApiClient from '../services/ApiClient';
import {useHaptics} from '../hooks/useHaptics';
import type {ProductDetail} from '../types/api.types';
import type {ItemsStackParamList} from '../types/navigation.types';
import {formatCurrency} from '../utils/format';

type ProductDetailRouteProp = RouteProp<ItemsStackParamList, 'ProductDetail'>;

export default function ProductDetailScreen() {
  const navigation = useNavigation();
  const route = useRoute<ProductDetailRouteProp>();
  const haptics = useHaptics();
  const {productId} = route.params;

  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isUnavailable, setIsUnavailable] = useState(false);
  const [notFound, setNotFound] = useState(false);

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
    load();
  }, [load]);

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container} edges={['left', 'right', 'bottom']}>
        <View style={styles.center}>
          <ActivityIndicator color={COLORS.accent} size="large" />
        </View>
      </SafeAreaView>
    );
  }

  if (isUnavailable) {
    return (
      <SafeAreaView style={styles.container} edges={['left', 'right', 'bottom']}>
        <View style={styles.center}>
          <Ionicons
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
      <SafeAreaView style={styles.container} edges={['left', 'right', 'bottom']}>
        <View style={styles.center}>
          <Ionicons
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
  const stockTone =
    totalOnHand <= 0
      ? styles.stockOut
      : totalOnHand < 5
      ? styles.stockLow
      : styles.stockOk;
  const stockLabel =
    totalOnHand <= 0 ? 'Out of stock' : totalOnHand < 5 ? 'Low stock' : 'In stock';

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
    <SafeAreaView style={styles.container} edges={['left', 'right', 'bottom']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.heroCard}>
          <View style={styles.heroTopRow}>
            <View style={styles.heroTitleWrap}>
              <Text style={styles.name}>{product.name}</Text>
              <View style={styles.metaRow}>
                <View style={styles.metaItem}>
                  <Ionicons
                    name="pricetag-outline"
                    size={12}
                    color={COLORS.textMuted}
                    style={styles.metaIcon}
                  />
                  <Text style={styles.meta}>{product.sku || '—'}</Text>
                </View>
                {product.barcode ? (
                  <View style={styles.metaItem}>
                    <Ionicons
                      name="barcode-outline"
                      size={12}
                      color={COLORS.textMuted}
                      style={styles.metaIcon}
                    />
                    <Text style={styles.meta}>{product.barcode}</Text>
                  </View>
                ) : null}
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
                <Ionicons
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
            <View style={styles.stockPill}>
              <View style={[styles.stockDot, stockTone]} />
              <Text style={styles.stockPillText}>{stockLabel}</Text>
            </View>
          </View>
        </View>

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
                  <Ionicons
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
                  <Text style={styles.variantSku}>{v.sku || '—'}</Text>
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

        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => {
            haptics.light();
            navigation.goBack();
          }}>
          <Ionicons
            name="chevron-back"
            size={20}
            color={COLORS.white}
            style={styles.backBtnIcon}
          />
          <Text style={styles.backBtnText}>Back</Text>
        </TouchableOpacity>
      </ScrollView>
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
    fontWeight: '700',
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
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  pillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.xs,
    marginTop: SPACING.sm,
  },
  categoryPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.cream,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 4,
    borderRadius: BORDER_RADIUS.full,
  },
  categoryPillText: {
    color: COLORS.text,
    fontSize: FONT_SIZE.xs,
    fontWeight: '600',
  },
  stockPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.cream,
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
    fontWeight: '600',
  },
  card: {...cardBase},
  descriptionCard: {
    ...cardBase,
    backgroundColor: COLORS.cream,
  },
  price: {
    color: COLORS.crimson,
    fontSize: FONT_SIZE.title,
    fontWeight: '700',
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
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: SPACING.sm,
  },
  sectionCount: {
    color: COLORS.textDim,
    fontWeight: '500',
  },
  totalOnHand: {
    color: COLORS.text,
    fontSize: FONT_SIZE.lg,
    fontWeight: '700',
  },
  totalOnHandUnit: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.sm,
    fontWeight: '500',
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
  kvValue: {color: COLORS.text, fontSize: FONT_SIZE.md, fontWeight: '600'},
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
  tableValue: {color: COLORS.text, fontSize: FONT_SIZE.md, fontWeight: '700'},
  emptyHint: {color: COLORS.textDim, fontSize: FONT_SIZE.sm, fontStyle: 'italic'},
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
  variantName: {color: COLORS.text, fontSize: FONT_SIZE.md, fontWeight: '600'},
  variantSku: {color: COLORS.textMuted, fontSize: FONT_SIZE.xs, marginTop: 2},
  variantRight: {alignItems: 'flex-end'},
  variantPrice: {
    color: COLORS.crimson,
    fontSize: FONT_SIZE.md,
    fontWeight: '700',
  },
  variantStock: {color: COLORS.textMuted, fontSize: FONT_SIZE.xs, marginTop: 2},
  errorTitle: {
    color: COLORS.text,
    fontSize: FONT_SIZE.lg,
    fontWeight: '700',
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
  primaryBtnText: {color: COLORS.white, fontWeight: '700', fontSize: FONT_SIZE.md},
  linkText: {color: COLORS.accent, fontSize: FONT_SIZE.md, fontWeight: '600'},
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
    fontWeight: '600',
  },
});
