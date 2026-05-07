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
import type {DailySummary} from '../types/api.types';
import type {AppTabParamList} from '../types/navigation.types';
import {COLORS, SPACING, FONT_SIZE, BORDER_RADIUS} from '../constants/theme';
import {useAuthStore} from '../stores/authStore';
import {useHaptics} from '../hooks/useHaptics';
import {formatCurrency} from '../utils/format';

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

const DashboardScreen: React.FC = () => {
  const navigation = useNavigation<Nav>();
  const haptics = useHaptics();
  const userName = useAuthStore(s => s.user?.name);
  const [summary, setSummary] = useState<DailySummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchSummary = useCallback(async (isRefresh = false) => {
    if (isRefresh) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }
    setError(null);

    try {
      const data = await ApiClient.getDailySummary();
      setSummary(data);
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
      <SafeAreaView style={styles.container} edges={['left', 'right', 'bottom']}>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={COLORS.accent} />
          <Text style={styles.loadingText}>Loading dashboard...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error && !summary) {
    return (
      <SafeAreaView style={styles.container} edges={['left', 'right', 'bottom']}>
        <View style={styles.centered}>
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity
              style={styles.retryButton}
              onPress={() => fetchSummary()}>
              <Text style={styles.retryText}>Retry</Text>
            </TouchableOpacity>
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
    <SafeAreaView style={styles.container} edges={['left', 'right', 'bottom']}>
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
          <View style={styles.inlineError}>
            <Text style={styles.inlineErrorText}>{error}</Text>
          </View>
        ) : null}

        <Text style={styles.sectionLabel}>Today</Text>

        <View style={styles.heroCard}>
          <Text style={styles.heroLabel}>Revenue</Text>
          <Text style={styles.heroValue}>{formatCurrency(revenue)}</Text>
          <View style={styles.heroFootnote}>
            <Ionicons
              name="trending-up"
              size={14}
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

        <View style={styles.statsGrid}>
          <StatCard label="Transactions" value={String(salesCount)} />
          <StatCard label="Items Sold" value={String(itemsSold)} />
          <StatCard label="Avg Sale" value={formatCurrency(avgSale)} />
        </View>

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

        <Text style={styles.sectionLabel}>Top Products</Text>
        {topProducts.length > 0 ? (
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
          <View style={styles.emptyCard}>
            <Ionicons
              name="bag-handle-outline"
              size={28}
              color={COLORS.textDim}
            />
            <Text style={styles.emptyTitle}>No sales yet today</Text>
            <Text style={styles.emptySubtext}>
              Your first sale will appear here.
            </Text>
          </View>
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

const StatCard: React.FC<{label: string; value: string}> = ({label, value}) => (
  <View style={styles.statCard}>
    <Text style={styles.statValue}>{value}</Text>
    <Text style={styles.statLabel}>{label}</Text>
  </View>
);

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
      <Ionicons name={icon} size={22} color={COLORS.crimson} />
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
  errorCard: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.surfaceBorder,
    padding: SPACING.lg,
    alignItems: 'center',
  },
  errorText: {
    color: COLORS.danger,
    fontSize: FONT_SIZE.md,
    textAlign: 'center',
    marginBottom: SPACING.md,
  },
  retryButton: {
    backgroundColor: COLORS.accent,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
    borderRadius: BORDER_RADIUS.lg,
  },
  retryText: {
    color: COLORS.white,
    fontSize: FONT_SIZE.md,
    fontWeight: '700',
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
  inlineError: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.danger,
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.sm,
    marginBottom: SPACING.md,
  },
  inlineErrorText: {
    color: COLORS.danger,
    fontSize: FONT_SIZE.sm,
    textAlign: 'center',
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
  heroCard: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.surfaceBorder,
    padding: SPACING.lg,
    marginBottom: SPACING.md,
    shadowColor: COLORS.black,
    shadowOffset: {width: 0, height: 1},
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 1,
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
  statCard: {
    flex: 1,
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.surfaceBorder,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.sm,
    alignItems: 'center',
    shadowColor: COLORS.black,
    shadowOffset: {width: 0, height: 1},
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 1,
  },
  statValue: {
    fontSize: FONT_SIZE.xl,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: SPACING.xs,
    letterSpacing: -0.3,
  },
  statLabel: {
    fontSize: FONT_SIZE.xs,
    color: COLORS.textMuted,
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
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
    shadowColor: COLORS.black,
    shadowOffset: {width: 0, height: 1},
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 1,
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
    shadowColor: COLORS.black,
    shadowOffset: {width: 0, height: 1},
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 1,
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
  },
  productRevenue: {
    color: COLORS.crimson,
    fontSize: FONT_SIZE.md,
    fontWeight: '700',
  },
  emptyCard: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.surfaceBorder,
    padding: SPACING.lg,
    alignItems: 'center',
  },
  emptyTitle: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.lg,
    fontWeight: '600',
    marginTop: SPACING.sm,
  },
  emptySubtext: {
    color: COLORS.textDim,
    fontSize: FONT_SIZE.sm,
    marginTop: SPACING.xs,
    textAlign: 'center',
  },
  lastUpdated: {
    color: COLORS.textDim,
    fontSize: FONT_SIZE.xs,
    textAlign: 'center',
    marginTop: SPACING.lg,
  },
});

export default DashboardScreen;
