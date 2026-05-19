import React, {useState, useEffect, useCallback, useRef} from 'react';
import {
  AppState,
  View,
  Text,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {useFocusEffect, useNavigation} from '@react-navigation/native';
import type {BottomTabNavigationProp} from '@react-navigation/bottom-tabs';
import {Ionicons} from '@expo/vector-icons';
import ApiClient from '../services/ApiClient';
import type {DailySummary, Sale} from '../types/api.types';
import type {AppTabParamList} from '../types/navigation.types';
import type {DashboardSecondaryWidget} from '../types/settings.types';
import {useSettingsStore} from '../stores/settingsStore';
import {
  COLORS,
  SPACING,
  FONT_SIZE,
  BORDER_RADIUS,
  ICON_SIZE,
  SHADOW,
} from '../constants/theme';
import {useAuthStore} from '../stores/authStore';
import {useHaptics} from '../hooks/useHaptics';
import {formatCurrency} from '../utils/format';
import StatCard, {pickStatRowFontSize} from '../components/StatCard';
import EmptyState from '../components/EmptyState';
import ErrorBanner from '../components/ErrorBanner';

type Nav = BottomTabNavigationProp<AppTabParamList, 'Dashboard'>;

const greetingFor = (hour: number): string => {
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
};

const firstName = (full: string | undefined): string => {
  if (!full) return '';
  const trimmed = full.trim();
  if (!trimmed) return '';
  return trimmed.split(/\s+/)[0];
};

// Walk recent sales newest-first, keep the first occurrence of each
// distinct customer_name (trimmed, case-insensitive). Walk-in sales
// (customer_name: null/empty) are skipped. Returns up to `limit` entries.
function pickRecentUniqueCustomers(
  sales: Sale[],
  limit: number,
): Array<{name: string; lastSaleAt: string; saleId: number}> {
  const seen = new Set<string>();
  const out: Array<{name: string; lastSaleAt: string; saleId: number}> = [];
  for (const s of sales) {
    const raw = (s.customer_name ?? '').trim();
    if (!raw) continue;
    const key = raw.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({name: raw, lastSaleAt: s.created_at, saleId: s.id});
    if (out.length >= limit) break;
  }
  return out;
}

const DashboardScreen: React.FC = () => {
  const navigation = useNavigation<Nav>();
  const haptics = useHaptics();
  const userName = useAuthStore(s => s.user?.name);
  const defaultWidget = useSettingsStore(
    s => s.settings.dashboardSecondaryWidget ?? 'top_products',
  );
  const [activeWidget, setActiveWidget] =
    useState<DashboardSecondaryWidget>(defaultWidget);
  const [summary, setSummary] = useState<DailySummary | null>(null);
  const [recentCustomers, setRecentCustomers] = useState<
    Array<{name: string; lastSaleAt: string; saleId: number}>
  >([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // Honour Settings changes when the user re-enters the dashboard. We don't
  // overwrite an in-flight in-place toggle — the user expects the toggle
  // to stick for the rest of the session.
  const lastDefaultRef = useRef(defaultWidget);
  useEffect(() => {
    if (lastDefaultRef.current !== defaultWidget) {
      lastDefaultRef.current = defaultWidget;
      setActiveWidget(defaultWidget);
    }
  }, [defaultWidget]);

  const fetchSummary = useCallback(async (isRefresh = false) => {
    if (isRefresh) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }
    setError(null);

    try {
      // Always pull daily summary (drives the hero card + stat strip).
      // Pull recent transactions in parallel so the recent-customers widget
      // is ready the moment the user toggles to it — avoids a second
      // loading state on switch. 50 sales is enough to find 5 unique
      // customers in any realistic dataset.
      const [data, transactionsPage] = await Promise.all([
        ApiClient.getDailySummary(),
        ApiClient.getTransactions({page: 1, per_page: 50}).catch(() => null),
      ]);
      setSummary(data);
      if (transactionsPage) {
        setRecentCustomers(pickRecentUniqueCustomers(transactionsPage.data, 5));
      }
      setLastUpdated(new Date());
    } catch (e) {
      const message =
        e instanceof Error ? e.message : 'Failed to load dashboard';
      haptics.error();
      setError(message);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [haptics]);

  useEffect(() => {
    fetchSummary();
  }, [fetchSummary]);

  // Refetch when the Dashboard tab regains focus — covers the case where the
  // user just completed a sale on QuickSale/Checkout and tabs back here. The
  // first focus right after mount overlaps with the initial fetch above; the
  // hasMounted guard skips that to avoid a duplicate request.
  const hasMountedRef = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (!hasMountedRef.current) {
        hasMountedRef.current = true;
        return;
      }
      fetchSummary();
    }, [fetchSummary]),
  );

  // Refetch when the app foregrounds from background — a swipe-back-in after
  // closing the app (or the OS suspending it) won't re-mount the screen but
  // the dashboard's totals could be stale by then.
  useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') fetchSummary();
    });
    return () => sub.remove();
  }, [fetchSummary]);

  const todayString = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
  const greeting = greetingFor(new Date().getHours());
  const name = firstName(userName);

  // Dashboard is a direct Tab.Screen, so useNavigation() already returns the
  // tab navigator — calling `.navigate(siblingTabName)` jumps tabs directly.
  // The earlier getParent() chase walked up to RootNavigator (which only
  // knows 'Auth' / 'App') and silently no-op'd, so the tiles did nothing.
  const goToTab = useCallback(
    (tab: keyof AppTabParamList) => {
      haptics.light();
      navigation.navigate(tab);
    },
    [haptics, navigation],
  );

  if (isLoading && !summary) {
    return (
      <SafeAreaView style={styles.container} edges={['left', 'right']}>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={COLORS.accent} />
          <Text style={styles.loadingText}>Loading dashboard...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error && !summary) {
    return (
      <SafeAreaView style={styles.container} edges={['left', 'right']}>
        <View style={styles.centered}>
          <View style={styles.fullErrorWrap}>
            <ErrorBanner message={error} onRetry={() => fetchSummary()} />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  const salesCount = summary?.sales_count ?? 0;
  const itemsSold = summary?.items_sold ?? 0;
  const avgSale = summary?.average_sale_cents ?? 0;
  const revenue = summary?.revenue_cents ?? 0;
  const topProducts = summary?.top_products ?? [];

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right']}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={() => fetchSummary(true)}
            tintColor={COLORS.accent}
          />
        }>
        <View style={styles.header}>
          <Text style={styles.greeting}>
            {greeting}
            {name ? ', ' : ''}
            {name ? <Text style={styles.greetingName}>{name}</Text> : null}
          </Text>
          <Text style={styles.headerDate}>{todayString}</Text>
        </View>

        {error ? (
          <View style={styles.bannerWrap}>
            <ErrorBanner
              message={error}
              onRetry={() => fetchSummary()}
              onDismiss={() => setError(null)}
            />
          </View>
        ) : null}

        <Text style={styles.sectionLabel}>Today</Text>

        <View style={styles.heroCard}>
          <Text style={styles.heroLabel}>Revenue</Text>
          <Text style={styles.heroValue}>{formatCurrency(revenue)}</Text>
          <View style={styles.heroFootnote}>
            <Ionicons
              name="trending-up"
              size={ICON_SIZE.action - 4}
              color={COLORS.textMuted}
              style={styles.heroFootnoteIcon}
            />
            <Text style={styles.heroFootnoteText}>
              {salesCount === 0
                ? 'No transactions yet'
                : `${salesCount} ${salesCount === 1 ? 'sale' : 'sales'} so far`}
            </Text>
          </View>
        </View>

        {(() => {
          const salesStr = String(salesCount);
          const itemsStr = String(itemsSold);
          const avgStr = formatCurrency(avgSale);
          const fs = pickStatRowFontSize([salesStr, itemsStr, avgStr]);
          return (
            <View style={styles.statsGrid}>
              <View style={styles.statCell}>
                <StatCard label="Sales" value={salesStr} valueFontSize={fs} />
              </View>
              <View style={styles.statCell}>
                <StatCard label="Items Sold" value={itemsStr} valueFontSize={fs} />
              </View>
              <View style={styles.statCell}>
                <StatCard label="Avg Sale" value={avgStr} valueFontSize={fs} />
              </View>
            </View>
          );
        })()}

        <Text style={styles.sectionLabel}>Quick Actions</Text>
        <View style={styles.quickActions}>
          <QuickAction
            icon="cart-outline"
            label="New Sale"
            onPress={() => goToTab('QuickSale')}
          />
          <QuickAction
            icon="cube-outline"
            label="Items"
            onPress={() => goToTab('Items')}
          />
          <QuickAction
            icon="people-outline"
            label="Customers"
            onPress={() => goToTab('Customers')}
          />
          <QuickAction
            icon="receipt-outline"
            label="Sales"
            onPress={() => goToTab('Transactions')}
          />
        </View>

        <View style={styles.widgetHeader}>
          <Text style={styles.widgetTitle}>
            {activeWidget === 'top_products' ? 'Top Products' : 'Recent Customers'}
          </Text>
          <TouchableOpacity
            style={styles.widgetToggle}
            accessibilityRole="button"
            accessibilityLabel={
              activeWidget === 'top_products'
                ? 'Switch to recent customers'
                : 'Switch to top products'
            }
            onPress={() => {
              haptics.selection();
              setActiveWidget(prev =>
                prev === 'top_products' ? 'recent_customers' : 'top_products',
              );
            }}>
            <Ionicons
              name={
                activeWidget === 'top_products' ? 'people-outline' : 'bag-handle-outline'
              }
              size={ICON_SIZE.action - 2}
              color={COLORS.textMuted}
            />
            <Text style={styles.widgetToggleText}>
              {activeWidget === 'top_products' ? 'Customers' : 'Products'}
            </Text>
          </TouchableOpacity>
        </View>

        {activeWidget === 'top_products' ? (
          topProducts.length > 0 ? (
            <View style={styles.topProductsCard}>
              {topProducts.slice(0, 5).map((product, index) => (
                <View
                  key={product.id}
                  style={[
                    styles.productRow,
                    index === Math.min(topProducts.length, 5) - 1 &&
                      styles.productRowLast,
                  ]}>
                  <View style={styles.productRank}>
                    <Text style={styles.productRankText}>{index + 1}</Text>
                  </View>
                  <View style={styles.productInfo}>
                    <Text style={styles.productName} numberOfLines={1}>
                      {product.name}
                    </Text>
                    <Text style={styles.productMeta}>
                      {product.quantity} sold
                    </Text>
                  </View>
                  <Text style={styles.productRevenue}>
                    {formatCurrency(product.revenue_cents)}
                  </Text>
                </View>
              ))}
            </View>
          ) : (
            <EmptyState
              title="No sales yet today"
              description="Your first sale will appear here."
              icon="bag-handle-outline"
            />
          )
        ) : recentCustomers.length > 0 ? (
          <View style={styles.topProductsCard}>
            {recentCustomers.map((customer, index) => (
              <TouchableOpacity
                key={customer.saleId}
                style={[
                  styles.productRow,
                  index === recentCustomers.length - 1 && styles.productRowLast,
                ]}
                accessibilityRole="button"
                accessibilityLabel={`${customer.name}, view sale`}
                onPress={() => {
                  haptics.light();
                  navigation.navigate('Transactions', {
                    screen: 'SaleDetail',
                    params: {saleId: customer.saleId},
                  } as never);
                }}>
                <View style={styles.productRank}>
                  <Ionicons
                    name="person-outline"
                    size={ICON_SIZE.action - 4}
                    color={COLORS.textMuted}
                  />
                </View>
                <View style={styles.productInfo}>
                  <Text style={styles.productName} numberOfLines={1}>
                    {customer.name}
                  </Text>
                  <Text style={styles.productMeta}>
                    {new Date(customer.lastSaleAt).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                    })}
                  </Text>
                </View>
                <Ionicons
                  name="chevron-forward"
                  size={ICON_SIZE.action - 4}
                  color={COLORS.textMuted}
                />
              </TouchableOpacity>
            ))}
          </View>
        ) : (
          <EmptyState
            title="No recent customers"
            description="Named customers from recent sales will appear here."
            icon="people-outline"
          />
        )}

        {lastUpdated ? (
          <Text style={styles.lastUpdated}>
            Last updated{' '}
            {lastUpdated.toLocaleTimeString('en-US', {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </Text>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
};

const QuickAction: React.FC<{
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
}> = ({icon, label, onPress}) => (
  <TouchableOpacity
    style={styles.quickActionTile}
    activeOpacity={0.7}
    onPress={onPress}
    accessibilityRole="button"
    accessibilityLabel={label}>
    <View style={styles.quickActionIconWrap}>
      <Ionicons name={icon} size={ICON_SIZE.hero} color={COLORS.crimson} />
    </View>
    <Text style={styles.quickActionLabel}>{label}</Text>
  </TouchableOpacity>
);

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACING.lg,
  },
  loadingText: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.md,
    marginTop: SPACING.md,
  },
  fullErrorWrap: {
    alignSelf: 'stretch',
    paddingHorizontal: SPACING.md,
  },
  bannerWrap: {
    marginBottom: SPACING.md,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.md,
    paddingBottom: SPACING.xxl,
  },
  header: {
    marginBottom: SPACING.lg,
  },
  greeting: {
    fontSize: FONT_SIZE.xxl,
    fontWeight: '700',
    color: COLORS.text,
    letterSpacing: -0.4,
  },
  greetingName: {
    color: COLORS.crimson,
  },
  headerDate: {
    fontSize: FONT_SIZE.sm,
    color: COLORS.textMuted,
    marginTop: SPACING.xs,
  },
  sectionLabel: {
    fontSize: FONT_SIZE.sm,
    fontWeight: '600',
    color: COLORS.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: SPACING.sm,
    marginTop: SPACING.xs,
  },
  widgetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SPACING.sm,
    marginTop: SPACING.xs,
  },
  widgetTitle: {
    fontSize: FONT_SIZE.sm,
    fontWeight: '600',
    color: COLORS.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  widgetToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: BORDER_RADIUS.md,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.surfaceBorder,
  },
  widgetToggleText: {
    color: COLORS.textMuted,
    fontWeight: '600',
    fontSize: FONT_SIZE.sm,
  },
  heroCard: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.surfaceBorder,
    padding: SPACING.lg,
    marginBottom: SPACING.md,
    ...SHADOW.card,
  },
  heroLabel: {
    fontSize: FONT_SIZE.sm,
    color: COLORS.textMuted,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: SPACING.xs,
  },
  heroValue: {
    fontSize: FONT_SIZE.title,
    color: COLORS.crimson,
    fontWeight: '700',
    letterSpacing: -0.5,
    fontVariant: ['tabular-nums'],
  },
  heroFootnote: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: SPACING.sm,
  },
  heroFootnoteIcon: {marginRight: SPACING.xs},
  heroFootnoteText: {
    fontSize: FONT_SIZE.sm,
    color: COLORS.textMuted,
  },
  statsGrid: {
    flexDirection: 'row',
    gap: SPACING.sm,
    marginBottom: SPACING.lg,
  },
  // Cell wraps StatCard so flex:1 sizing lives outside the shared component.
  statCell: {flex: 1},
  quickActions: {
    flexDirection: 'row',
    gap: SPACING.sm,
    marginBottom: SPACING.lg,
  },
  quickActionTile: {
    flex: 1,
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.surfaceBorder,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.xs,
    alignItems: 'center',
    ...SHADOW.card,
  },
  quickActionIconWrap: {
    width: 40,
    height: 40,
    borderRadius: BORDER_RADIUS.full,
    backgroundColor: COLORS.cream,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.xs,
  },
  quickActionLabel: {
    fontSize: FONT_SIZE.xs,
    color: COLORS.text,
    fontWeight: '600',
    textAlign: 'center',
  },
  topProductsCard: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.surfaceBorder,
    paddingHorizontal: SPACING.md,
    ...SHADOW.card,
  },
  productRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.surfaceBorder,
  },
  productRowLast: {
    borderBottomWidth: 0,
  },
  productRank: {
    width: 28,
    height: 28,
    borderRadius: BORDER_RADIUS.full,
    backgroundColor: COLORS.cream,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: SPACING.sm,
  },
  productRankText: {
    color: COLORS.crimson,
    fontSize: FONT_SIZE.sm,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  productInfo: {
    flex: 1,
    marginRight: SPACING.sm,
  },
  productName: {
    color: COLORS.text,
    fontSize: FONT_SIZE.md,
    fontWeight: '600',
  },
  productMeta: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.xs,
    marginTop: 2,
    fontVariant: ['tabular-nums'],
  },
  productRevenue: {
    color: COLORS.crimson,
    fontSize: FONT_SIZE.md,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  lastUpdated: {
    color: COLORS.textDim,
    fontSize: FONT_SIZE.xs,
    textAlign: 'center',
    marginTop: SPACING.lg,
    fontVariant: ['tabular-nums'],
  },
});

export default DashboardScreen;
