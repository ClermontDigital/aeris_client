import React, {useState, useEffect, useCallback, useRef} from 'react';
import {
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
import Icon from '../components/Icon';
import ApiClient from '../services/ApiClient';
import {useHeaderBackStore} from '../stores/headerBackStore';
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
import {useCartStore} from '../stores/cartStore';
import {useSettingsStore} from '../stores/settingsStore';
import {useHaptics} from '../hooks/useHaptics';
import {useResponsiveLayout} from '../hooks/useResponsiveLayout';
import {formatCurrency} from '../utils/format';
import StatCard, {pickStatRowFontSize} from '../components/StatCard';
import EmptyState from '../components/EmptyState';
import ErrorBanner from '../components/ErrorBanner';
import MotionCard from '../components/MotionCard';
import PillButton from '../components/PillButton';
import EyebrowLabel from '../components/EyebrowLabel';

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
// customer_id is required so the recent-customers card on the dashboard
// can deep-link to CustomerDetail — sales without one (legacy walk-ins
// that somehow have a name but no id) are also skipped.
function pickRecentUniqueCustomers(
  sales: Sale[],
  limit: number,
): Array<{
  name: string;
  lastSaleAt: string;
  saleId: number;
  customerId: number;
}> {
  const seen = new Set<string>();
  const out: Array<{
    name: string;
    lastSaleAt: string;
    saleId: number;
    customerId: number;
  }> = [];
  for (const s of sales) {
    const raw = (s.customer_name ?? '').trim();
    if (!raw) continue;
    if (s.customer_id == null) continue;
    const key = raw.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      name: raw,
      lastSaleAt: s.created_at,
      saleId: s.id,
      customerId: s.customer_id,
    });
    if (out.length >= limit) break;
  }
  return out;
}

const DashboardScreen: React.FC = () => {
  const navigation = useNavigation<Nav>();
  const haptics = useHaptics();
  const {isTablet} = useResponsiveLayout();
  // Constrain the dashboard column to 720pt on iPad so the hero card,
  // stats grid and recent-customers card don't read as a giant banner.
  // The displayXl revenue number stays the same point size — the narrower
  // column does the work.
  const tabletColumnCap = isTablet
    ? ({maxWidth: 720, alignSelf: 'center', width: '100%'} as const)
    : null;
  const userName = useAuthStore(s => s.user?.name);
  // §14.7 Q10: in Direct (in-store/NAS) mode the daily summary reflects only
  // sales rung on this NAS during the outage — NOT the cloud's authoritative
  // day total. Label it so the cashier doesn't read a partial figure as the
  // full day. (The Z-report stays cloud-only by construction — getDailyZReport
  // exists only on RelayClient, never DirectClient — so day-close can't be
  // double-owned from the failed-over device.)
  const isDirectMode = useSettingsStore(
    s => s.settings.connectionMode === 'direct',
  );
  const [summary, setSummary] = useState<DailySummary | null>(null);
  const [recentCustomers, setRecentCustomers] = useState<
    Array<{
      name: string;
      lastSaleAt: string;
      saleId: number;
      customerId: number;
    }>
  >([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // In-flight guard: collapse concurrent fetchSummary invocations onto
  // ONE round-trip. Cold-start can fire from the initial useEffect, the
  // useFocusEffect first-focus path, AND the AppState change listener
  // within milliseconds — without this, two or three parallel 401s race
  // the refresh path and the second racer's clearLocalSession poisons
  // the first racer's freshly-minted bearer. The single-flight refresh
  // on RelayClient/DirectClient is the other half of this fix.
  const inFlightRef = useRef<Promise<void> | null>(null);

  const fetchSummary = useCallback(async (isRefresh = false) => {
    if (inFlightRef.current) {
      return inFlightRef.current;
    }
    if (isRefresh) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }
    setError(null);

    const run = async (): Promise<void> => {
      try {
        // Daily summary drives the hero card + stat strip. Recent
        // transactions feeds the Recent Customers list below.
        //
        // Sequential — NOT Promise.all — on the cold-start path. If the
        // bearer is expired, the first call triggers the single-flight
        // refresh and the second call rides the fresh token. Promise.all
        // here used to send two parallel 401s and trip the refresh race
        // (see RelayClient.refreshPromise rationale).
        const data = await ApiClient.getDailySummary();
        const transactionsPage = await ApiClient.getTransactions({
          page: 1,
          per_page: 50,
        }).catch(() => null);
      // Fallback when `dashboard.summary` undercounts vs the
      // `transactions.list` we just pulled. v1.3.27's first attempt used
      // `toISOString().slice(0,10)` which is UTC — a sale at 9am AEST
      // serialises to '…T23:00:00Z' the PREVIOUS UTC day and got missed
      // by the filter, so the override never fired and "Quiet so far"
      // stayed up. The fix is to compare via `toDateString()` which is
      // evaluated in the device's local timezone — same behaviour as
      // the Transactions tab's "Today" filter, which is why the sale was
      // visible there but not in the dashboard count.
      //
      // Also: trust the larger count rather than only overriding when
      // the server returns 0. If the server returns N and the client
      // sees N+M today, the client value wins (covers stale aggregate
      // caches that lag behind freshly-committed rows).
      const isSameLocalDay = (iso: string): boolean => {
        if (!iso) return false;
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return false;
        return d.toDateString() === new Date().toDateString();
      };
      if (data && transactionsPage) {
        const todaySales = transactionsPage.data.filter(s =>
          isSameLocalDay(s.created_at),
        );
        if (todaySales.length > (data.sales_count ?? 0)) {
          const revenue = todaySales.reduce(
            (sum, s) => sum + (s.total_cents ?? 0),
            0,
          );
          const items = todaySales.reduce(
            (sum, s) => sum + (s.items_count ?? 0),
            0,
          );
          data.sales_count = todaySales.length;
          data.revenue_cents = revenue;
          data.items_sold = items;
          data.average_sale_cents = Math.round(revenue / todaySales.length);
        }
      }
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
    };
    inFlightRef.current = run().finally(() => {
      inFlightRef.current = null;
    });
    return inFlightRef.current;
  }, [haptics]);

  useEffect(() => {
    fetchSummary();
  }, [fetchSummary]);

  // Tab root: null the shared brand-header back slot on focus so a stale
  // handler left over by ProductDetail / ProductEdit doesn't bleed through
  // onto Dashboard. Detail/Edit deliberately don't clean up their slot
  // install (v1.3.70 race fix); each tab root owns its own clear.
  useFocusEffect(
    useCallback(() => {
      useHeaderBackStore.getState().clearOnBack();
      return undefined;
    }, []),
  );
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

  // ALSO refetch the instant a sale is marked completed. The useFocusEffect
  // above already covers the common "tab back to Dashboard" flow, but on
  // some devices/timings a freshly-completed sale wasn't visible in the
  // next summary fetch — server-side eventual consistency, or the focus
  // event firing before the API commit propagated. Watching
  // cartStore.lastSaleAt gives us a deterministic "just rang a sale"
  // signal: when it changes we kick a refetch with a short delay so the
  // server has settled. Triggered whether the Dashboard tab is currently
  // focused or not — covers operators who stay on QuickSale between sales.
  const lastSaleAt = useCartStore(s => s.lastSaleAt);
  useEffect(() => {
    if (!lastSaleAt) return;
    const t = setTimeout(() => {
      // CHAIN — don't bypass the in-flight guard, but make sure the
      // post-sale refresh actually fires even if another fetch was in
      // flight at the 750ms mark. Without this chain, the in-flight
      // guard short-circuits the post-sale invocation and the new
      // sale silently fails to land on the dashboard until the user
      // pulls to refresh.
      const inFlight = inFlightRef.current;
      if (inFlight) {
        inFlight.finally(() => fetchSummary());
      } else {
        fetchSummary();
      }
    }, 750);
    return () => clearTimeout(t);
  }, [lastSaleAt, fetchSummary]);

  // App.tsx already owns a single debounced AppState listener that
  // refreshes the session on foreground. A per-screen listener here
  // used to fire fetchSummary on every transient inactive→active blip
  // (keyboard, Face ID prompt, control centre swipe), and on the
  // immediate post-login activation it triggered a parallel fetch that
  // raced the freshly-acquired bearer through the 401 retry path —
  // exactly the "Retry button twice after sign-in" symptom the user
  // reports. The useFocusEffect above covers the "tab back here"
  // case; lastSaleAt covers "just rang a sale".


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
        contentContainerStyle={[styles.scrollContent, tabletColumnCap]}
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

        <EyebrowLabel>Today</EyebrowLabel>
        {isDirectMode ? (
          <Text style={styles.provenanceLabel}>In-store totals only</Text>
        ) : null}

        {/* When today has no sales yet, the hero/stat strip would all read
            $0.00 / 0, which reads as "the app is broken" rather than "you
            haven't sold anything yet". Swap in a friendlier quiet-day card
            with a clear CTA to start a sale. Recent Customers below still
            renders normally — that history is unrelated to today's pace. */}
        {salesCount === 0 ? (
          <MotionCard style={styles.quietDayCard} delay={0}>
            <View style={styles.quietDayIcon}>
              <Icon
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
              label="Start a sale"
              icon="cart-outline"
              accessibilityLabel="Start a new sale"
              onPress={() => navigation.navigate('QuickSale')}
            />
          </MotionCard>
        ) : (
          <>
            <MotionCard style={styles.heroCard} delay={0}>
              <EyebrowLabel>Revenue</EyebrowLabel>
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
                <Icon
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
                    <StatCard label="Items sold" value={itemsStr} valueFontSize={fs} />
                  </View>
                  <View style={styles.statCell}>
                    <StatCard label="Avg sale" value={avgStr} valueFontSize={fs} />
                  </View>
                </MotionCard>
              );
            })()}
          </>
        )}

        <EyebrowLabel>Recent customers</EyebrowLabel>
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
                accessibilityLabel={`${customer.name}, view customer`}
                onPress={() => {
                  haptics.light();
                  // Cross-tab to the Customers stack so the operator lands
                  // on the full customer page (sales history, contact,
                  // addresses) — they can drill INTO a specific sale from
                  // there. Previously this took them straight to the most
                  // recent SaleDetail which felt like a navigation
                  // shortcut bug. `initial: false` keeps CustomersScreen
                  // underneath so back returns to the customer list.
                  navigation.navigate('Customers', {
                    screen: 'CustomerDetail',
                    params: {customerId: customer.customerId},
                    initial: false,
                  } as never);
                }}>
                <View style={styles.productRank}>
                  <Icon
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
                <Icon
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
  // §14.7 Q10 Direct-mode provenance marker under the "Today" eyebrow.
  provenanceLabel: {
    fontSize: FONT_SIZE.sm,
    fontFamily: FONT_FAMILY.medium,
    color: COLORS.textMuted,
    marginTop: -SPACING.xs,
    marginBottom: SPACING.xs,
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
