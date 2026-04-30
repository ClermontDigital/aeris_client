import React, {useState, useEffect, useCallback} from 'react';
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
import ApiClient from '../services/ApiClient';
import type {DailySummary} from '../types/api.types';
import {COLORS, SPACING, FONT_SIZE, BORDER_RADIUS} from '../constants/theme';

const formatCents = (cents: number): string => '$' + (cents / 100).toFixed(2);

const DashboardScreen: React.FC = () => {
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
      setError(message);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchSummary();
  }, [fetchSummary]);

  const todayString = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

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
          <Text style={styles.headerTitle}>Dashboard</Text>
          <Text style={styles.headerDate}>{todayString}</Text>
        </View>

        {error ? (
          <View style={styles.inlineError}>
            <Text style={styles.inlineErrorText}>{error}</Text>
          </View>
        ) : null}

        <View style={styles.statsGrid}>
          <StatCard
            label="Revenue"
            value={formatCents(summary?.revenue_cents ?? 0)}
            isRevenue
          />
          <StatCard
            label="Transactions"
            value={String(summary?.sales_count ?? 0)}
          />
          <StatCard
            label="Items Sold"
            value={String(summary?.items_sold ?? 0)}
          />
          <StatCard
            label="Avg Sale"
            value={formatCents(summary?.average_sale_cents ?? 0)}
          />
        </View>

        {summary?.top_products && summary.top_products.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Top Products</Text>
            {summary.top_products.slice(0, 5).map((product, index) => (
              <View key={product.id} style={styles.productRow}>
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
                  {formatCents(product.revenue_cents)}
                </Text>
              </View>
            ))}
          </View>
        ) : null}

        {lastUpdated ? (
          <Text style={styles.lastUpdated}>
            Last updated:{' '}
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

const StatCard: React.FC<{label: string; value: string; isRevenue?: boolean}> = ({
  label,
  value,
  isRevenue,
}) => (
  <View style={styles.statCard}>
    <Text style={[styles.statValue, isRevenue && styles.statValueRevenue]}>
      {value}
    </Text>
    <Text style={styles.statLabel}>{label}</Text>
  </View>
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
    borderRadius: BORDER_RADIUS.md,
  },
  retryText: {
    color: COLORS.white,
    fontSize: FONT_SIZE.md,
    fontWeight: '600',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: SPACING.md,
    paddingBottom: SPACING.xxl,
  },
  header: {
    marginBottom: SPACING.lg,
  },
  headerTitle: {
    fontSize: FONT_SIZE.xxl,
    fontWeight: '700',
    color: COLORS.text,
  },
  headerDate: {
    fontSize: FONT_SIZE.sm,
    color: COLORS.textMuted,
    marginTop: SPACING.xs,
  },
  inlineError: {
    backgroundColor: 'rgba(220, 38, 38, 0.15)',
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.sm,
    marginBottom: SPACING.md,
  },
  inlineErrorText: {
    color: COLORS.danger,
    fontSize: FONT_SIZE.sm,
    textAlign: 'center',
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
    marginBottom: SPACING.lg,
  },
  statCard: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.surfaceBorder,
    padding: SPACING.md,
    alignItems: 'center',
  },
  statValue: {
    fontSize: FONT_SIZE.xl,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: SPACING.xs,
  },
  statValueRevenue: {
    color: COLORS.accent,
  },
  statLabel: {
    fontSize: FONT_SIZE.sm,
    color: COLORS.textMuted,
  },
  section: {
    marginBottom: SPACING.lg,
  },
  sectionTitle: {
    fontSize: FONT_SIZE.lg,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: SPACING.sm,
  },
  productRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.surfaceBorder,
    padding: SPACING.sm,
    marginBottom: SPACING.xs,
  },
  productRank: {
    width: 28,
    height: 28,
    borderRadius: BORDER_RADIUS.full,
    backgroundColor: COLORS.surfaceHover,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: SPACING.sm,
  },
  productRankText: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.sm,
    fontWeight: '600',
  },
  productInfo: {
    flex: 1,
    marginRight: SPACING.sm,
  },
  productName: {
    color: COLORS.text,
    fontSize: FONT_SIZE.md,
    fontWeight: '500',
  },
  productMeta: {
    color: COLORS.textDim,
    fontSize: FONT_SIZE.xs,
    marginTop: 2,
  },
  productRevenue: {
    color: COLORS.accent,
    fontSize: FONT_SIZE.md,
    fontWeight: '600',
  },
  lastUpdated: {
    color: COLORS.textDim,
    fontSize: FONT_SIZE.xs,
    textAlign: 'center',
    marginTop: SPACING.md,
  },
});

export default DashboardScreen;
