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
import {
  COLORS,
  SPACING,
  FONT_SIZE,
  FONT_FAMILY,
  BORDER_RADIUS,
  ICON_SIZE,
  LETTER_SPACING,
  SHADOW,
} from '../constants/theme';
import {useAuthStore} from '../stores/authStore';
import {useHaptics} from '../hooks/useHaptics';
import {formatCurrency} from '../utils/format';
import StatCard, {pickStatRowFontSize} from '../components/StatCard';
import EmptyState from '../components/EmptyState';
import ErrorBanner from '../components/ErrorBanner';
import MotionCard from '../components/MotionCard';
import PillButton from '../components/PillButton';

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
  const [summary, setSummary] = useState<DailySummary | null>(null);
  const [recentCustomers, setRecentCustomers] = useState<
    Array<{name: string; lastSaleAt: string; saleId: number}>
  >([]);
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
      // Daily summary drives the hero card + stat strip. Recent
      // transactions in parallel feeds the Recent Customers list below
      // — 50 sales is enough to find 5 unique named customers in any
      // realistic dataset.
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
          <Text
            style={styles.greeting}
            numberOfLines={2}
            adjustsFontSizeToFit
            minimumFontScale={0.7}>
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

        {/* When today has no sales yet, the hero/stat strip would all read
            $0.00 / 0, which reads as "the app is broken" rather than "you
            haven't sold anything yet". Swap in a friendlier quiet-day card
            with a clear CTA to start a sale. Recent Customers below still
            renders normally — that history is unrelated to today's pace. */}
        {salesCount === 0 ? (
          <MotionCard style={styles.quietDayCard} delay={0}>
            <View style={styles.quietDayIcon}>
              <Ionicons
                name="cafe-outline"
                size={32}
                color={COLORS.crimson}
              />
            </View>
            <Text style={styles.quietDayTitle}>Quiet so far</Text>
            <Text style={styles.quietDayBody}>
              No sales posted today yet. Start a sale and your live totals
              will show up here.
            </Text>
            <PillButton
              variant="solid"
              label="Start a Sale"
              icon="cart-outline"
              accessibilityLabel="Start a new sale"
              onPress={() => navigation.navigate('QuickSale')}
            />
          </MotionCard>
        ) : (
          <>
            <MotionCard style={styles.heroCard} delay={0}>
              <Text style={styles.heroLabel}>Revenue</Text>
              {/* Revenue at displayXl Poppins-Bold is the largest numeric on
                  the screen — auto-shrink so $1,234,567+ doesn't overflow
                  the card on iPhone SE. */}
              <Text
                style={styles.heroValue}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.5}
                allowFontScaling={false}>
                {formatCurrency(revenue)}
              </Text>
              <View style={styles.heroFootnote}>
                <Ionicons
                  name="trending-up"
                  size={ICON_SIZE.action - 4}
                  color={COLORS.textMuted}
                  style={styles.heroFootnoteIcon}
                />
                <Text style={styles.heroFootnoteText}>
                  {`${salesCount} ${salesCount === 1 ? 'sale' : 'sales'} so far`}
                </Text>
              </View>
            </MotionCard>

            {(() => {
              const salesStr = String(salesCount);
              const itemsStr = String(itemsSold);
              const avgStr = formatCurrency(avgSale);
              const fs = pickStatRowFontSize([salesStr, itemsStr, avgStr]);
              return (
                <MotionCard style={styles.statsGrid} delay={80}>
                  <View style={styles.statCell}>
                    <StatCard label="Sales" value={salesStr} valueFontSize={fs} />
                  </View>
                  <View style={styles.statCell}>
                    <StatCard label="Items Sold" value={itemsStr} valueFontSize={fs} />
                  </View>
                  <View style={styles.statCell}>
                    <StatCard label="Avg Sale" value={avgStr} valueFontSize={fs} />
                  </View>
                </MotionCard>
              );
            })()}
          </>
        )}

        <Text style={styles.sectionLabel}>Recent Customers</Text>
        {recentCustomers.length > 0 ? (
          <MotionCard style={styles.topProductsCard} delay={160}>
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
          </MotionCard>
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
    fontSize: FONT_SIZE.displayLg,
    fontFamily: FONT_FAMILY.medium,
    color: COLORS.text,
    letterSpacing: LETTER_SPACING.tightLg,
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
    fontFamily: FONT_FAMILY.medium,
    color: COLORS.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: SPACING.sm,
    marginTop: SPACING.xs,
  },
  heroCard: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.xxl,
    borderWidth: 1,
    borderColor: COLORS.surfaceBorder,
    padding: SPACING.lg,
    marginBottom: SPACING.md,
    ...SHADOW.card,
  },
  quietDayCard: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.xxl,
    borderWidth: 1,
    borderColor: COLORS.surfaceBorder,
    padding: SPACING.lg,
    marginBottom: SPACING.lg,
    alignItems: 'center',
    ...SHADOW.card,
  },
  quietDayIcon: {
    width: 56,
    height: 56,
    borderRadius: BORDER_RADIUS.full,
    backgroundColor: COLORS.cream,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.md,
  },
  quietDayTitle: {
    fontSize: FONT_SIZE.xl,
    fontFamily: FONT_FAMILY.bold,
    color: COLORS.text,
    marginBottom: SPACING.xs,
  },
  quietDayBody: {
    fontSize: FONT_SIZE.md,
    color: COLORS.textMuted,
    textAlign: 'center',
    marginBottom: SPACING.lg,
    paddingHorizontal: SPACING.sm,
    lineHeight: 20,
  },
  heroLabel: {
    fontSize: FONT_SIZE.sm,
    color: COLORS.textMuted,
    fontFamily: FONT_FAMILY.medium,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: SPACING.xs,
  },
  heroValue: {
    fontSize: FONT_SIZE.displayXl,
    color: COLORS.crimson,
    fontFamily: FONT_FAMILY.bold,
    letterSpacing: LETTER_SPACING.tightXl,
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
  topProductsCard: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.xxl,
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
    fontFamily: FONT_FAMILY.bold,
    fontVariant: ['tabular-nums'],
  },
  productInfo: {
    flex: 1,
    marginRight: SPACING.sm,
  },
  productName: {
    color: COLORS.text,
    fontSize: FONT_SIZE.md,
    fontFamily: FONT_FAMILY.medium,
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
    fontFamily: FONT_FAMILY.bold,
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
