import React, {useState, useEffect, useCallback, useRef} from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Linking,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {useNavigation, useRoute, useFocusEffect} from '@react-navigation/native';
import type {CompositeNavigationProp, RouteProp} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import type {BottomTabNavigationProp} from '@react-navigation/bottom-tabs';
import Icon from '../components/Icon';
import PillButton from '../components/PillButton';
import {COLORS, SPACING, FONT_SIZE, FONT_FAMILY, BORDER_RADIUS} from '../constants/theme';
import ApiClient from '../services/ApiClient';
import {useHaptics} from '../hooks/useHaptics';
import {useResponsiveLayout} from '../hooks/useResponsiveLayout';
import type {Address, Customer, Repair, RepairStatus, Sale} from '../types/api.types';
import type {
  AppTabParamList,
  CustomersStackParamList,
} from '../types/navigation.types';
import {formatCurrency} from '../utils/format';
import {useNavHistoryStore} from '../stores/navHistoryStore';
import {useHeaderBackStore} from '../stores/headerBackStore';
import {useWorkspaceFeaturesStore} from '../stores/workspaceFeaturesStore';

const formatShortDate = (iso: string | null | undefined): string => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
};

const statusColor = (status: Sale['status']): string => {
  switch (status) {
    case 'completed':
      return COLORS.success;
    case 'refunded':
      return COLORS.danger;
    case 'voided':
      return COLORS.warning;
    default:
      return COLORS.textDim;
  }
};

// repairStatusColor + repairStatusLabel now live in ../utils/repairStatus
// (T9-2 remediation: shared with RepairsListScreen so a future enum
// addition only needs one edit). Aliased at the import site so the
// short local names inside the JSX below don't need to change.
import {
  getRepairStatusColor as repairStatusColor,
  getRepairStatusLabel as repairStatusLabel,
} from '../utils/repairStatus';

function renderAddressLines(a: Address): string {
  const parts: string[] = [];
  if (a.line_1) parts.push(a.line_1);
  if (a.line_2) parts.push(a.line_2);
  const cityState = [a.city, a.state].filter(Boolean).join(', ');
  if (cityState || a.postcode) {
    parts.push([cityState, a.postcode].filter(Boolean).join(' '));
  }
  if (a.country) parts.push(a.country);
  return parts.filter(Boolean).join('\n');
}

type CustomerDetailRouteProp = RouteProp<
  CustomersStackParamList,
  'CustomerDetail'
>;

const initialsOf = (name: string | undefined): string => {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? '' : '';
  return (first + last).toUpperCase() || '?';
};

type NavigationProp = CompositeNavigationProp<
  NativeStackNavigationProp<CustomersStackParamList, 'CustomerDetail'>,
  BottomTabNavigationProp<AppTabParamList>
>;

export default function CustomerDetailScreen() {
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<CustomerDetailRouteProp>();
  const haptics = useHaptics();
  const {isTablet} = useResponsiveLayout();
  const tabletColumnCap = isTablet
    ? ({maxWidth: 720, alignSelf: 'center', width: '100%'} as const)
    : null;
  const {customerId} = route.params;

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isUnavailable, setIsUnavailable] = useState(false);
  const [notFound, setNotFound] = useState(false);
  // Read via hook (not getState) so a mid-session workspace-flag flip
  // re-renders this screen and hides the section immediately. Mirrors the
  // Dashboard's Repairs card.
  const isRepairsEnabled = useWorkspaceFeaturesStore(s => s.repairs_enabled);
  // Repairs section state. `recentRepairs === null` means the fetch is
  // in-flight (renders a small ActivityIndicator inside the card); `[]` is
  // the empty state. `repairsError` flips on for any fetch failure so the
  // section shows a subtle 'unavailable' body instead of crashing the
  // customer view. `repairsTotal` carries the true server-side count so
  // the section label reads "Repairs (12)" instead of the capped-at-3
  // slice length (T9T10-05 remediation).
  const [recentRepairs, setRecentRepairs] = useState<Repair[] | null>(null);
  const [repairsTotal, setRepairsTotal] = useState<number | null>(null);
  const [repairsError, setRepairsError] = useState<boolean>(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    setIsUnavailable(false);
    setNotFound(false);
    try {
      const data = await ApiClient.getCustomerDetail(customerId);
      if (data == null) {
        setNotFound(true);
      } else {
        setCustomer(data);
      }
    } catch {
      setIsUnavailable(true);
    } finally {
      setIsLoading(false);
    }
  }, [customerId]);

  useEffect(() => {
    load();
  }, [load]);

  // Re-fetch on focus so the detail view reflects edits made on
  // CustomerEditScreen. The initial useEffect above handles the cold-
  // mount; useFocusEffect kicks in every subsequent return-to-detail.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  // Fetch the customer's most-recent repairs. Isolated from the main
  // getCustomerDetail path so a repairs-off workspace pays no round-trip
  // and a transient repairs failure doesn't taint the customer view.
  // per_page=3 matches the section slice; anything above 3 is dropped by
  // the render, so no client-side trimming needed.
  const loadRepairs = useCallback(async () => {
    if (!isRepairsEnabled) return;
    try {
      setRepairsError(false);
      const page = await ApiClient.listRepairs(1, 3, {customer_id: customerId});
      setRecentRepairs(page?.data ?? []);
      // Server-side total, not the sliced length. Used by the section
      // label so a customer with 50 repairs doesn't read as "Repairs (3)".
      setRepairsTotal(page?.meta?.total ?? (page?.data?.length ?? 0));
    } catch {
      setRepairsError(true);
      // Leave `recentRepairs` untouched — the render branches on
      // `repairsError` first, so a previously-loaded list stays visible
      // if the refetch fails.
    }
  }, [isRepairsEnabled, customerId]);

  useEffect(() => {
    loadRepairs();
  }, [loadRepairs]);

  // Refetch on tab return so a repair created / status-changed on a
  // sibling screen surfaces without needing a manual reload. Duplicate
  // initial call is a tolerable perf nit — real react-navigation
  // deduplicates the mount focus internally.
  useFocusEffect(
    useCallback(() => {
      loadRepairs();
    }, [loadRepairs]),
  );

  // Single back handler shared by the brand-header Back button and any
  // in-page Back. Cross-tab breadcrumb aware: if the user arrived via a
  // cross-tab jump (e.g. TransactionsList -> SaleDetail -> CustomerDetail),
  // return them to the originating tab rather than popping inside the
  // Customers stack.
  // One-shot guard: handleBack is reachable from BOTH the header and the
  // in-page button; popPrev() mutates history, so a fast double-tap could
  // over-navigate. Reset on each focus.
  const backFiredRef = useRef(false);
  const handleBack = useCallback(() => {
    if (backFiredRef.current) return;
    backFiredRef.current = true;
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

  // Surface the Back button in the shared brand header while focused.
  // NO cleanup on useFocusEffect — with react-native-screens v4 + native-
  // stack the popped screen's blur fires BEFORE the revealed screen's
  // focus on goBack(), so identity-matched cleanup races ahead and wipes
  // the slot just as the next screen is about to install its own handler.
  // Instead, beforeRemove (below) handles the slot cleanup when this
  // screen is actually being removed from the stack; clearIf is identity-
  // matched so we never accidentally wipe the next screen's handler.
  // (Mirrors the ProductDetailScreen v1.3.70 race fix.)
  const setHeaderBack = useHeaderBackStore(s => s.setOnBack);
  const clearHeaderBackIf = useHeaderBackStore(s => s.clearIf);
  useFocusEffect(
    useCallback(() => {
      backFiredRef.current = false;
      setHeaderBack(handleBack);
      return undefined;
    }, [setHeaderBack, handleBack]),
  );
  useEffect(() => {
    const sub = navigation.addListener('beforeRemove', () => {
      clearHeaderBackIf(handleBack);
    });
    return sub;
  }, [navigation, clearHeaderBackIf, handleBack]);

  const openMail = useCallback(
    (email: string) => {
      haptics.light();
      Linking.openURL(`mailto:${email}`).catch(() => {});
    },
    [haptics],
  );

  const openTel = useCallback(
    (phone: string) => {
      haptics.light();
      // Strip spaces / dashes; tel: is usually tolerant but cleaner is safer.
      const cleaned = phone.replace(/[^+\d]/g, '');
      Linking.openURL(`tel:${cleaned}`).catch(() => {});
    },
    [haptics],
  );

  // SaleDetail lives under the Transactions tab. The composite nav type
  // includes the parent BottomTab nav, so navigating across tabs with
  // nested screen+params is type-safe directly on `navigation`.
  const goToSale = useCallback(
    (saleId: number) => {
      haptics.light();
      // Push a breadcrumb so the back button on SaleDetail can return here.
      useNavHistoryStore.getState().push({
        tab: 'Customers',
        screen: 'CustomerDetail',
        params: {customerId},
      });
      // initial: false APPENDS SaleDetail onto the Transactions stack
      // with TransactionList beneath, so a later Transactions-tab tap
      // pops back to the list. The default `initial: true` REPLACES the
      // stack with just SaleDetail — verified against React Navigation v7
      // `getActionFromState`. The reverse name is counter-intuitive but
      // the behavior is the right one.
      navigation.navigate('Transactions', {
        screen: 'SaleDetail',
        params: {saleId},
        initial: false,
      });
    },
    [haptics, navigation, customerId],
  );

  // Cross-tab jump into the Repairs stack for a specific repair. Same
  // breadcrumb + `initial: false` shape as goToSale so the back handler
  // returns here rather than dumping the operator on the Repairs list.
  const goToRepair = useCallback(
    (repairId: number) => {
      haptics.light();
      useNavHistoryStore.getState().push({
        tab: 'Customers',
        screen: 'CustomerDetail',
        params: {customerId},
      });
      navigation.navigate('Repairs', {
        screen: 'RepairDetail',
        params: {id: repairId},
        initial: false,
      });
    },
    [haptics, navigation, customerId],
  );

  // "View all" deep-links into the Repairs list pre-filtered by this
  // customer. RepairsList reads `customer_id` off route params and passes
  // it through the listRepairs filter — see RepairsListScreen.tsx:255-260.
  const goToRepairsList = useCallback(() => {
    haptics.light();
    useNavHistoryStore.getState().push({
      tab: 'Customers',
      screen: 'CustomerDetail',
      params: {customerId},
    });
    navigation.navigate('Repairs', {
      screen: 'RepairsList',
      params: {customer_id: customerId},
      initial: false,
    });
  }, [haptics, navigation, customerId]);

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
            We couldn&apos;t load this customer right now. Please try again in a
            moment.
          </Text>
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={() => {
              haptics.light();
              load();
            }}
            accessibilityRole="button"
            accessibilityLabel="Retry loading customer">
            <Text style={styles.primaryBtnText}>Retry</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => {
              haptics.light();
              navigation.goBack();
            }}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}>
            <Text style={styles.linkText}>Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (notFound || !customer) {
    return (
      <SafeAreaView style={styles.container} edges={['left', 'right']}>
        <View style={styles.center}>
          <Icon
            name="person-outline"
            size={36}
            color={COLORS.textDim}
            style={styles.errorIcon}
          />
          <Text style={styles.errorTitle}>Customer not found</Text>
          <TouchableOpacity
            onPress={() => {
              haptics.light();
              navigation.goBack();
            }}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}>
            <Text style={styles.linkText}>Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const balance = customer.account_balance_cents;
  const showBalance = balance != null && balance !== 0;
  const owed = balance != null && balance > 0;
  const displayName = customer.name?.trim() || '(Unnamed)';

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right']}>
      <ScrollView contentContainerStyle={[styles.scroll, tabletColumnCap]}>
        <View style={styles.heroCard}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initialsOf(customer.name)}</Text>
          </View>
          <Text style={styles.name}>{displayName}</Text>
          <Text style={styles.subtitle}>Customer</Text>
          <View style={styles.heroActions}>
            <PillButton
              label="Edit"
              icon="user"
              variant="secondary"
              onPress={() => {
                haptics.light();
                navigation.navigate('CustomerEdit', {customerId: customer.id});
              }}
              accessibilityLabel={`Edit ${displayName}`}
            />
          </View>
        </View>

        <Text style={styles.sectionLabel}>Contact</Text>
        <View style={styles.card}>
          <ContactRow
            icon="mail-outline"
            label="Email"
            value={customer.email}
            onPress={
              customer.email ? () => openMail(customer.email as string) : undefined
            }
            isFirst
          />
          <ContactRow
            icon="call-outline"
            label="Phone"
            value={customer.phone}
            onPress={
              customer.phone ? () => openTel(customer.phone as string) : undefined
            }
          />
          {customer.mobile ? (
            <ContactRow
              icon="phone"
              label="Mobile"
              value={customer.mobile}
              onPress={() => openTel(customer.mobile as string)}
            />
          ) : null}
          {customer.company ? (
            <ContactRow
              icon="tag"
              label="Company"
              value={customer.company}
            />
          ) : null}
        </View>

        {showBalance ? (
          <>
            <Text style={styles.sectionLabel}>Account</Text>
            <View style={styles.balanceCard}>
              <Text style={[styles.balance, owed && styles.balanceOwed]}>
                {formatCurrency(Math.abs(balance as number))}
              </Text>
              <Text style={styles.balanceLabel}>
                {owed ? 'Owed by customer' : 'Credit on account'}
              </Text>
            </View>
          </>
        ) : null}

        {/* Account terms / lifetime stats. Each row gates on a truthy field
            so empty data doesn't read as "no purchases" (null vs zero are
            different stories). Section hides entirely when nothing is set. */}
        {(() => {
          const termRows: Array<{label: string; value: string}> = [];
          if (customer.customer_number) {
            termRows.push({label: 'Customer #', value: customer.customer_number});
          }
          if (customer.payment_terms) {
            termRows.push({label: 'Payment terms', value: customer.payment_terms});
          }
          if (customer.credit_limit_cents != null && customer.credit_limit_cents > 0) {
            termRows.push({
              label: 'Credit limit',
              value: formatCurrency(customer.credit_limit_cents),
            });
          }
          if (customer.loyalty_points != null && customer.loyalty_points > 0) {
            termRows.push({
              label: 'Loyalty points',
              value: `${customer.loyalty_points} pts`,
            });
          }
          if (customer.total_orders != null && customer.total_orders > 0) {
            termRows.push({
              label: 'Lifetime orders',
              value: String(customer.total_orders),
            });
          }
          if (customer.total_spent_cents != null && customer.total_spent_cents > 0) {
            termRows.push({
              label: 'Lifetime spend',
              value: formatCurrency(customer.total_spent_cents),
            });
          }
          if (customer.last_purchase_date) {
            const formatted = formatShortDate(customer.last_purchase_date);
            if (formatted !== '') {
              termRows.push({label: 'Last purchase', value: formatted});
            }
          }
          if (termRows.length === 0) return null;
          return (
            <>
              <Text style={styles.sectionLabel}>Account terms</Text>
              <View style={styles.card}>
                {termRows.map((row, idx) => (
                  <TermsRow
                    key={row.label}
                    label={row.label}
                    value={row.value}
                    isFirst={idx === 0}
                  />
                ))}
              </View>
            </>
          );
        })()}

        {customer.notes?.trim() ? (
          <>
            <Text style={styles.sectionLabel}>Notes</Text>
            <View style={styles.card}>
              <Text style={styles.notesBody}>{customer.notes.trim()}</Text>
            </View>
          </>
        ) : null}

        <Text style={styles.sectionLabel}>Activity</Text>
        {customer.recent_sales.length > 0 ? (
          <View style={styles.card}>
            {customer.recent_sales.map((s, idx) => (
              <TouchableOpacity
                key={s.id}
                activeOpacity={0.7}
                onPress={() => goToSale(s.id)}
                accessibilityRole="button"
                accessibilityLabel={`Sale ${s.sale_number}, ${formatCurrency(s.total_cents)}, ${s.status}. Tap to view.`}
                style={[
                  styles.activityRow,
                  idx > 0 && styles.activityRowDivider,
                ]}>
                <View style={styles.activityLeft}>
                  <Text style={styles.activitySaleNumber}>{s.sale_number}</Text>
                  <Text style={styles.activitySaleDate}>
                    {formatShortDate(s.created_at)}
                  </Text>
                </View>
                <View style={styles.activityRight}>
                  <Text style={styles.activityAmount}>
                    {formatCurrency(s.total_cents)}
                  </Text>
                  <View
                    style={[
                      styles.activityStatusChip,
                      {backgroundColor: statusColor(s.status)},
                    ]}>
                    <Text style={styles.activityStatusText}>{s.status}</Text>
                  </View>
                </View>
                <Icon
                  name="chevron-forward"
                  size={16}
                  color={COLORS.textDim}
                  style={styles.activityChevron}
                />
              </TouchableOpacity>
            ))}
          </View>
        ) : (
          <View style={styles.placeholderCard}>
            <Icon
              name="time-outline"
              size={20}
              color={COLORS.textMuted}
              style={styles.placeholderIcon}
            />
            <View style={styles.placeholderTextWrap}>
              <Text style={styles.placeholderTitle}>No recent activity</Text>
              <Text style={styles.placeholderBody}>
                This customer&apos;s recent transactions will appear here.
              </Text>
            </View>
          </View>
        )}

        {isRepairsEnabled ? (
          <>
            <Text style={styles.sectionLabel}>
              {`Repairs${
                !repairsError && repairsTotal != null
                  ? ` (${repairsTotal})`
                  : ''
              }`}
            </Text>
            {repairsError ? (
              <View style={styles.placeholderCard}>
                <Icon
                  name="cloud-offline-outline"
                  size={20}
                  color={COLORS.textMuted}
                  style={styles.placeholderIcon}
                />
                <View style={styles.placeholderTextWrap}>
                  <Text style={styles.placeholderTitle}>
                    Repairs unavailable
                  </Text>
                  <Text style={styles.placeholderBody}>
                    We couldn&apos;t load repairs for this customer right now.
                  </Text>
                </View>
              </View>
            ) : recentRepairs == null ? (
              <View style={styles.placeholderCard}>
                <ActivityIndicator color={COLORS.accent} size="small" />
                <View style={styles.placeholderTextWrap}>
                  <Text style={styles.placeholderBody}>
                    Loading repairs...
                  </Text>
                </View>
              </View>
            ) : recentRepairs.length === 0 ? (
              <View style={styles.placeholderCard}>
                <Icon
                  name="construct-outline"
                  size={20}
                  color={COLORS.textMuted}
                  style={styles.placeholderIcon}
                />
                <View style={styles.placeholderTextWrap}>
                  <Text style={styles.placeholderTitle}>No repairs on file</Text>
                  <Text style={styles.placeholderBody}>
                    No repairs on file for this customer.
                  </Text>
                </View>
              </View>
            ) : (
              <>
                <View style={styles.card}>
                  {recentRepairs.slice(0, 3).map((r, idx) => {
                    const issueSnippet = (r.issue_description || '').trim();
                    return (
                      <TouchableOpacity
                        key={r.id}
                        activeOpacity={0.7}
                        onPress={() => goToRepair(r.id)}
                        accessibilityRole="button"
                        accessibilityLabel={`Repair ${r.repair_number}, ${repairStatusLabel(r.status)}. Tap to view.`}
                        style={[
                          styles.activityRow,
                          idx > 0 && styles.activityRowDivider,
                        ]}>
                        <View style={styles.activityLeft}>
                          <Text style={styles.activitySaleNumber}>
                            {r.repair_number}
                          </Text>
                          {issueSnippet ? (
                            <Text
                              style={styles.activitySaleDate}
                              numberOfLines={1}>
                              {issueSnippet}
                            </Text>
                          ) : null}
                        </View>
                        <View style={styles.activityRight}>
                          <View
                            style={[
                              styles.activityStatusChip,
                              {backgroundColor: repairStatusColor(r.status)},
                            ]}>
                            <Text style={styles.activityStatusText}>
                              {repairStatusLabel(r.status)}
                            </Text>
                          </View>
                        </View>
                        <Icon
                          name="chevron-forward"
                          size={16}
                          color={COLORS.textDim}
                          style={styles.activityChevron}
                        />
                      </TouchableOpacity>
                    );
                  })}
                </View>
                <TouchableOpacity
                  onPress={goToRepairsList}
                  accessibilityRole="button"
                  accessibilityLabel={`View all repairs for ${displayName}`}
                  style={styles.viewAllRow}
                  hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}>
                  <Text style={styles.viewAllText}>View all repairs</Text>
                  <Icon
                    name="chevron-forward"
                    size={16}
                    color={COLORS.accent}
                  />
                </TouchableOpacity>
              </>
            )}
          </>
        ) : null}

        {(customer.default_address || customer.addresses.length > 0) ? (
          <>
            <Text style={styles.sectionLabel}>Addresses</Text>
            {customer.default_address ? (
              <View style={styles.addressDefault}>
                <View style={styles.addressBadgeRow}>
                  <Text style={styles.addressBadge}>Default</Text>
                  {customer.default_address.label ? (
                    <Text style={styles.addressLabel}>
                      {customer.default_address.label}
                    </Text>
                  ) : null}
                </View>
                <Text style={styles.addressLines}>
                  {renderAddressLines(customer.default_address)}
                </Text>
              </View>
            ) : null}
            {customer.addresses
              .filter(a => {
                // Reference-equality alone misses the common case where the
                // API returns `default_address` as a separate object whose
                // id matches an entry in `addresses` — the two are different
                // JS objects, so `!==` always passes and the default address
                // is rendered a second time below. Compare by id when
                // available; fall back to reference equality for unsaved
                // addresses (id may be null per the Address shape).
                if (!customer.default_address) return true;
                const d = customer.default_address;
                if (typeof a.id === 'number' && typeof d.id === 'number') {
                  return a.id !== d.id;
                }
                return a !== d;
              })
              .map((a, idx) => (
                <View key={a.id ?? idx} style={styles.addressOther}>
                  {a.label ? (
                    <Text style={styles.addressLabel}>{a.label}</Text>
                  ) : null}
                  <Text style={styles.addressLines}>
                    {renderAddressLines(a)}
                  </Text>
                </View>
              ))}
          </>
        ) : null}

        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => {
            haptics.light();
            // Cross-tab breadcrumb-aware back. If we were reached from
            // another tab (e.g. SaleDetail → CustomerDetail), pop that
            // crumb and navigate back there. Otherwise fall through to
            // the native within-stack pop.
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
          }}
          accessibilityRole="button"
          accessibilityLabel="Go back">
          <Icon
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

const TermsRow: React.FC<{
  label: string;
  value: string;
  isFirst?: boolean;
}> = ({label, value, isFirst}) => (
  <View style={[styles.termsRow, !isFirst && styles.termsRowDivider]}>
    <Text style={styles.termsLabel}>{label}</Text>
    <Text style={styles.termsValue}>{value}</Text>
  </View>
);

const ContactRow: React.FC<{
  icon: React.ComponentProps<typeof Icon>['name'];
  label: string;
  value: string | null;
  onPress?: () => void;
  isFirst?: boolean;
}> = ({icon, label, value, onPress, isFirst}) => {
  const inner = (
    <View style={[styles.contactRow, !isFirst && styles.contactRowDivider]}>
      <View style={styles.contactIconWrap}>
        <Icon name={icon} size={18} color={COLORS.crimson} />
      </View>
      <View style={styles.contactTextWrap}>
        <Text style={styles.contactLabel}>{label}</Text>
        <Text
          style={[
            styles.contactValue,
            value ? styles.contactValueLink : styles.contactValueEmpty,
          ]}
          numberOfLines={1}>
          {value || ''}
        </Text>
      </View>
      {onPress ? (
        <Icon
          name="chevron-forward"
          size={16}
          color={COLORS.textDim}
        />
      ) : null}
    </View>
  );
  if (onPress) {
    return (
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`${label}${value ? `, ${value}` : ''}`}>
        {inner}
      </TouchableOpacity>
    );
  }
  return inner;
};

const cardBase = {
  backgroundColor: COLORS.surface,
  borderWidth: 1,
  borderColor: COLORS.surfaceBorder,
  borderRadius: BORDER_RADIUS.lg,
  marginBottom: SPACING.md,
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
  heroCard: {
    ...cardBase,
    padding: SPACING.lg,
    alignItems: 'center',
  },
  heroActions: {
    marginTop: SPACING.md,
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: BORDER_RADIUS.full,
    backgroundColor: COLORS.cream,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.sm,
    borderWidth: 1,
    borderColor: COLORS.surfaceBorder,
  },
  avatarText: {
    color: COLORS.crimson,
    fontSize: FONT_SIZE.xxl,
    fontFamily: FONT_FAMILY.bold,
    letterSpacing: 0.5,
  },
  name: {
    color: COLORS.text,
    fontSize: FONT_SIZE.xl,
    fontFamily: FONT_FAMILY.bold,
    letterSpacing: -0.3,
    textAlign: 'center',
  },
  subtitle: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.sm,
    fontFamily: FONT_FAMILY.medium,
    marginTop: SPACING.xs,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  sectionLabel: {
    fontSize: FONT_SIZE.sm,
    fontFamily: FONT_FAMILY.medium,
    color: COLORS.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: SPACING.sm,
  },
  card: {
    ...cardBase,
    paddingHorizontal: SPACING.md,
  },
  notesBody: {
    fontSize: FONT_SIZE.md,
    fontFamily: FONT_FAMILY.regular,
    color: COLORS.text,
    lineHeight: 22,
    paddingVertical: SPACING.md,
  },
  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: SPACING.md,
  },
  contactRowDivider: {
    borderTopWidth: 1,
    borderTopColor: COLORS.surfaceBorder,
  },
  contactIconWrap: {
    width: 36,
    height: 36,
    borderRadius: BORDER_RADIUS.full,
    backgroundColor: COLORS.cream,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: SPACING.md,
  },
  contactTextWrap: {flex: 1},
  contactLabel: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.xs,
    fontFamily: FONT_FAMILY.medium,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  contactValue: {
    fontSize: FONT_SIZE.md,
    fontFamily: FONT_FAMILY.medium,
    marginTop: 2,
  },
  contactValueLink: {color: COLORS.text},
  contactValueEmpty: {color: COLORS.textDim, fontFamily: FONT_FAMILY.medium},
  balanceCard: {
    ...cardBase,
    padding: SPACING.lg,
    alignItems: 'center',
  },
  balance: {
    fontSize: FONT_SIZE.title,
    fontFamily: FONT_FAMILY.bold,
    color: COLORS.text,
    letterSpacing: -0.5,
  },
  balanceOwed: {color: COLORS.crimson},
  balanceLabel: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.sm,
    fontFamily: FONT_FAMILY.medium,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: SPACING.xs,
  },
  placeholderCard: {
    ...cardBase,
    // cardBase already sets backgroundColor: surface (white). Don't override
    // to cream — the body bg is now Clermont Cream per Brand Guidelines §04
    // and a cream card on a cream body loses all distinction.
    flexDirection: 'row',
    padding: SPACING.md,
    borderColor: COLORS.surfaceBorder,
  },
  placeholderIcon: {marginRight: SPACING.sm, marginTop: 2},
  placeholderTextWrap: {flex: 1},
  placeholderTitle: {
    color: COLORS.text,
    fontSize: FONT_SIZE.md,
    fontFamily: FONT_FAMILY.medium,
    marginBottom: 2,
  },
  placeholderBody: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.sm,
    lineHeight: 20,
  },
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
  termsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: SPACING.md,
  },
  termsRowDivider: {
    borderTopWidth: 1,
    borderTopColor: COLORS.surfaceBorder,
  },
  termsLabel: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.sm,
    fontFamily: FONT_FAMILY.medium,
  },
  termsValue: {
    color: COLORS.text,
    fontSize: FONT_SIZE.md,
    fontFamily: FONT_FAMILY.medium,
  },
  activityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.md,
  },
  activityRowDivider: {
    borderTopWidth: 1,
    borderTopColor: COLORS.surfaceBorder,
  },
  activityLeft: {flex: 1},
  activitySaleNumber: {
    color: COLORS.text,
    fontSize: FONT_SIZE.md,
    fontFamily: FONT_FAMILY.medium,
  },
  activitySaleDate: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.xs,
    marginTop: 2,
  },
  activityRight: {alignItems: 'flex-end', marginRight: SPACING.sm},
  activityAmount: {
    color: COLORS.text,
    fontSize: FONT_SIZE.md,
    fontFamily: FONT_FAMILY.bold,
    marginBottom: 4,
  },
  activityStatusChip: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: 2,
    borderRadius: BORDER_RADIUS.full,
  },
  activityStatusText: {
    color: COLORS.white,
    fontSize: FONT_SIZE.xs,
    fontFamily: FONT_FAMILY.medium,
    textTransform: 'capitalize',
  },
  activityChevron: {marginLeft: 4},
  viewAllRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingVertical: SPACING.sm,
    marginTop: -SPACING.xs,
    marginBottom: SPACING.md,
    gap: SPACING.xs,
  },
  viewAllText: {
    color: COLORS.accent,
    fontSize: FONT_SIZE.sm,
    fontFamily: FONT_FAMILY.medium,
  },
  addressDefault: {
    ...cardBase,
    padding: SPACING.md,
  },
  addressOther: {
    ...cardBase,
    padding: SPACING.md,
    // Don't override cardBase's white surface — body bg is Clermont Cream
    // (post-v1.3.19 brand pass) so a cream-on-cream card would disappear.
    // The "Default" badge above the first address is the differentiator.
  },
  addressBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: SPACING.xs,
    gap: SPACING.sm,
  },
  addressBadge: {
    color: COLORS.white,
    backgroundColor: COLORS.crimson,
    fontSize: FONT_SIZE.xs,
    fontFamily: FONT_FAMILY.bold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 2,
    borderRadius: BORDER_RADIUS.full,
    overflow: 'hidden',
  },
  addressLabel: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.xs,
    fontFamily: FONT_FAMILY.medium,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  addressLines: {
    color: COLORS.text,
    fontSize: FONT_SIZE.md,
    lineHeight: 22,
    marginTop: 2,
  },
});
