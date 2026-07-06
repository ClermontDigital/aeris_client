import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {
  useFocusEffect,
  useNavigation,
  useRoute,
} from '@react-navigation/native';
import type {RouteProp} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import Icon from '../components/Icon';
import EmptyState from '../components/EmptyState';
import ErrorBanner from '../components/ErrorBanner';
import PillButton from '../components/PillButton';
import KeyboardDoneAccessory from '../components/KeyboardDoneAccessory';
import ApiClient from '../services/ApiClient';
import {RelayError} from '@aeris/shared';
import {useHaptics} from '../hooks/useHaptics';
import {useResponsiveLayout} from '../hooks/useResponsiveLayout';
import {useAuthStore} from '../stores/authStore';
import {useCartStore} from '../stores/cartStore';
import {useHeaderBackStore} from '../stores/headerBackStore';
import {useNavHistoryStore, type CrumbTab} from '../stores/navHistoryStore';
import {useWorkspaceFeaturesStore} from '../stores/workspaceFeaturesStore';
import type {
  Product,
  RepairDetail,
  RepairItem,
  RepairStatus,
  RepairStatusHistory,
} from '../types/api.types';
import type {RepairsStackParamList} from '../types/navigation.types';
import {
  BORDER_RADIUS,
  COLORS,
  FONT_FAMILY,
  FONT_SIZE,
  ICON_SIZE,
  SPACING,
} from '../constants/theme';

// iOS keyboard-accessory id for the WSA-3 add-note textarea (multiline has
// no return key to dismiss the keyboard).
const REPAIR_NOTE_INPUT_BAR = 'repair-note-input-bar';

type Nav = NativeStackNavigationProp<RepairsStackParamList, 'RepairDetail'>;
type RepairDetailRouteProp = RouteProp<RepairsStackParamList, 'RepairDetail'>;

// ===========================================================================
// T10 - Known caveats (consolidated from T7 + T8 inline notes).
//
// The DR-M3 deployment sitrep flagged three server-side behaviours that this
// screen has to work around. Each was noted inline at the point it mattered
// during T7/T8; T10 consolidates them here so a new agent lands on one block
// and does not have to reverse-engineer them from scattered comments.
//
// 1. NON-READY CHECKOUT SILENT NO-OP
//    Server silently no-ops the completion side-effect when the repair is
//    not in `ready` status at the moment CompleteSale runs. Client guards
//    at TWO points to avoid ever exercising that path:
//      a. Checkout button only renders when repair.status === 'ready'
//         (see the T8 slot below the action row).
//      b. handleRepairCheckout re-fetches the repair one more time inside
//         the Confirm handler and re-verifies status === 'ready' before
//         handing the cart to CheckoutScreen. Mirrors the belt-and-braces
//         pattern on CheckoutScreen.handleCompleteSale.
//    If both guards were ever bypassed, no data loss occurs - the sale
//    still lands - but the repair status would not flip to `completed` and
//    would have to be reconciled manually from the repairs list.
//
// 2. STOCK NOT DECREMENTED ON REPAIR CHECKOUT
//    Repair checkout does NOT decrement stock in this release: parts are
//    reserved at intake time (server-side), so double-decrementing at
//    checkout would drift inventory. The Confirm alert copy reads
//    "Parts reserved at intake." to make this legible to cashiers. If
//    intake never happened (edge: cash-only repair with no parts row),
//    stock remains untouched.
//
// 3. CUSTOMER SYNC NOTIFICATION UNCERTAINTY
//    Customer SMS/email notification on status change may or may not fire -
//    the send-manual-notification ability gate and per-tenant notification
//    templates live server-side and are not queryable from the client. The
//    refetch-on-focus effect below reconciles the timeline card whenever
//    the screen regains focus, so if the notification did fire the delivery
//    row will show up on the next visit. The "Notify customer" action-row
//    entry is now wired (WSA-4) to the `repairs.notify` action with the
//    only v1 template `repair_status`; marketplace dispatcher whitelist
//    confirmation is owned by the deployment team, so a server-side
//    NOT_FOUND / 403 surfaces directly in the failure Alert rather than
//    a silent no-op.
//
// See also mobile/src/utils/repairsBulkStatus.ts for the parallel caveats
// on the bulk-status endpoint (surfaced by the future BulkStatusScreen).
// ===========================================================================

// Timestamps on the repair wire arrive as ISO 8601 strings. Match the
// SaleDetail formatter so timestamps read consistently across the app.
function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Local mirror of the RepairsListScreen colour map. Kept inline rather
// than exported so we don't churn the list screen just for T6 - a shared
// StatusChip primitive is a follow-up cleanup candidate (see codebase
// audit in the T6 planning notes).
function getRepairStatusColor(status: RepairStatus): string {
  switch (status) {
    case 'pending':
      return COLORS.blue;
    case 'diagnosed':
      return COLORS.blue;
    case 'in_progress':
      return COLORS.warning;
    case 'waiting_parts':
      return COLORS.danger;
    case 'ready':
      return COLORS.success;
    case 'completed':
      return COLORS.successDark;
    case 'cancelled':
      return COLORS.textDim;
    default:
      return COLORS.textDim;
  }
}

// Wire enums use underscores; render as human-friendly labels.
function getRepairStatusLabel(status: RepairStatus): string {
  switch (status) {
    case 'in_progress':
      return 'In progress';
    case 'waiting_parts':
      return 'Waiting parts';
    default:
      return status.charAt(0).toUpperCase() + status.slice(1);
  }
}

// Priority chip only appears for non-normal priorities. Capitalise the
// wire value for display; colour follows a rough severity scale.
function getPriorityColor(priority: string): string {
  switch (priority) {
    case 'urgent':
      return COLORS.danger;
    case 'high':
      return COLORS.warning;
    case 'low':
      return COLORS.textDim;
    default:
      return COLORS.textMuted;
  }
}

function formatPriorityLabel(priority: string): string {
  if (!priority) return '';
  return priority.charAt(0).toUpperCase() + priority.slice(1);
}

// Money on the repair wire travels as dollar floats (see
// shared/src/types/api.types.ts §Repair). Format with 2 decimals; no
// cents conversion.
function formatDollars(v: number | null | undefined): string {
  if (v == null) return '';
  return '$' + v.toFixed(2);
}

// Deployment sitrep permission for the "Notify customer" action row entry.
// The User shape in shared/src/types/api.types.ts does not yet declare a
// `permissions` array; the deployment team owes an AuthResponse extension
// that surfaces the Sanctum ability list (see the DR-M3 sitrep). We read
// it defensively via a soft cast so a login response that DOES carry the
// array lights the button up automatically, and a login response that
// doesn't leaves the button hidden - the safe posture. Server is still
// the source of truth; this UI gate is just a kindness so cashiers
// without the ability don't see a button they'd 403 on. Mirrors the
// SaleDetailScreen role-check pattern (server enforces, client hints).
function userHasPermission(
  user: {permissions?: unknown} | null | undefined,
  perm: string,
): boolean {
  if (!user) return false;
  const perms = (user as {permissions?: unknown}).permissions;
  if (!Array.isArray(perms)) return false;
  return perms.some(p => typeof p === 'string' && p === perm);
}

const RepairDetailScreen: React.FC = () => {
  const navigation = useNavigation<Nav>();
  const route = useRoute<RepairDetailRouteProp>();
  const haptics = useHaptics();
  const {isTablet} = useResponsiveLayout();
  const tabletColumnCap = isTablet
    ? ({maxWidth: 720, alignSelf: 'center', width: '100%'} as const)
    : null;
  const {id: repairId} = route.params;

  // Pull the current user for the action-row permission gate on
  // "Notify customer". Kept above the early-return guards per
  // feedback_hooks_above_early_returns. The soft cast to
  // `{permissions?: unknown}` is because the shared User type doesn't
  // yet declare a `permissions` array - see the userHasPermission
  // comment for the deployment-side contract this anticipates.
  const user = useAuthStore(s => s.user);
  const canNotifyCustomer = userHasPermission(
    user as unknown as {permissions?: unknown} | null,
    'send-manual-notification',
  );
  // NOTE: the add-parts/labour + notes affordances are intentionally NOT gated
  // on a client permission — the repair-write ability lives in the Sanctum
  // `abilities` list (repairs:write), not the user.permissions array we can
  // read, so any client gate hid the feature for every account. The server
  // enforces the real check on the repair.* RPCs. See those sections below.

  // ---------------- state (all hooks live ABOVE the early-return guards
  // per feedback_hooks_above_early_returns; a post-guard hook crashes
  // the screen with "rendered more hooks than previous render" the
  // moment the fetch resolves). ----------------
  const [repair, setRepair] = useState<RepairDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isUnavailable, setIsUnavailable] = useState(false);
  const [notFound, setNotFound] = useState(false);

  // WSA-3 notes card local state. `noteDraft` is the current text in the
  // input; `notePosting` guards the Send button + input during the RPC. A
  // successful send calls `addRepairNote`, then appends the returned
  // status_history row to `repair.status_history` in place (fresh timeline
  // reload happens on the next useFocusEffect if the sheet stays open).
  const [noteDraft, setNoteDraft] = useState('');
  const [notePosting, setNotePosting] = useState(false);
  const notePostLockRef = useRef(false);

  // ---------------- workspace-flag mount guard ----------------
  // Belt-and-braces: if the workspace flag was flipped off mid-session or
  // restoreCache repopulated `false`, bounce out with an Alert so the
  // operator sees a signal (a silent goBack reads as a broken link).
  // Mirrors RepairsListScreen so both bounces behave identically.
  useEffect(() => {
    if (!useWorkspaceFeaturesStore.getState().repairs_enabled) {
      Alert.alert('Repairs', 'Repairs are not enabled for this site.');
      navigation.goBack();
    }
    // Intentionally mount-only; a mid-session flag flip is handled by the
    // tab conditional in AppTabs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------------- fetch ----------------
  const load = useCallback(async () => {
    // Duplicate belt on the fetch path itself so a race between the mount-
    // guard bounce and this effect can't fire an orphan getRepairDetail
    // that would then trigger a spurious REPAIRS_DISABLED toast on top of
    // the Alert. Mirrors RepairsListScreen.fetchRepairs.
    if (!useWorkspaceFeaturesStore.getState().repairs_enabled) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setIsUnavailable(false);
    setNotFound(false);
    try {
      const data = await ApiClient.getRepairDetail(repairId);
      if (data == null) {
        setNotFound(true);
      } else {
        setRepair(data);
      }
    } catch {
      setIsUnavailable(true);
    } finally {
      setIsLoading(false);
    }
  }, [repairId]);

  useEffect(() => {
    load();
  }, [load]);

  // Refetch on tab focus so a status change made on a sibling screen (T7)
  // surfaces immediately. Skip the very first focus - the mount effect
  // above already covers the initial load. Mirrors RepairsListScreen.
  const didInitialFetchRef = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (!didInitialFetchRef.current) {
        didInitialFetchRef.current = true;
        return undefined;
      }
      load();
      return undefined;
    }, [load]),
  );

  // ---------------- cross-tab navigation (breadcrumb + header back) ----
  const pushCrumb = useNavHistoryStore(s => s.push);
  const popPrev = useNavHistoryStore(s => s.popPrev);

  // Read the current parent-tab name so a cross-tab jump can point back to
  // wherever the user actually came from (not a hardcoded 'Repairs' which
  // would bounce the user to the wrong tab on deep-link entries).
  const getCurrentTab = useCallback((): CrumbTab => {
    const parent = navigation.getParent?.();
    const state = parent?.getState?.();
    const name = state?.routes?.[state.index]?.name;
    if (
      name === 'Items' ||
      name === 'Customers' ||
      name === 'Transactions' ||
      name === 'QuickSale' ||
      name === 'Dashboard' ||
      name === 'Repairs' ||
      name === 'ERP'
    ) {
      return name;
    }
    return 'Repairs';
  }, [navigation]);

  const openCustomer = useCallback(
    (id: number) => {
      haptics.light();
      const currentTab = getCurrentTab();
      // Local push when the Customers stack is already hosting us -
      // avoids a cross-tab flicker.
      if (currentTab === 'Customers') {
        (
          navigation as unknown as {
            navigate: (screen: string, params: object) => void;
          }
        ).navigate('CustomerDetail', {customerId: id});
        return;
      }
      const parent = navigation.getParent?.();
      if (!parent) return;
      pushCrumb({
        tab: currentTab,
        screen: 'RepairDetail',
        params: {id: repairId},
      });
      (
        parent as unknown as {
          navigate: (tab: string, params: object) => void;
        }
      ).navigate('Customers', {
        // initial: false APPENDS CustomerDetail onto the inner stack so a
        // subsequent Customers tab-tap can pop-to-root. See SaleDetail
        // notes for the React Navigation v7 nested-navigator semantics.
        initial: false,
        screen: 'CustomerDetail',
        params: {customerId: id},
      });
    },
    [navigation, haptics, pushCrumb, repairId, getCurrentTab],
  );

  // Back button: consult the breadcrumb trail first, fall through to
  // native stack pop. One-shot guard: reachable from BOTH the brand-header
  // Back and any in-page Back. popPrev() mutates history, so a fast
  // double-tap could over-navigate. Reset on each focus.
  const backFiredRef = useRef(false);
  const handleBack = useCallback(() => {
    if (backFiredRef.current) return;
    backFiredRef.current = true;
    haptics.light();
    const prev = popPrev();
    if (prev) {
      const parent = navigation.getParent?.();
      if (parent) {
        (
          parent as unknown as {
            navigate: (tab: string, params: object) => void;
          }
        ).navigate(prev.tab, {
          initial: false,
          screen: prev.screen,
          params: prev.params ?? {},
        });
        return;
      }
    }
    navigation.goBack();
  }, [navigation, haptics, popPrev]);

  // Surface the Back button in the shared brand header while focused.
  // beforeRemove handles the slot cleanup with an identity-matched clearIf
  // so the revealed screen's own handler never gets wiped (the v1.3.70
  // race fix - see SaleDetailScreen / ProductDetailScreen comments).
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

  // ---------------- derived values (memoised above the early returns
  // so hook count stays constant across renders) ----------------
  const items = repair?.items ?? [];
  const itemsSubtotal = useMemo(
    () => items.reduce((acc, it) => acc + (it.line_total ?? 0), 0),
    [items],
  );

  // ---------------- T8 checkout hand-off ----------------
  // Repairs flag mirrors the mount-guard; keep it above the early-return
  // guards per feedback_hooks_above_early_returns.
  const repairsEnabled = useWorkspaceFeaturesStore(s => s.repairs_enabled);

  // Belt-and-braces guard: re-fetch the repair one more time before we hand
  // the cart off to Checkout so a status drift between render and tap
  // can't slip a non-ready repair through. Mirrors the second guard on
  // CheckoutScreen.handleCompleteSale — never trust the server to reject.
  // Materialises the cart from repair items (dollar → cent conversion at
  // the boundary; parts reserved at intake so we do NOT decrement stock
  // here per the DR-M3 deployment sitrep) and cross-tab-nav to Cart.
  const handleRepairCheckout = useCallback(() => {
    if (!repair) return;
    Alert.alert(
      'Take payment for repair',
      'Parts reserved at intake. Ready to take payment?',
      [
        {text: 'Cancel', style: 'cancel'},
        {
          text: 'Confirm',
          onPress: async () => {
            try {
              // Fresh re-fetch — repair may have flipped status since the
              // page rendered.
              const fresh = await ApiClient.getRepairDetail(repair.id);
              if (!fresh || fresh.status !== 'ready') {
                haptics.error();
                Alert.alert(
                  'Repair no longer ready for checkout.',
                  'Its status has changed since you opened this page.',
                );
                return;
              }
              // T8 STOCK CONTRACT (deployment-team-confirmed):
              //  * PARTS: land on the sale with REAL product_id so
              //    POSController::processSale's Product::findOrFail passes
              //    and the server's C1/C2 side-effect releases the
              //    reservation + decrements stock_reserved cleanly.
              //  * LABOUR: uses a synthetic product_id in the range
              //    <= -600000 (`-600000 - ri.id`). The server sale
              //    validator whitelists this range so labour lines pass
              //    without a Product row.
              // BOTH set tax_rate: 10 so the wire encoder emits
              // `gst_applicable: true` per line (per T8-C1: subtotal is
              // sum(lineTotal/1.10) for gst-applicable + sum(lineTotal)
              // otherwise). Repair items are quoted GST-inclusive, so this
              // simply extracts the embedded GST — no double-tax.
              const cart = useCartStore.getState();
              // Clear any pre-existing cart so a mixed retail + repair
              // basket doesn't accidentally carry across into the sale.
              cart.clear();
              if (fresh.customer) {
                cart.setCustomer(fresh.customer.id, fresh.customer.name);
              }
              fresh.items.forEach(ri => {
                const isLabour =
                  ri.item_type === 'labor' || ri.product_id == null;
                const synthId = isLabour ? -600000 - ri.id : ri.product_id!;
                const synth: Product = {
                  id: synthId,
                  name: ri.item_name,
                  sku: ri.item_sku ?? '',
                  barcode: null,
                  price_cents: Math.round(ri.unit_price * 100),
                  tax_rate: 10,
                  stock_on_hand: 0,
                  category_id: null,
                  category_name: null,
                  image_url: null,
                  is_active: true,
                };
                cart.addItem(synth, ri.quantity);
              });
              cart.setRepairId(fresh.id);
              cart.setRepairNumber(fresh.repair_number);

              const parent = navigation.getParent?.();
              if (parent) {
                (
                  parent as unknown as {
                    navigate: (tab: string, params: object) => void;
                  }
                ).navigate('QuickSale', {
                  initial: false,
                  screen: 'Cart',
                });
              }
            } catch {
              haptics.error();
              Alert.alert(
                'Could not open checkout',
                'Please check your connection and try again.',
              );
            }
          },
        },
      ],
    );
  }, [repair, navigation, haptics]);

  // ---------------- WSA-4 notify customer ----------------
  // Confirm-then-send flow: server routes through the ability-gated
  // notification pipeline using the ONLY v1 template ('repair_status').
  // The confirm copy names the customer + the current status label so the
  // cashier can eyeball what the customer is about to receive before
  // committing. On failure we surface the server error verbatim rather
  // than swallowing it — the operator needs to know the customer was NOT
  // messaged (dispatcher whitelist rollout is deployment-team-owned).
  const handleNotifyCustomer = useCallback(() => {
    if (!repair) return;
    const customerLabel = repair.customer?.name ?? 'the customer';
    const statusLabel = getRepairStatusLabel(repair.status);
    Alert.alert(
      `Notify ${customerLabel}?`,
      `They will receive a message about the current repair status (${statusLabel}).`,
      [
        {text: 'Cancel', style: 'cancel'},
        {
          text: 'Send',
          onPress: async () => {
            try {
              await ApiClient.sendRepairNotification(repair.id, {
                template: 'repair_status',
              });
              haptics.success();
              Alert.alert('Notification sent');
            } catch (err) {
              haptics.error();
              const msg =
                err instanceof Error && err.message
                  ? err.message
                  : 'Please try again.';
              Alert.alert('Could not send notification', msg);
            }
          },
        },
      ],
    );
  }, [repair, haptics]);

  // WSA-3 add-note handler. Posts via ApiClient.addRepairNote (server
  // validates <=2000, RelayClient duplicate-strips before the RPC). On
  // success, appends the returned status_history row to the local timeline
  // in place — no full refetch — and clears the draft. The useFocusEffect
  // above will re-reconcile if the sheet stays open long enough for
  // another tab to add a competing row.
  const handleAddNote = useCallback(async () => {
    if (notePostLockRef.current) return;
    if (!repair) return;
    const trimmed = noteDraft.trim();
    if (trimmed.length === 0) return;
    if (trimmed.length > 2000) {
      Alert.alert('Note too long', 'Notes are limited to 2000 characters.');
      return;
    }
    notePostLockRef.current = true;
    setNotePosting(true);
    try {
      const newRow = await ApiClient.addRepairNote(repair.id, trimmed);
      haptics.success();
      setRepair(prev =>
        prev
          ? {...prev, status_history: [...prev.status_history, newRow]}
          : prev,
      );
      setNoteDraft('');
      // Dismiss the keyboard on success so the freshly-appended timeline row
      // is visible without the keyboard covering it.
      Keyboard.dismiss();
    } catch (e) {
      haptics.error();
      const msg =
        e instanceof RelayError
          ? e.message
          : e instanceof Error
            ? e.message
            : 'Failed to add note.';
      Alert.alert('Note failed', msg);
    } finally {
      notePostLockRef.current = false;
      setNotePosting(false);
    }
  }, [repair, noteDraft, haptics]);

  // ---------------- early-return guards (all hooks are declared above) --
  if (isLoading) {
    return (
      <SafeAreaView style={styles.container} edges={['left', 'right']}>
        <View style={styles.center}>
          <ActivityIndicator color={COLORS.accent} size="large" />
          <Text style={styles.loadingText}>Loading repair…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (isUnavailable) {
    return (
      <SafeAreaView style={styles.container} edges={['left', 'right']}>
        <View style={styles.errorWrap}>
          <ErrorBanner
            message="Repair detail is not available right now. Please try again in a moment."
            onRetry={() => {
              haptics.light();
              load();
            }}
          />
        </View>
        <View style={styles.center}>
          <TouchableOpacity
            onPress={() => {
              haptics.light();
              navigation.goBack();
            }}
            accessibilityRole="button"
            accessibilityLabel="Back">
            <Text style={styles.linkText}>Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (notFound || !repair) {
    return (
      <SafeAreaView style={styles.container} edges={['left', 'right']}>
        <EmptyState
          icon="construct-outline"
          title="Repair not found"
          description="Repair not found or was deleted"
          action={{
            label: 'Back',
            onPress: () => {
              haptics.light();
              navigation.goBack();
            },
          }}
        />
      </SafeAreaView>
    );
  }

  // ---------------- derived display values (rendered only when repair is
  // present - plain locals, not hooks, so they don't affect hook count) ---
  const customer = repair.customer;
  const customerLine = customer?.name ?? 'Walk-in / Unspecified';
  const priorityShown =
    repair.priority && repair.priority !== 'normal' ? repair.priority : null;

  const deviceFields: {label: string; value: string}[] = [];
  if (repair.device_type)
    deviceFields.push({label: 'Type', value: repair.device_type});
  if (repair.brand) deviceFields.push({label: 'Brand', value: repair.brand});
  if (repair.model) deviceFields.push({label: 'Model', value: repair.model});
  if (repair.serial_number)
    deviceFields.push({label: 'Serial', value: repair.serial_number});

  const hasCosts = repair.estimated_cost != null || repair.final_cost != null;

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right']}>
      <ScrollView
        contentContainerStyle={[styles.scroll, tabletColumnCap]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag">
        {/* -------- Header: title + status chip + assignment strip -------- */}
        <View style={styles.card}>
          <View style={styles.headerRow}>
            <View style={styles.headerLeft}>
              <Text style={styles.repairNumber}>
                Repair {repair.repair_number}
              </Text>
              <Text style={styles.receivedLine}>
                Received {formatDateTime(repair.received_at ?? repair.created_at)}
              </Text>
              <Text style={styles.assignedLine}>
                {repair.assigned_to_name
                  ? `Assigned to ${repair.assigned_to_name}`
                  : 'Unassigned'}
              </Text>
            </View>
            <View style={styles.headerChips}>
              <View
                style={[
                  styles.statusChip,
                  {backgroundColor: getRepairStatusColor(repair.status)},
                ]}
                accessibilityLabel={`Status: ${getRepairStatusLabel(repair.status)}`}>
                <Text style={styles.statusText}>
                  {getRepairStatusLabel(repair.status)}
                </Text>
              </View>
              {priorityShown ? (
                <View
                  style={[
                    styles.priorityChip,
                    {backgroundColor: getPriorityColor(priorityShown)},
                  ]}
                  accessibilityLabel={`Priority: ${formatPriorityLabel(priorityShown)}`}>
                  <Text style={styles.priorityText}>
                    {formatPriorityLabel(priorityShown)}
                  </Text>
                </View>
              ) : null}
            </View>
          </View>
        </View>

        {/* -------- Customer -------- */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Customer</Text>
          {customer ? (
            <>
              <TouchableOpacity
                style={styles.row}
                onPress={() => openCustomer(customer.id)}
                accessibilityRole="link"
                accessibilityLabel={`Customer ${customerLine}. Tap to open profile.`}>
                <Text style={styles.rowLabel}>Name</Text>
                <View style={styles.rowValueWithChevron}>
                  <Text style={[styles.rowValue, styles.rowValueLink]}>
                    {customerLine}
                  </Text>
                  <Icon
                    name="chevron-forward"
                    size={ICON_SIZE.action}
                    color={COLORS.crimson}
                  />
                </View>
              </TouchableOpacity>
              {customer.email ? (
                <View style={styles.row}>
                  <Text style={styles.rowLabel}>Email</Text>
                  <Text style={styles.rowValue}>{customer.email}</Text>
                </View>
              ) : null}
              {customer.phone ? (
                <View style={styles.row}>
                  <Text style={styles.rowLabel}>Phone</Text>
                  <Text style={styles.rowValue}>{customer.phone}</Text>
                </View>
              ) : null}
            </>
          ) : (
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Name</Text>
              <Text style={styles.rowValue}>Walk-in / Unspecified</Text>
            </View>
          )}
        </View>

        {/* -------- Device -------- */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Device</Text>
          {deviceFields.length === 0 ? (
            <Text style={styles.emptyText}>No device details recorded</Text>
          ) : (
            deviceFields.map(f => (
              <View key={f.label} style={styles.row}>
                <Text style={styles.rowLabel}>{f.label}</Text>
                <Text style={styles.rowValue}>{f.value}</Text>
              </View>
            ))
          )}
        </View>

        {/* -------- Issue / Diagnosis / Notes -------- */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Reported issue</Text>
          <Text style={styles.body}>
            {repair.issue_description || 'No issue description recorded'}
          </Text>
          {repair.diagnosis ? (
            <View style={styles.subBlock}>
              <Text style={styles.subTitle}>Diagnosis</Text>
              <Text style={styles.body}>{repair.diagnosis}</Text>
            </View>
          ) : null}
          {repair.notes ? (
            <View style={styles.subBlock}>
              <Text style={styles.subTitle}>Notes</Text>
              <Text style={styles.body}>{repair.notes}</Text>
            </View>
          ) : null}
        </View>

        {/* -------- Costs -------- */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Costs</Text>
          {!hasCosts ? (
            <Text style={styles.emptyText}>No quote yet</Text>
          ) : (
            <>
              {repair.estimated_cost != null ? (
                <View style={styles.row}>
                  <Text style={styles.rowLabel}>Estimate</Text>
                  <Text style={styles.rowValue}>
                    {formatDollars(repair.estimated_cost)}
                  </Text>
                </View>
              ) : null}
              {repair.final_cost != null ? (
                <View style={styles.row}>
                  <Text style={styles.rowLabel}>Final</Text>
                  <Text style={styles.rowValue}>
                    {formatDollars(repair.final_cost)}
                  </Text>
                </View>
              ) : null}
            </>
          )}
        </View>

        {/* -------- Parts & Labour -------- */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Parts &amp; Labour</Text>
          {items.length === 0 ? (
            <Text style={styles.emptyText}>
              No items yet — tap “Add part or labour” below.
            </Text>
          ) : (
            <>
              {items.map((item: RepairItem) => (
                <View key={item.id} style={styles.itemRow}>
                  <View style={styles.itemLeft}>
                    <View style={styles.itemNameLine}>
                      <Text style={styles.itemName} numberOfLines={2}>
                        {item.item_name}
                      </Text>
                      <View
                        style={[
                          styles.itemTypeChip,
                          item.item_type === 'labor'
                            ? styles.itemTypeChipLabor
                            : styles.itemTypeChipPart,
                        ]}>
                        <Text style={styles.itemTypeText}>
                          {item.item_type === 'labor' ? 'Labor' : 'Part'}
                        </Text>
                      </View>
                    </View>
                    <Text style={styles.itemMeta}>
                      {item.quantity} × {formatDollars(item.unit_price)}
                    </Text>
                  </View>
                  <Text style={styles.itemTotal}>
                    {formatDollars(item.line_total)}
                  </Text>
                </View>
              ))}
              <View style={[styles.totalRow, styles.subtotalRow]}>
                <Text style={styles.subtotalLabel}>Subtotal</Text>
                <Text style={styles.subtotalValue}>
                  {formatDollars(itemsSubtotal)}
                </Text>
              </View>
            </>
          )}
          {/* Primary add affordance lives ON the section (not buried in the
              action row). Opens the items editor — search stock parts, add
              labour, metered quantities. UNCONDITIONAL: the repair-write
              ability lives in the Sanctum `abilities` list (repairs:write),
              NOT the user.permissions array the client can read, so gating on
              a client permission hid this for every account. The server
              enforces the real check on repair.add-item (403 → surfaced in
              the editor); the whole screen is already behind repairs_enabled. */}
          <PillButton
            label={
              items.length === 0 ? 'Add part or labour' : 'Add / edit items'
            }
            variant={items.length === 0 ? 'solid' : 'secondary'}
            icon="add"
            onPress={() => {
              haptics.light();
              navigation.navigate('RepairItemsEditor', {id: repair.id});
            }}
            accessibilityLabel={
              items.length === 0
                ? 'Add parts or labour to this repair'
                : 'Add or edit repair parts and labour'
            }
            style={styles.addItemsBtn}
          />
        </View>

        {/* -------- Status history timeline -------- */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>History</Text>
          {repair.status_history.length === 0 ? (
            <Text style={styles.emptyText}>No history yet</Text>
          ) : (
            repair.status_history.map((h: RepairStatusHistory, idx: number) => {
              const isLast = idx === repair.status_history.length - 1;
              return (
                <View key={h.id} style={styles.historyRow}>
                  <View style={styles.historyDotColumn}>
                    <View
                      style={[
                        styles.historyDot,
                        {backgroundColor: getRepairStatusColor(h.to_status)},
                      ]}
                    />
                    {!isLast ? <View style={styles.historyLine} /> : null}
                  </View>
                  <View style={styles.historyBody}>
                    <Text style={styles.historyTransition}>
                      {h.from_status
                        ? `${getRepairStatusLabel(h.from_status)} → ${getRepairStatusLabel(h.to_status)}`
                        : getRepairStatusLabel(h.to_status)}
                    </Text>
                    <Text style={styles.historyMeta}>
                      {[formatDateTime(h.changed_at), h.user.name]
                        .filter(Boolean)
                        .join(' · ')}
                    </Text>
                    {h.notes ? (
                      <Text style={styles.historyNotes}>{h.notes}</Text>
                    ) : null}
                  </View>
                </View>
              );
            })
          )}
        </View>

        {/* -------- Notes card (WSA-3) --------
            Sits between History and the Action row so a technician can
            note "diagnosed as motherboard - waiting for customer approval"
            without a status change and see it land on the timeline above.
            Server appends a status_history row with from_status ===
            to_status so notes and status transitions read as one merged
            log. UNCONDITIONAL for the same reason as the items editor above:
            the write ability isn't in the client-readable permissions array,
            so the server enforces (403 → surfaced) rather than the client
            hiding the card for everyone. */}
        {(
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Add note</Text>
            <Text style={styles.subLabel}>
              Adds a timeline entry without changing status.
            </Text>
            <KeyboardAvoidingView
              behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
              <TextInput
                style={styles.noteInput}
                value={noteDraft}
                onChangeText={setNoteDraft}
                placeholder="e.g. Waiting on customer approval for motherboard swap."
                placeholderTextColor={COLORS.inputPlaceholder}
                multiline
                numberOfLines={3}
                maxLength={2000}
                editable={!notePosting}
                inputAccessoryViewID={
                  Platform.OS === 'ios' ? REPAIR_NOTE_INPUT_BAR : undefined
                }
                accessibilityLabel="Repair note"
              />
              <View style={styles.noteFooterRow}>
                <Text style={styles.noteCount}>
                  {noteDraft.length}/2000
                </Text>
                <PillButton
                  label={notePosting ? 'Sending…' : 'Add note'}
                  variant="secondary"
                  onPress={handleAddNote}
                  disabled={
                    notePosting || noteDraft.trim().length === 0
                  }
                  accessibilityLabel="Add note to timeline"
                />
              </View>
            </KeyboardAvoidingView>
          </View>
        )}

        {/* -------- Action row (T7 part C) --------
            Sits after History so the timeline reads as context for the
            actions the operator is about to take. Horizontal wrap of
            PillButtons (SaleDetailScreen keeps a vertical stack of
            TouchableOpacity, but PillButton is the brand-spec primitive
            per §10 and RepairEdit / RepairStatusChange are true peer
            actions here - a wrap row reads as a single toolbar rather
            than a stack of single-choice CTAs).

            Order matches the operator's typical decision flow:
              1. "Change status" - the most common repair-board mutation.
              2. "Edit"           - device / customer / notes tweaks.
              3. "Notify customer" - send a manual update via the
                                     `repairs.notify` action + `repair_status`
                                     template (WSA-4). Gated client-side on
                                     the `send-manual-notification` ability
                                     (server enforces regardless). Confirm-
                                     then-send with a success/failure toast;
                                     dispatcher whitelist rollout is owned
                                     by the deployment team.

            NOTE: no Checkout button here - that action lands in T8, which
            wires the "cash the repair out into a sale" flow. Explicit
            slot marker below so the T8 branch can drop it in without a
            layout re-audit. */}
        <View style={styles.actions}>
          <PillButton
            label="Change status"
            variant="solid"
            onPress={() => {
              navigation.navigate('RepairStatusChange', {id: repair.id});
            }}
            accessibilityLabel="Change status"
            style={styles.actionBtn}
          />
          <PillButton
            label="Edit"
            variant="secondary"
            onPress={() => {
              navigation.navigate('RepairEdit', {id: repair.id});
            }}
            accessibilityLabel="Edit repair"
            style={styles.actionBtn}
          />
          {/* Items editing lives on the Parts & Labour card now (primary,
              discoverable) — no duplicate button in the action row. */}
          {/* WSA-2 label print. Renders the Dymo 89×38 mm repair label with a
              CODE128 of the repair number so any piece left behind can be
              matched back with the Repairs tab scanner. AirPrint on iOS,
              print intent on Android. Always available while a repair is
              open (no status gate) — technicians reprint labels as pieces
              get bagged/unbagged. */}
          <PillButton
            label="Print label"
            variant="tertiary"
            onPress={() => {
              navigation.navigate('RepairLabelPrint', {id: repair.id});
            }}
            accessibilityLabel="Print repair label"
            style={styles.actionBtn}
          />
          {canNotifyCustomer ? (
            <PillButton
              label="Notify customer"
              variant="tertiary"
              onPress={handleNotifyCustomer}
              accessibilityLabel="Notify customer"
              style={styles.actionBtn}
            />
          ) : null}
          {/* T8 - Checkout PillButton. Renders ONLY when the repair is in
              status 'ready' AND the workspace has repairs enabled. Solid
              crimson so it reads as the primary action of the row when it
              appears; the confirm dialog uses the "Parts reserved at
              intake" copy per the DR-M3 sitrep (stock is NOT decremented
              on this checkout in this release). */}
          {repair.status === 'ready' && repairsEnabled ? (
            <PillButton
              label="Checkout"
              variant="solid"
              onPress={handleRepairCheckout}
              accessibilityLabel="Checkout repair"
              style={styles.actionBtn}
            />
          ) : null}
        </View>

        {/* Back lives in the shared brand header (top-left of the chrome)
            via useHeaderBackStore above. */}
      </ScrollView>
      <KeyboardDoneAccessory nativeID={REPAIR_NOTE_INPUT_BAR} />
    </SafeAreaView>
  );
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
  loadingText: {
    marginTop: SPACING.md,
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.sm,
    fontFamily: FONT_FAMILY.medium,
  },
  errorWrap: {
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.md,
  },
  linkText: {color: COLORS.accent, fontSize: FONT_SIZE.md},

  // Card primitive - same shape as SaleDetailScreen. A shared SectionCard
  // extraction is a codebase-wide follow-up; T6 stays scope-tight and
  // inlines the pattern.
  card: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.surfaceBorder,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.sm,
  },

  // Header block
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  headerLeft: {flex: 1, marginRight: SPACING.md},
  headerChips: {
    alignItems: 'flex-end',
  },
  repairNumber: {
    color: COLORS.text,
    fontSize: FONT_SIZE.lg,
    fontFamily: FONT_FAMILY.bold,
    fontVariant: ['tabular-nums'],
  },
  receivedLine: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.sm,
    marginTop: 2,
    fontVariant: ['tabular-nums'],
  },
  assignedLine: {
    color: COLORS.textLight,
    fontSize: FONT_SIZE.sm,
    marginTop: 2,
  },
  statusChip: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: 4,
    borderRadius: BORDER_RADIUS.full,
  },
  statusText: {
    color: COLORS.white,
    fontSize: FONT_SIZE.xs,
    fontFamily: FONT_FAMILY.medium,
    textTransform: 'capitalize',
  },
  priorityChip: {
    marginTop: SPACING.xs,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 4,
    borderRadius: BORDER_RADIUS.full,
  },
  priorityText: {
    color: COLORS.white,
    fontSize: FONT_SIZE.xs,
    fontFamily: FONT_FAMILY.medium,
    textTransform: 'capitalize',
  },

  // Section headers + rows
  sectionTitle: {
    color: COLORS.text,
    fontSize: FONT_SIZE.md,
    fontFamily: FONT_FAMILY.bold,
    marginBottom: SPACING.sm,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: SPACING.sm,
    borderTopWidth: 1,
    borderTopColor: COLORS.surfaceBorder,
  },
  rowLabel: {color: COLORS.textMuted, fontSize: FONT_SIZE.md},
  rowValue: {
    color: COLORS.text,
    fontSize: FONT_SIZE.md,
    fontFamily: FONT_FAMILY.medium,
    flexShrink: 1,
    textAlign: 'right',
    marginLeft: SPACING.sm,
  },
  rowValueWithChevron: {flexDirection: 'row', alignItems: 'center'},
  rowValueLink: {color: COLORS.crimson, marginRight: SPACING.xs},

  body: {
    color: COLORS.text,
    fontSize: FONT_SIZE.md,
    lineHeight: 22,
  },
  subBlock: {
    marginTop: SPACING.md,
    paddingTop: SPACING.md,
    borderTopWidth: 1,
    borderTopColor: COLORS.surfaceBorder,
  },
  subTitle: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.sm,
    fontFamily: FONT_FAMILY.medium,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: SPACING.xs,
  },

  emptyText: {color: COLORS.textMuted, fontSize: FONT_SIZE.sm},
  addItemsBtn: {marginTop: SPACING.md, alignSelf: 'flex-start'},

  // Items table
  itemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingVertical: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.surfaceBorder,
  },
  itemLeft: {flex: 1, marginRight: SPACING.md},
  itemNameLine: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: SPACING.xs,
  },
  itemName: {
    color: COLORS.text,
    fontSize: FONT_SIZE.md,
    fontFamily: FONT_FAMILY.medium,
    flexShrink: 1,
  },
  itemTypeChip: {
    paddingHorizontal: SPACING.xs + 2,
    paddingVertical: 2,
    borderRadius: BORDER_RADIUS.full,
  },
  // Part items consume stock - dusty blue reads as informational.
  itemTypeChipPart: {backgroundColor: COLORS.blue},
  // Labor is time-based, no stock - navy reads as "operator-attention".
  itemTypeChipLabor: {backgroundColor: COLORS.navy},
  itemTypeText: {
    color: COLORS.white,
    fontSize: FONT_SIZE.xs,
    fontFamily: FONT_FAMILY.medium,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  itemMeta: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.sm,
    marginTop: 2,
    fontVariant: ['tabular-nums'],
  },
  itemTotal: {
    color: COLORS.text,
    fontSize: FONT_SIZE.md,
    fontFamily: FONT_FAMILY.bold,
    fontVariant: ['tabular-nums'],
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: SPACING.xs,
  },
  subtotalRow: {
    marginTop: SPACING.xs,
    paddingTop: SPACING.sm,
    borderTopWidth: 1,
    borderTopColor: COLORS.surfaceBorder,
  },
  subtotalLabel: {
    color: COLORS.text,
    fontSize: FONT_SIZE.md,
    fontFamily: FONT_FAMILY.bold,
  },
  subtotalValue: {
    color: COLORS.text,
    fontSize: FONT_SIZE.md,
    fontFamily: FONT_FAMILY.bold,
    fontVariant: ['tabular-nums'],
  },

  // History timeline
  historyRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingTop: SPACING.sm,
  },
  historyDotColumn: {
    alignItems: 'center',
    width: 20,
    marginRight: SPACING.sm,
  },
  historyDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginTop: 4,
  },
  historyLine: {
    width: 2,
    flex: 1,
    minHeight: 20,
    backgroundColor: COLORS.surfaceBorder,
    marginTop: 4,
  },
  historyBody: {
    flex: 1,
    paddingBottom: SPACING.md,
  },
  historyTransition: {
    color: COLORS.text,
    fontSize: FONT_SIZE.md,
    fontFamily: FONT_FAMILY.medium,
  },
  historyMeta: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.sm,
    marginTop: 2,
    fontVariant: ['tabular-nums'],
  },
  historyNotes: {
    color: COLORS.textLight,
    fontSize: FONT_SIZE.sm,
    marginTop: SPACING.xs,
    fontStyle: 'italic',
  },

  // Action row - horizontal wrap so long labels ("Notify customer") don't
  // squeeze the primary CTA on narrow devices. Small gap keeps the row
  // reading as a single toolbar rather than a stack of buttons.
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
    marginTop: SPACING.sm,
    marginBottom: SPACING.sm,
  },
  actionBtn: {
    // Let the pill hug its label rather than stretching - the wrap row
    // handles overflow. flexShrink:0 prevents the label from being
    // truncated when a third button (Notify customer) is present.
    flexShrink: 0,
  },

  // WSA-3 notes card.
  subLabel: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.sm,
    fontFamily: FONT_FAMILY.regular,
    marginBottom: SPACING.sm,
  },
  noteInput: {
    minHeight: 88,
    backgroundColor: COLORS.inputBg,
    borderWidth: 1,
    borderColor: COLORS.inputBorder,
    borderRadius: BORDER_RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm + 2,
    color: COLORS.text,
    fontSize: FONT_SIZE.md,
    fontFamily: FONT_FAMILY.regular,
    textAlignVertical: 'top',
  },
  noteFooterRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: SPACING.sm,
    gap: SPACING.sm,
  },
  noteCount: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.xs,
    fontFamily: FONT_FAMILY.medium,
  },
});

export default RepairDetailScreen;
