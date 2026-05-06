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
          <Text style={styles.errorTitle}>Detail view is not available yet</Text>
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

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right', 'bottom']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.card}>
          <Text style={styles.name}>{product.name}</Text>
          <View style={styles.metaRow}>
            <Text style={styles.meta}>
              {product.sku || '—'}
              {product.category_name ? ` · ${product.category_name}` : ''}
            </Text>
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
          <Text style={styles.price}>{formatCurrency(product.price_cents)}</Text>
          {product.cost_cents != null ? (
            <Text style={styles.cost}>
              Cost: {formatCurrency(product.cost_cents)}
            </Text>
          ) : null}
        </View>

        {product.description ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Description</Text>
            <Text style={styles.body}>{product.description}</Text>
          </View>
        ) : null}

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Stock</Text>
          {stockLevels.length > 0 ? (
            stockLevels.map(level => (
              <View key={level.location_id} style={styles.tableRow}>
                <Text style={styles.tableLabel} numberOfLines={1}>
                  {level.location_name}
                </Text>
                <Text style={styles.tableValue}>
                  {level.on_hand} on hand
                </Text>
              </View>
            ))
          ) : (
            <View style={styles.tableRow}>
              <Text style={styles.tableLabel}>Total</Text>
              <Text style={styles.tableValue}>
                {product.stock_on_hand} on hand
              </Text>
            </View>
          )}
        </View>

        {product.variants && product.variants.length > 0 ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Variants</Text>
            {product.variants.map(v => (
              <View key={v.id} style={styles.variantRow}>
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

        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => {
            haptics.light();
            navigation.goBack();
          }}>
          <Ionicons
            name="chevron-back"
            size={20}
            color={COLORS.text}
            style={styles.backBtnIcon}
          />
          <Text style={styles.backBtnText}>Back</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: COLORS.background},
  scroll: {padding: SPACING.md, paddingBottom: SPACING.xxl},
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING.lg,
  },
  card: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.surfaceBorder,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.sm,
  },
  name: {
    color: COLORS.text,
    fontSize: FONT_SIZE.xl,
    fontWeight: '700',
    marginBottom: SPACING.xs,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.sm,
  },
  meta: {color: COLORS.textMuted, fontSize: FONT_SIZE.sm, flex: 1},
  badge: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: 2,
    borderRadius: BORDER_RADIUS.full,
  },
  badgeActive: {backgroundColor: COLORS.success},
  badgeInactive: {backgroundColor: COLORS.textDim},
  badgeText: {
    color: COLORS.white,
    fontSize: FONT_SIZE.xs,
    fontWeight: '600',
  },
  price: {
    color: COLORS.crimson,
    fontSize: FONT_SIZE.xxl,
    fontWeight: '700',
  },
  cost: {color: COLORS.textMuted, fontSize: FONT_SIZE.sm, marginTop: SPACING.xs},
  sectionTitle: {
    color: COLORS.text,
    fontSize: FONT_SIZE.md,
    fontWeight: '700',
    marginBottom: SPACING.sm,
  },
  body: {color: COLORS.textLight, fontSize: FONT_SIZE.md, lineHeight: 20},
  tableRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: SPACING.xs,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.surfaceBorder,
  },
  tableLabel: {color: COLORS.textLight, fontSize: FONT_SIZE.md, flex: 1},
  tableValue: {color: COLORS.text, fontSize: FONT_SIZE.md, fontWeight: '600'},
  variantRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.surfaceBorder,
  },
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
  linkText: {color: COLORS.accent, fontSize: FONT_SIZE.md},
  backBtn: {
    flexDirection: 'row',
    borderWidth: 1.5,
    borderColor: COLORS.text,
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    paddingVertical: SPACING.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: SPACING.sm,
  },
  backBtnIcon: {marginRight: SPACING.xs},
  backBtnText: {
    color: COLORS.text,
    fontSize: FONT_SIZE.md,
    fontWeight: '600',
  },
});
