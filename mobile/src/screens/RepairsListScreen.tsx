import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {useFocusEffect, useNavigation, useRoute} from '@react-navigation/native';
import type {RouteProp} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import Icon from '../components/Icon';
import EmptyState from '../components/EmptyState';
import ErrorBanner from '../components/ErrorBanner';
import PillButton from '../components/PillButton';
import ApiClient from '../services/ApiClient';
import {useHaptics} from '../hooks/useHaptics';
import {useHeaderBackStore} from '../stores/headerBackStore';
import {useResponsiveLayout} from '../hooks/useResponsiveLayout';
import {useWorkspaceFeaturesStore} from '../stores/workspaceFeaturesStore';
import type {Repair, RepairStatus} from '../types/api.types';
import type {RepairsStackParamList} from '../types/navigation.types';
import {
  BORDER_RADIUS,
  COLORS,
  FONT_FAMILY,
  FONT_SIZE,
  ICON_SIZE,
  SHADOW,
  SPACING,
} from '../constants/theme';

type Nav = NativeStackNavigationProp<RepairsStackParamList, 'RepairsList'>;
type RepairsListRouteProp = RouteProp<RepairsStackParamList, 'RepairsList'>;

// 'all' is the chip-row-only sentinel used to represent "no status filter" —
// the wire never sees this value. When active, the fetch call omits the
// `status` field entirely so the server returns every non-cancelled row.
type StatusChipKey = 'all' | RepairStatus;

const PER_PAGE = 20;
const SEARCH_DEBOUNCE_MS = 300;

// Chip row ordering follows the operator's typical workflow:
// intake (pending) → triage (diagnosed) → work (in_progress) → blocked
// (waiting_parts) → pickup (ready) → closed (completed). Cancelled stays
// off the chip row — cashiers rarely need to filter to cancelled repairs.
// Ready gets a subtle dot decoration on top of its base pill styling so it
// visually stands out as "actionable now" without breaking the shared chip
// contract with the rest of the row.
const STATUS_CHIPS: {
  key: StatusChipKey;
  label: string;
  icon: React.ComponentProps<typeof Icon>['name'];
}[] = [
  {key: 'all', label: 'All', icon: 'list-outline'},
  {key: 'pending', label: 'Pending', icon: 'time-outline'},
  {key: 'diagnosed', label: 'Diagnosed', icon: 'alert-circle-outline'},
  {key: 'in_progress', label: 'In Progress', icon: 'construct-outline'},
  {key: 'waiting_parts', label: 'Waiting Parts', icon: 'cube-outline'},
  {key: 'ready', label: 'Ready', icon: 'check'},
  {key: 'completed', label: 'Completed', icon: 'receipt-outline'},
];

// Local status → colour map. See CLAUDE.md thread: no shared StatusChip
// primitive exists yet, so screens duplicate the inline pattern from
// TransactionListScreen. Pending / cancelled land on muted greys so they
// don't compete with the actionable "ready" / "in_progress" tones.
function getRepairStatusColor(status: RepairStatus): string {
  switch (status) {
    case 'pending':
      return COLORS.blue; // Dusty Blue — informational intake, distinct from cancelled/gray
    case 'diagnosed':
      return COLORS.blue; // Dusty Blue — informational
    case 'in_progress':
      return COLORS.warning; // amber — work in motion
    case 'waiting_parts':
      return COLORS.danger; // brand crimson — blocking
    case 'ready':
      return COLORS.success; // green — actionable pickup
    case 'completed':
      return COLORS.successDark; // darker green — terminal success
    case 'cancelled':
      return COLORS.textDim; // muted grey — terminal, non-actionable
    default:
      return COLORS.textDim;
  }
}

// Copy for the chip. Underscores in wire enums (`in_progress`,
// `waiting_parts`) don't render well; we swap to a spaced human form.
function getRepairStatusLabel(status: RepairStatus): string {
  switch (status) {
    case 'in_progress':
      return 'In progress';
    case 'waiting_parts':
      return 'Waiting parts';
    default:
      // capitalise first letter of the single-word statuses
      return status.charAt(0).toUpperCase() + status.slice(1);
  }
}

// Two-letter device initials for the avatar circle. Falls back to a wrench
// glyph via `?` when there's no device string on the row (e.g. the operator
// intake-ed without a device_type).
function getDeviceInitials(deviceType: string | null): string {
  if (!deviceType) return '?';
  const trimmed = deviceType.trim();
  if (!trimmed) return '?';
  const parts = trimmed.split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return trimmed.slice(0, 2).toUpperCase();
}

// e.g. "Apple iPhone 13" from three optional fields. Empty parts silently
// drop out so a repair with only `device_type: 'Phone'` still renders
// cleanly instead of leaving stray separators.
function formatDeviceSummary(
  deviceType: string | null,
  brand: string | null,
  model: string | null,
): string {
  const parts = [brand, model].filter(Boolean).map(s => String(s).trim());
  const head = parts.join(' ');
  if (deviceType && head) return `${deviceType} · ${head}`;
  if (deviceType) return deviceType;
  if (head) return head;
  return 'Device details pending';
}

function formatEstimate(cost: number | null): string {
  if (cost == null) return 'Quote pending';
  // `estimated_cost` is dollars, not cents (see shared/src/types/api.types.ts
  // §Repair). Use whole-dollar formatting with the same locale rules as
  // formatCurrencyWhole so a $1,299 estimate reads naturally on the row.
  return '$' + cost.toFixed(2);
}

const RepairsListScreen: React.FC = () => {
  const navigation = useNavigation<Nav>();
  const route = useRoute<RepairsListRouteProp>();
  const routeCustomerId = route.params?.customer_id;
  const haptics = useHaptics();
  const {isTablet} = useResponsiveLayout();
  // Match Items/Transactions: cap content column at 720pt on iPad so long
  // rows don't stretch full-bleed across a landscape screen.
  const tabletColumnCap = isTablet
    ? ({maxWidth: 720, alignSelf: 'center', width: '100%'} as const)
    : null;

  // Tab root: null the shared brand-header back slot on focus so a stale
  // handler left over by RepairDetail / RepairEdit doesn't bleed through
  // onto the list. Same pattern as ItemsScreen / TransactionListScreen.
  useFocusEffect(
    useCallback(() => {
      useHeaderBackStore.getState().clearOnBack();
      return undefined;
    }, []),
  );

  // ---------------- state ----------------
  const [repairs, setRepairs] = useState<Repair[]>([]);
  const [statusFilter, setStatusFilter] = useState<StatusChipKey>('all');
  // Seeded from the deep-link. Tapping the ✕ on the customer chip clears
  // it in-place without popping the screen (mirrors the TransactionList
  // productId behaviour).
  const [customerId, setCustomerId] = useState<number | undefined>(
    routeCustomerId,
  );
  const [customerName, setCustomerName] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [lastPage, setLastPage] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // requestSeq stale-guard: an out-of-order response from a stale filter
  // must never clobber the newer visible list.
  const requestSeq = useRef(0);

  // Belt-and-braces: if the workspace flag flipped off after the user
  // deep-linked here (e.g. an admin toggled it mid-session) or restoreCache
  // repopulated `false`, bounce out instead of showing an empty screen the
  // operator can't back out of gracefully. ApiClient.guardRepairsCall also
  // toasts on the fetch attempt, but running this on mount avoids the
  // "REPAIRS_DISABLED" flash for the deep-link race described in T4's plan.
  useEffect(() => {
    if (!useWorkspaceFeaturesStore.getState().repairs_enabled) {
      Alert.alert('Repairs', 'Repairs are not enabled for this site.');
      navigation.goBack();
    }
    // Intentionally mount-only; a mid-session flag flip is handled by the
    // tab conditional in AppTabs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-seed the customer filter when a fresh navigation lands here with a
  // new customer_id param (deep-link from CustomerDetail).
  useEffect(() => {
    setCustomerId(routeCustomerId);
  }, [routeCustomerId]);

  // Best-effort customer name lookup so the chip can label the filter with
  // the operator's actual customer name instead of a bare ID. Fails soft:
  // a network hiccup shows "this customer" rather than crashing the list.
  useEffect(() => {
    if (customerId == null) {
      setCustomerName(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const detail = await ApiClient.getCustomerDetail(customerId);
        if (!cancelled) {
          setCustomerName(detail?.name ?? 'this customer');
        }
      } catch {
        if (!cancelled) setCustomerName('this customer');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [customerId]);

  // ---------------- fetch ----------------
  const fetchRepairs = useCallback(
    async (pageNum: number, append: boolean = false) => {
      // Belt-and-braces: if the workspace flag was flipped off mid-session
      // but the debounced fetch effect fires before the mount-guard bounces,
      // skip the API call entirely. The mount-guard useEffect (line 196)
      // still handles navigation.goBack(); this prevents an orphan
      // listRepairs → REPAIRS_DISABLED_CODE → dupe toast in the race window.
      if (!useWorkspaceFeaturesStore.getState().repairs_enabled) return;
      const seq = ++requestSeq.current;
      if (pageNum === 1 && !append) {
        setIsLoading(true);
      } else {
        setIsLoadingMore(true);
      }
      setError(null);

      try {
        const filters: {
          status?: RepairStatus;
          customer_id?: number;
        } = {};
        if (statusFilter !== 'all') filters.status = statusFilter;
        if (customerId != null) filters.customer_id = customerId;

        const response = await ApiClient.listRepairs(
          pageNum,
          PER_PAGE,
          filters,
        );
        if (seq !== requestSeq.current) return; // stale response

        // Client-side search: `listRepairs` on the relay doesn't accept a
        // `q` param yet, so we scope the visible rows by matching
        // repair_number / customer_name / device fields on the loaded
        // pages. When server-side search lands, this trims to a no-op.
        const trimmedSearch = search.trim().toLowerCase();
        const rows = trimmedSearch
          ? response.data.filter(r => {
              return (
                r.repair_number.toLowerCase().includes(trimmedSearch) ||
                (r.customer_name ?? '').toLowerCase().includes(trimmedSearch) ||
                (r.device_type ?? '').toLowerCase().includes(trimmedSearch) ||
                (r.brand ?? '').toLowerCase().includes(trimmedSearch) ||
                (r.model ?? '').toLowerCase().includes(trimmedSearch)
              );
            })
          : response.data;

        setRepairs(prev => (append ? [...prev, ...rows] : rows));
        setPage(response.meta.current_page);
        setLastPage(response.meta.last_page);
      } catch (e) {
        if (seq !== requestSeq.current) return;
        haptics.error();
        setError(e instanceof Error ? e.message : 'Failed to load repairs');
      } finally {
        if (seq === requestSeq.current) {
          setIsLoading(false);
          setIsRefreshing(false);
          setIsLoadingMore(false);
        }
      }
    },
    [statusFilter, customerId, haptics, search],
  );

  // Debounced initial + search-driven fetch. Immediate on mount / filter
  // change, 300ms debounced when the user is typing so we don't hammer the
  // relay per keystroke.
  useEffect(() => {
    const t = setTimeout(
      () => {
        fetchRepairs(1);
      },
      search ? SEARCH_DEBOUNCE_MS : 0,
    );
    return () => clearTimeout(t);
  }, [fetchRepairs, search]);

  // Refetch on tab focus so a repair created / status-changed on a sibling
  // screen surfaces without requiring pull-to-refresh. Skipped on the very
  // first focus — the mount effect above already covers page 1.
  const didInitialFetchRef = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (!didInitialFetchRef.current) {
        didInitialFetchRef.current = true;
        return undefined;
      }
      fetchRepairs(1);
      return undefined;
    }, [fetchRepairs]),
  );

  // ---------------- handlers ----------------
  const handleRefresh = useCallback(() => {
    setIsRefreshing(true);
    fetchRepairs(1);
  }, [fetchRepairs]);

  const handleLoadMore = useCallback(() => {
    if (!isLoadingMore && page < lastPage) {
      fetchRepairs(page + 1, true);
    }
  }, [isLoadingMore, page, lastPage, fetchRepairs]);

  const handleFilterChange = useCallback(
    (next: StatusChipKey) => {
      haptics.selection();
      setStatusFilter(next);
      setPage(1);
    },
    [haptics],
  );

  const handleClearCustomerFilter = useCallback(() => {
    haptics.selection();
    setCustomerId(undefined);
    setPage(1);
  }, [haptics]);

  const handleRowPress = useCallback(
    (repair: Repair) => {
      haptics.light();
      navigation.navigate('RepairDetail', {id: repair.id});
    },
    [navigation, haptics],
  );

  const handleNewRepair = useCallback(() => {
    haptics.light();
    navigation.navigate('RepairEdit', {});
  }, [navigation, haptics]);

  // ---------------- renderers ----------------
  const renderRow = ({item}: {item: Repair}) => {
    const chipColor = getRepairStatusColor(item.status);
    const deviceLine = formatDeviceSummary(
      item.device_type,
      item.brand,
      item.model,
    );
    const customerLine = item.customer_name ?? 'No customer';
    return (
      <TouchableOpacity
        style={styles.row}
        activeOpacity={0.7}
        onPress={() => handleRowPress(item)}
        accessibilityRole="button"
        accessibilityLabel={`Repair ${item.repair_number}, ${customerLine}, ${deviceLine}, status ${getRepairStatusLabel(item.status)}, ${formatEstimate(item.estimated_cost)}. Tap to view.`}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{getDeviceInitials(item.device_type)}</Text>
        </View>
        <View style={styles.rowLeft}>
          <Text style={styles.repairNumber} numberOfLines={1}>
            {item.repair_number}
          </Text>
          <Text
            style={
              item.customer_name ? styles.customerName : styles.customerNameMuted
            }
            numberOfLines={1}>
            {customerLine}
          </Text>
          <Text style={styles.deviceLine} numberOfLines={1}>
            {deviceLine}
          </Text>
        </View>
        <View style={styles.rowRight}>
          <View style={[styles.statusChip, {backgroundColor: chipColor}]}>
            <Text style={styles.statusText}>
              {getRepairStatusLabel(item.status)}
            </Text>
          </View>
          <Text
            style={[
              styles.estimate,
              item.estimated_cost == null && styles.estimatePending,
            ]}>
            {formatEstimate(item.estimated_cost)}
          </Text>
        </View>
        <Icon
          name="chevron-forward"
          size={ICON_SIZE.action}
          color={COLORS.textMuted}
          style={styles.rowChevron}
        />
      </TouchableOpacity>
    );
  };

  const renderFooter = () => {
    if (isLoadingMore) {
      return (
        <View style={styles.footerLoader}>
          <ActivityIndicator color={COLORS.accent} size="small" />
        </View>
      );
    }
    if (error && repairs.length > 0) {
      return (
        <TouchableOpacity
          style={styles.footerRetry}
          onPress={() => fetchRepairs(page + 1, true)}
          accessibilityRole="button"
          accessibilityLabel="Retry loading next page">
          <Text style={styles.footerRetryText}>Tap to retry</Text>
        </TouchableOpacity>
      );
    }
    if (repairs.length > 0 && page >= lastPage) {
      return (
        <View style={styles.footerEnd}>
          <Text style={styles.footerEndText}>End of list</Text>
        </View>
      );
    }
    return null;
  };

  const renderEmpty = () => {
    if (isLoading) return null;
    return (
      <EmptyState
        icon="construct-outline"
        title="No repairs match this filter"
        description={
          statusFilter === 'all' && customerId == null
            ? 'Create the first repair to get started.'
            : 'Clear a filter or try a different status.'
        }
        action={{label: 'New repair', onPress: handleNewRepair}}
      />
    );
  };

  // Memoize chip rows so the filter row doesn't re-render every time a
  // row taps → causing a haptic pop from unrelated re-renders on iPad.
  const chipRow = useMemo(
    () =>
      STATUS_CHIPS.map(chip => {
        const active = statusFilter === chip.key;
        // Ready gets a small decorative dot rendered inside the pill to
        // read as "actionable now" against the sibling chips. Doesn't
        // change the tap-target or the shared active-fill treatment.
        const isReady = chip.key === 'ready';
        return (
          <TouchableOpacity
            key={chip.key}
            style={[styles.filterButton, active && styles.filterButtonActive]}
            onPress={() => handleFilterChange(chip.key)}
            accessibilityRole="button"
            accessibilityLabel={`Filter ${chip.label}`}
            accessibilityState={{selected: active}}>
            <Icon
              name={chip.icon}
              size={ICON_SIZE.action - 2}
              color={active ? COLORS.cream : COLORS.textMuted}
              style={styles.filterIcon}
            />
            <Text
              style={[
                styles.filterButtonText,
                active && styles.filterButtonTextActive,
                isReady && !active && styles.filterButtonTextReady,
              ]}>
              {chip.label}
            </Text>
            {isReady && !active ? (
              <View style={styles.readyDot} />
            ) : null}
          </TouchableOpacity>
        );
      }),
    [statusFilter, handleFilterChange],
  );

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right']}>
      {/* Header + primary CTA */}
      <View style={[styles.header, tabletColumnCap]}>
        <Text style={styles.headerTitle}>Repairs</Text>
        <PillButton
          label="New repair"
          icon="plus"
          variant="solid"
          onPress={handleNewRepair}
          accessibilityLabel="Create a new repair"
        />
      </View>

      {/* Deep-link customer filter chip */}
      {customerId != null ? (
        <View style={[styles.customerFilterRow, tabletColumnCap]}>
          <TouchableOpacity
            style={styles.customerFilterChip}
            onPress={handleClearCustomerFilter}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={`Filtered to ${customerName ?? 'this customer'}. Tap to clear.`}>
            <Icon
              name="filter"
              size={ICON_SIZE.action}
              color={COLORS.white}
              style={styles.customerFilterIcon}
            />
            <Text style={styles.customerFilterText} numberOfLines={1}>
              Filtered to: {customerName ?? 'this customer'}
            </Text>
            <Icon
              name="close-circle"
              size={ICON_SIZE.action}
              color={COLORS.white}
              style={styles.customerFilterClose}
            />
          </TouchableOpacity>
        </View>
      ) : null}

      {/* Status filter chips — horizontal ScrollView so the 7 chips
          (All / Pending / Diagnosed / In Progress / Waiting Parts / Ready
          / Completed) stay on one visual line even on 4.7" phones. Wrapping
          to two rows on small screens reads as broken. */}
      <View style={[styles.filterRowWrap, tabletColumnCap]}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterRow}>
          {chipRow}
        </ScrollView>
      </View>

      {/* Search input */}
      <View style={[styles.searchRow, tabletColumnCap]}>
        <Icon
          name="search"
          size={ICON_SIZE.action}
          color={COLORS.textMuted}
          style={styles.searchIcon}
        />
        <TextInput
          style={styles.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder="Search by repair number, customer, device"
          placeholderTextColor={COLORS.inputPlaceholder}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
        />
        {search ? (
          <TouchableOpacity
            onPress={() => setSearch('')}
            style={styles.clearBtn}
            accessibilityRole="button"
            accessibilityLabel="Clear search">
            <Icon
              name="close-circle"
              size={ICON_SIZE.action}
              color={COLORS.textMuted}
            />
          </TouchableOpacity>
        ) : null}
      </View>

      {/* Error banner */}
      {error ? (
        <View style={[styles.bannerWrap, tabletColumnCap]}>
          <ErrorBanner
            message={error}
            onRetry={() => fetchRepairs(1)}
            onDismiss={() => setError(null)}
          />
        </View>
      ) : null}

      {/* Loading spinner or list */}
      {isLoading && !isRefreshing && repairs.length === 0 ? (
        <ActivityIndicator
          color={COLORS.accent}
          size="large"
          style={styles.loader}
        />
      ) : (
        <FlatList
          data={repairs}
          renderItem={renderRow}
          keyExtractor={item => String(item.id)}
          style={tabletColumnCap}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={renderEmpty}
          ListFooterComponent={renderFooter}
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.3}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={handleRefresh}
              tintColor={COLORS.accent}
            />
          }
        />
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.md,
    paddingBottom: SPACING.sm,
  },
  headerTitle: {
    color: COLORS.text,
    fontSize: FONT_SIZE.xxl,
    fontFamily: FONT_FAMILY.bold,
    flexShrink: 1,
    marginRight: SPACING.sm,
  },

  // Deep-link customer filter chip — crimson pill that reads as "active
  // filter you own dismissing". Mirrors the productFilter chip pattern
  // from TransactionListScreen so the visual language stays consistent.
  customerFilterRow: {
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.sm,
  },
  customerFilterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.crimson,
    borderRadius: BORDER_RADIUS.full,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
    minHeight: 44,
    ...SHADOW.card,
  },
  customerFilterIcon: {marginRight: SPACING.xs},
  customerFilterText: {
    flex: 1,
    color: COLORS.white,
    fontSize: FONT_SIZE.sm,
    fontFamily: FONT_FAMILY.semibold,
    letterSpacing: 0.2,
  },
  customerFilterClose: {marginLeft: SPACING.sm},

  // Chip row — wraps so long labels (In Progress / Waiting Parts) don't
  // Horizontal scroll container so the 7 chips stay on one row without
  // wrapping on narrow phones (UX-04 remediation).
  filterRowWrap: {
    paddingTop: SPACING.sm,
  },
  filterRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.md,
  },
  filterButton: {
    flexDirection: 'row',
    paddingVertical: SPACING.sm - 2,
    paddingHorizontal: SPACING.md,
    borderRadius: BORDER_RADIUS.full,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.navy,
    alignItems: 'center',
    justifyContent: 'center',
    // HIG / Material 44pt tap target minimum.
    minHeight: 44,
    ...SHADOW.card,
  },
  filterButtonActive: {
    backgroundColor: COLORS.crimson,
    borderColor: COLORS.crimson,
  },
  filterIcon: {marginRight: SPACING.xs},
  filterButtonText: {
    color: COLORS.navy,
    fontSize: FONT_SIZE.sm,
    fontFamily: FONT_FAMILY.semibold,
    letterSpacing: 0.2,
  },
  filterButtonTextActive: {
    color: COLORS.white,
  },
  // "Ready" chip gets a bold weight when inactive so it draws the eye as
  // the actionable status the cashier is usually hunting for.
  filterButtonTextReady: {
    fontFamily: FONT_FAMILY.bold,
    color: COLORS.crimson,
  },
  // Small decorative dot next to the Ready label when inactive — signals
  // "there might be pickups waiting" without stealing focus.
  readyDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: COLORS.crimson,
    marginLeft: SPACING.xs,
  },

  // Search input — mirrors the ItemsScreen search row structure.
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: SPACING.md,
    marginTop: SPACING.sm,
    paddingHorizontal: SPACING.sm + 4,
    paddingVertical: SPACING.xs,
    backgroundColor: COLORS.inputBg,
    borderRadius: BORDER_RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.inputBorder,
  },
  searchIcon: {marginRight: SPACING.sm},
  searchInput: {
    flex: 1,
    fontSize: FONT_SIZE.md,
    fontFamily: FONT_FAMILY.regular,
    color: COLORS.text,
    paddingVertical: SPACING.sm,
  },
  clearBtn: {padding: SPACING.xs},

  bannerWrap: {
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.sm,
  },

  loader: {
    marginTop: SPACING.xl,
  },

  listContent: {
    padding: SPACING.md,
    paddingBottom: SPACING.xxl,
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.surfaceBorder,
    borderRadius: BORDER_RADIUS.lg,
    paddingHorizontal: SPACING.md,
    // Tighter row: SPACING.sm + 32pt avatar keeps rows ~52pt tall so a
    // 4.7" phone shows 6-7 rows and a 6.1" phone shows 7-8 (UX-02).
    paddingVertical: SPACING.sm,
    marginBottom: SPACING.xs,
  },

  // Avatar circle — solid navy fill with cream initials. 32pt so the row
  // reads as a compact list item, not a hero portrait (UX-02).
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: COLORS.navy,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: SPACING.sm + 2,
  },
  avatarText: {
    color: COLORS.cream,
    fontSize: FONT_SIZE.sm,
    fontFamily: FONT_FAMILY.bold,
    letterSpacing: 0.4,
  },

  rowLeft: {
    flex: 1,
    marginRight: SPACING.sm,
  },
  repairNumber: {
    color: COLORS.text,
    fontSize: FONT_SIZE.md,
    fontFamily: FONT_FAMILY.medium,
    fontVariant: ['tabular-nums'],
  },
  customerName: {
    color: COLORS.textLight,
    fontSize: FONT_SIZE.sm,
    marginTop: 2,
  },
  customerNameMuted: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.sm,
    marginTop: 2,
    fontStyle: 'italic',
  },
  deviceLine: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.xs,
    marginTop: 2,
  },
  rowRight: {
    alignItems: 'flex-end',
  },
  statusChip: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: 2,
    borderRadius: BORDER_RADIUS.full,
    marginBottom: SPACING.xs,
  },
  statusText: {
    color: COLORS.white,
    fontSize: FONT_SIZE.xs,
    fontFamily: FONT_FAMILY.medium,
    textTransform: 'capitalize',
  },
  estimate: {
    color: COLORS.textLight,
    fontSize: FONT_SIZE.md,
    fontFamily: FONT_FAMILY.bold,
    fontVariant: ['tabular-nums'],
  },
  estimatePending: {
    color: COLORS.textMuted,
    fontFamily: FONT_FAMILY.medium,
    fontStyle: 'italic',
  },
  rowChevron: {marginLeft: SPACING.sm},

  footerLoader: {
    paddingVertical: SPACING.lg,
    alignItems: 'center',
  },
  footerEnd: {
    paddingVertical: SPACING.lg,
    alignItems: 'center',
  },
  footerEndText: {
    color: COLORS.textDim,
    fontSize: FONT_SIZE.xs,
    fontFamily: FONT_FAMILY.medium,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  footerRetry: {
    paddingVertical: SPACING.lg,
    alignItems: 'center',
  },
  footerRetryText: {
    color: COLORS.crimson,
    fontSize: FONT_SIZE.sm,
    fontFamily: FONT_FAMILY.bold,
    textDecorationLine: 'underline',
  },
});

export default RepairsListScreen;
