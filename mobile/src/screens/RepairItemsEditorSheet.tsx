import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  LayoutAnimation,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  UIManager,
  View,
} from 'react-native';
import type {LayoutAnimationConfig} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {useNavigation, useRoute} from '@react-navigation/native';
import type {RouteProp} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import ApiClient from '../services/ApiClient';
import ErrorBanner from '../components/ErrorBanner';
import EyebrowLabel from '../components/EyebrowLabel';
import PillButton from '../components/PillButton';
import KeyboardDoneAccessory from '../components/KeyboardDoneAccessory';
import Icon from '../components/Icon';
import {useHaptics} from '../hooks/useHaptics';
import {useResponsiveLayout} from '../hooks/useResponsiveLayout';
import {useWorkspaceFeaturesStore} from '../stores/workspaceFeaturesStore';
import {useTransactionActivityStore} from '../stores/transactionActivityStore';
import {useRepairItemScanStore} from '../stores/repairItemScanStore';
import {RelayError, productAllowsDecimalQuantity} from '@aeris/shared';
import type {Product, RepairDetail, RepairItem} from '../types/api.types';
import type {RepairsStackParamList} from '../types/navigation.types';
import {
  BORDER_RADIUS,
  COLORS,
  FONT_FAMILY,
  FONT_SIZE,
  ICON_SIZE,
  SPACING,
} from '../constants/theme';

type Nav = NativeStackNavigationProp<
  RepairsStackParamList,
  'RepairItemsEditor'
>;
type RouteProps = RouteProp<RepairsStackParamList, 'RepairItemsEditor'>;

// iOS keyboard-accessory id shared by the add-item form's inputs (number-pad
// / decimal-pad have no return key to dismiss).
const ITEMS_INPUT_BAR = 'repair-items-input-bar';
const iosBar = Platform.OS === 'ios' ? ITEMS_INPUT_BAR : undefined;

// Debounce for the stock-part typeahead — matches the customer typeahead cadence.
const PRODUCT_SEARCH_DEBOUNCE_MS = 300;

// Repair items are PARTS ONLY on mobile. Labour is modelled as a catalogue
// product in the ERP, so a "labour" line is just a part linked to that
// service product — there is no separate labour type to add here.
//
// Repair item add form — local state; committed to the server via
// ApiClient.addRepairItem on submit.
interface NewItemDraft {
  name: string;
  quantity: string;
  unit_price: string;
  sku: string;
  // Set when the part was picked from inventory (searchProducts). Sending the
  // REAL product_id is what lets the server reserve stock now and release the
  // reservation + decrement stock at checkout (T8 stock contract). null == an
  // ad-hoc / off-catalogue part typed by hand.
  product_id: number | null;
  // Snapshot of the picked product's on-hand for the "N in stock" indicator.
  stock_on_hand: number | null;
  // Unit of measure + decimal capability, snapshotted from the picked product.
  // A metered part (unit_type !== 'each') unlocks fractional quantity entry
  // (e.g. 1.3 m of hose); an off-catalogue part stays 'each' / whole-number.
  // See productAllowsDecimalQuantity + the `isMetered` gate.
  unit_type: string | null;
  allows_decimal: boolean;
}

const EMPTY_DRAFT: NewItemDraft = {
  name: '',
  quantity: '1',
  unit_price: '',
  sku: '',
  product_id: null,
  stock_on_hand: null,
  unit_type: null,
  allows_decimal: false,
};

// Old-architecture Android needs LayoutAnimation opted-in explicitly; on
// Fabric it's already on and this is a harmless no-op. iOS needs nothing.
if (
  Platform.OS === 'android' &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

// Ease the NEXT layout commit so the add-form's section swaps (search ↔ manual
// ↔ linked, qty/price surfacing, list growth after an add) glide instead of
// snapping. Fades things in/out and eases height changes. Call right before a
// setState that changes which sections render.
const LAYOUT_ANIM: LayoutAnimationConfig = {
  duration: 220,
  create: {type: 'easeInEaseOut', property: 'opacity'},
  update: {type: 'easeInEaseOut'},
  delete: {type: 'easeInEaseOut', property: 'opacity'},
};
function animateNextLayout(): void {
  LayoutAnimation.configureNext(LAYOUT_ANIM);
}

// Format a measured (fractional) quantity for display: clamp to the server's
// DECIMAL(12,3) precision and drop trailing zeros so 1.300 -> "1.3" and a
// computed 1.2999999 -> "1.3".
function formatMeasuredQty(qty: number): string {
  return String(Number(qty.toFixed(3)));
}

// Stock-level colour for a search result — green healthy, amber low, crimson
// out. Lets a technician read availability at a glance without blocking the
// tap (special-order / off-catalogue parts are legitimate).
function stockColor(onHand: number | null | undefined): string {
  if (onHand == null || onHand <= 0) return COLORS.danger;
  if (onHand <= 5) return COLORS.warning;
  return COLORS.success;
}

/**
 * WSA-3 repair items editor. Presented as a formSheet over RepairDetail.
 *
 * Manages the repair's items[] server-side via ApiClient.addRepairItem /
 * updateRepairItem / removeRepairItem. Each mutation is applied immediately
 * (not batched at save time) so the sheet can be closed at any point without
 * worrying about half-persisted edits — the pattern matches the way workshop
 * technicians actually work (add a part, sanity check, add another).
 *
 * Save-on-mutate rationale: batching would need a diff engine to sequence
 * PUTs correctly (server assigns id on add, so a later "edit the part I
 * just added" branch needs the freshly-minted id), and the marketplace RPC
 * dispatcher's aliases already tolerate the sequential flow. Explicit
 * "commit" would just add friction without buying anything.
 *
 * Server contract per api.types.ts:
 *   - `line_total` is server-computed from quantity * unit_price; the client
 *     MUST NOT send it (RelayClient strips defensively).
 *   - `product_id` is optional for parts (null → snapshot-only line);
 *     labour never has one.
 *   - `status: 'reserved' | 'installed' | 'returned'` — the editor keeps
 *     status untouched; a technician who wants to flip it lives on a
 *     separate future surface.
 */
const RepairItemsEditorSheet: React.FC = () => {
  const navigation = useNavigation<Nav>();
  const route = useRoute<RouteProps>();
  const haptics = useHaptics();
  const {isTablet} = useResponsiveLayout();
  const tabletCap = isTablet
    ? ({maxWidth: 640, alignSelf: 'center', width: '100%'} as const)
    : null;
  const {id: repairId} = route.params;

  // ---------------- state (hooks above early-return guards) ----------------
  const [repair, setRepair] = useState<RepairDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [mutating, setMutating] = useState(false);
  const [draft, setDraft] = useState<NewItemDraft>(EMPTY_DRAFT);
  const [showAdd, setShowAdd] = useState(false);

  // Inventory search state for the "add a part from stock" picker. Debounced
  // searchProducts, mirroring the customer typeahead on RepairEditScreen.
  const [productQuery, setProductQuery] = useState('');
  const [productResults, setProductResults] = useState<Product[]>([]);
  const [productSearching, setProductSearching] = useState(false);
  // Off-catalogue entry is a secondary path: while unlinked and NOT revealed,
  // the add form shows only search + Scan. Tapping "Enter part manually" flips
  // this and surfaces the name/SKU fields. Linking a stock product takes
  // precedence over both.
  const [manualEntry, setManualEntry] = useState(false);

  // Focus targets so the form auto-focuses the right field as the operator
  // moves between search / manual entry (POS-speed: no extra tap to start).
  const searchInputRef = useRef<TextInput>(null);
  const nameInputRef = useRef<TextInput>(null);
  const focusSoon = useCallback((ref: React.RefObject<TextInput | null>) => {
    // The field may be mounting (branch switch); defer a tick so .focus lands.
    setTimeout(() => ref.current?.focus(), 50);
  }, []);

  // Sync guard so a 60Hz double-tap on a mutation button can't fire two
  // add/update/remove RPCs before the disabled state paints.
  const mutateLockRef = useRef(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const data = await ApiClient.getRepairDetail(repairId);
      if (data == null) {
        setLoadError('Repair not found or was deleted.');
      } else {
        setRepair(data);
      }
    } catch (e) {
      const msg =
        e instanceof RelayError
          ? e.message
          : 'Could not load the repair. Please try again.';
      setLoadError(msg);
    } finally {
      setIsLoading(false);
    }
  }, [repairId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!useWorkspaceFeaturesStore.getState().repairs_enabled) {
      Alert.alert('Repairs', 'Repairs are not enabled for this site.');
      navigation.goBack();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const mountedRef = useRef(true);
  useEffect(() => {
    return () => {
      mountedRef.current = false;
      // Drop any un-consumed scan hand-off on the way out so a product that
      // was resolved after this editor was torn down (stack popped between the
      // scanner's setPendingProduct and the consume effect) can't leak into
      // the next editor open. The fresh-mount ref-gate already defuses it, but
      // clearing here keeps the singleton store honest.
      useRepairItemScanStore.getState().clear();
    };
  }, []);

  const handleClose = useCallback(() => {
    if (mutating) return;
    haptics.light();
    navigation.goBack();
  }, [navigation, haptics, mutating]);

  // ---------------- shared mutation wrapper ----------------
  // Every add/update/remove path funnels through this wrapper so the
  // in-flight lock, DR mid-write refcount, and error surfacing are all in
  // one place. Returns the new detail on success (or null if the sheet was
  // unmounted before the RPC ack'd).
  const runMutation = useCallback(
    async (
      fn: () => Promise<RepairDetail>,
      errorLead: string,
    ): Promise<RepairDetail | null> => {
      if (mutateLockRef.current) return null;
      mutateLockRef.current = true;
      setMutating(true);
      setBanner(null);
      useTransactionActivityStore
        .getState()
        .setSettlementOrPrintInFlight(true);
      try {
        const next = await fn();
        // The add/update/remove RPC returns the parent repair, but the server
        // does not always re-hydrate items[] on the WRITE response — only a
        // fresh detail fetch does. Without this re-read the editor list shows
        // the pre-mutation state (e.g. "no items yet" right after adding one)
        // until a back-nav refetch. Re-fetch authoritative state; fall back to
        // the write's own return if the follow-up read fails.
        let authoritative: RepairDetail = next;
        try {
          const fresh = await ApiClient.getRepairDetail(repairId);
          if (fresh) authoritative = fresh;
        } catch {
          // Keep `next` — the write succeeded even if the re-read didn't.
        }
        if (mountedRef.current) setRepair(authoritative);
        haptics.success();
        return authoritative;
      } catch (e) {
        haptics.error();
        const msg =
          e instanceof RelayError
            ? e.message
            : e instanceof Error
              ? e.message
              : 'Unknown error';
        if (mountedRef.current) setBanner(`${errorLead}: ${msg}`);
        return null;
      } finally {
        mutateLockRef.current = false;
        useTransactionActivityStore
          .getState()
          .setSettlementOrPrintInFlight(false);
        if (mountedRef.current) setMutating(false);
      }
    },
    [haptics, repairId],
  );

  // ---------------- per-row handlers ----------------
  const handleAdjustQty = useCallback(
    async (item: RepairItem, delta: number) => {
      const nextQty = Math.max(1, item.quantity + delta);
      if (nextQty === item.quantity) return;
      haptics.selection();
      await runMutation(
        () =>
          ApiClient.updateRepairItem(item.repair_id, item.id, {
            quantity: nextQty,
          }),
        'Could not update quantity',
      );
    },
    [runMutation, haptics],
  );

  const handleRemove = useCallback(
    (item: RepairItem) => {
      Alert.alert(
        'Remove item',
        `Remove "${item.item_name}" from this repair?`,
        [
          {text: 'Cancel', style: 'cancel'},
          {
            text: 'Remove',
            style: 'destructive',
            onPress: async () => {
              haptics.medium();
              await runMutation(
                () => ApiClient.removeRepairItem(item.repair_id, item.id),
                'Could not remove item',
              );
            },
          },
        ],
      );
    },
    [runMutation, haptics],
  );

  // ---------------- inventory search (add part from stock) ----------------
  const clearProductSearch = useCallback(() => {
    setProductQuery('');
    setProductResults([]);
    setProductSearching(false);
  }, []);

  // Debounced product search. Only runs while the add form is open, in the
  // search state (not manual-entry, nothing linked), and there's a query.
  useEffect(() => {
    if (!showAdd || manualEntry || draft.product_id != null) {
      return;
    }
    const q = productQuery.trim();
    if (q.length === 0) {
      setProductResults([]);
      setProductSearching(false);
      return;
    }
    // Per-effect cancellation token (mirrors RepairEditScreen's customer
    // typeahead). `mountedRef` alone can't drop a stale response: without
    // this, typing "screen A" then "screen B" could let A resolve after B
    // and paint A's rows — the operator then taps what looks like a B result
    // and links the WRONG product_id, moving the wrong SKU's stock at
    // checkout. `cancelled` flips on every query change so only the latest
    // request writes state.
    let cancelled = false;
    setProductSearching(true);
    const timer = setTimeout(() => {
      ApiClient.searchProducts(q, 1)
        .then(page => {
          if (cancelled || !mountedRef.current) return;
          setProductResults(page.data.slice(0, 20));
        })
        .catch(() => {
          if (cancelled || !mountedRef.current) return;
          setProductResults([]);
        })
        .finally(() => {
          if (!cancelled && mountedRef.current) setProductSearching(false);
        });
    }, PRODUCT_SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [productQuery, showAdd, manualEntry, draft.product_id]);

  const handleSelectProduct = useCallback(
    (product: Product) => {
      haptics.selection();
      // Glide from the search list to the linked chip + qty/price fields.
      animateNextLayout();
      setDraft(d => ({
        ...d,
        product_id: product.id,
        name: product.name,
        sku: product.sku ?? '',
        // Pre-fill the sell price (dollars) but leave it editable — a
        // technician may quote a repair part differently than the shelf price.
        // A catalogue item with no sell price on file (price_cents === 0) is
        // left BLANK, not "0.00", so the cashier is forced to enter a price
        // rather than silently booking the part at $0.00.
        unit_price:
          product.price_cents > 0
            ? (product.price_cents / 100).toFixed(2)
            : '',
        stock_on_hand: product.stock_on_hand,
        // Snapshot the unit of measure + decimal capability. A metered part
        // (hose by the metre, etc.) unlocks fractional quantity entry.
        unit_type: product.unit_type ?? 'each',
        allows_decimal: productAllowsDecimalQuantity(product),
      }));
      clearProductSearch();
    },
    [haptics, clearProductSearch],
  );

  const handleUnlinkProduct = useCallback(() => {
    haptics.light();
    // "Change" on a linked stock part means "this isn't the right one — pick
    // another". Reset to a clean search state and re-focus the search field so
    // the operator can immediately type the replacement part.
    animateNextLayout();
    setDraft(EMPTY_DRAFT);
    setManualEntry(false);
    clearProductSearch();
    focusSoon(searchInputRef);
  }, [haptics, clearProductSearch, focusSoon]);

  // Reveal the off-catalogue name/SKU fields (secondary path); focus the name.
  const handleRevealManual = useCallback(() => {
    haptics.selection();
    animateNextLayout();
    setManualEntry(true);
    clearProductSearch();
    focusSoon(nameInputRef);
  }, [haptics, clearProductSearch, focusSoon]);

  // Back out of manual entry to the stock search.
  const handleBackToSearch = useCallback(() => {
    haptics.light();
    animateNextLayout();
    setManualEntry(false);
    focusSoon(searchInputRef);
  }, [haptics, focusSoon]);

  // ---------------- scan-to-add ----------------
  // Only a scan initiated from THIS editor should auto-link a product — a
  // stale hand-off from a previous session (or another surface) must be
  // ignored. This ref gates the consume effect below.
  const scanRequestedRef = useRef(false);
  const pendingScanned = useRepairItemScanStore(s => s.pendingProduct);

  const handleScanToAdd = useCallback(() => {
    haptics.light();
    // Clean slate so the effect only ever sees a fresh hit.
    useRepairItemScanStore.getState().clear();
    scanRequestedRef.current = true;
    navigation.navigate('RepairItemScanner');
  }, [navigation, haptics]);

  // When the scanner pops back having resolved a product, link it (same path
  // as tapping a search result). Gated on scanRequestedRef so a stale store
  // value can't auto-add on mount.
  useEffect(() => {
    if (!pendingScanned) return;
    if (!scanRequestedRef.current) {
      useRepairItemScanStore.getState().clear();
      return;
    }
    scanRequestedRef.current = false;
    setShowAdd(true);
    setManualEntry(false);
    handleSelectProduct(pendingScanned);
    useRepairItemScanStore.getState().clear();
  }, [pendingScanned, handleSelectProduct]);

  // ---------------- add-new-item form ----------------
  const handleOpenAdd = useCallback(() => {
    haptics.selection();
    // Expand the add card in place of the trigger button.
    animateNextLayout();
    setDraft(EMPTY_DRAFT);
    setManualEntry(false);
    clearProductSearch();
    setShowAdd(true);
    // Search is the primary path — land the cursor there so the operator can
    // start typing a part immediately.
    focusSoon(searchInputRef);
  }, [haptics, clearProductSearch, focusSoon]);

  const handleCancelAdd = useCallback(() => {
    haptics.light();
    // Collapse the add card back to the trigger button.
    animateNextLayout();
    setShowAdd(false);
    setDraft(EMPTY_DRAFT);
    setManualEntry(false);
    clearProductSearch();
  }, [haptics, clearProductSearch]);

  const handleSubmitAdd = useCallback(async () => {
    if (!repair) return;
    const name = draft.name.trim();
    // Metered parts (a stock item whose unit_type != 'each') may be entered
    // fractionally — 1.3 m of hose. Everything else is whole-number. The
    // server enforces the same rule (ProcessSaleRequest rejects a fractional
    // qty on an 'each' item), so gating on draft.allows_decimal keeps the two
    // in lockstep. off-catalogue / labour lines have allows_decimal === false.
    const metered = draft.allows_decimal;
    const rawQty = metered
      ? parseFloat(draft.quantity)
      : parseInt(draft.quantity, 10);
    // Clamp a metered quantity to the server's DECIMAL(12,3) precision before
    // it hits the wire — a decimal-pad lets a cashier type "1.2345", which
    // would otherwise silently round (or, under MySQL strict mode, throw a
    // truncation error). Display uses the same 3dp clamp (formatMeasuredQty).
    const qty =
      metered && Number.isFinite(rawQty) ? Number(rawQty.toFixed(3)) : rawQty;
    const price = parseFloat(draft.unit_price);
    // Field guards — inline validation avoids a round-trip 422 for the
    // most common typos.
    if (name.length === 0) {
      setBanner('Item name is required.');
      return;
    }
    // Metered floor is the server's DECIMAL(12,3) minimum (0.001); unit items
    // stay whole-number >= 1.
    if (metered) {
      if (!Number.isFinite(qty) || qty < 0.001) {
        setBanner('Quantity must be greater than 0.');
        return;
      }
    } else if (!Number.isFinite(qty) || qty < 1) {
      setBanner('Quantity must be at least 1.');
      return;
    }
    if (!Number.isFinite(price) || price < 0) {
      setBanner('Unit price must be a positive number.');
      return;
    }
    const sku = draft.sku.trim();
    const next = await runMutation(
      () =>
        ApiClient.addRepairItem(repair.id, {
          // Parts only — labour is a catalogue product, added the same way.
          item_type: 'part',
          item_name: name,
          quantity: qty,
          unit_price: price,
          // A stock-linked part carries the REAL product_id so the server
          // reserves stock now + releases the reservation and decrements
          // stock at checkout (T8 stock contract). null for an off-catalogue
          // part typed by hand.
          product_id: draft.product_id,
          item_sku: sku.length > 0 ? sku : null,
        }),
      'Could not add item',
    );
    if (next) {
      // Add-another: keep the form open and reset to a clean search state so a
      // technician can add several parts in a row without reopening. Each add
      // has already persisted (save-on-mutate) and the list above refreshed,
      // so there's no half-committed state. "Done" (or the sheet's close)
      // leaves. Re-focus the search field for the next part. Animate so the
      // new list row and the collapsing fields ease rather than jump.
      animateNextLayout();
      setDraft(EMPTY_DRAFT);
      setManualEntry(false);
      clearProductSearch();
      focusSoon(searchInputRef);
    }
  }, [repair, draft, runMutation, clearProductSearch, focusSoon]);

  // ---------------- early-return guards ----------------
  if (isLoading) {
    return (
      <SafeAreaView style={styles.container} edges={['left', 'right', 'bottom']}>
        <SheetHeader
          title="Edit repair items"
          onClose={handleClose}
          disabled={false}
        />
        <View style={styles.center}>
          <ActivityIndicator color={COLORS.accent} size="large" />
          <Text style={styles.loadingText}>Loading items…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (loadError || !repair) {
    return (
      <SafeAreaView style={styles.container} edges={['left', 'right', 'bottom']}>
        <SheetHeader
          title="Edit repair items"
          onClose={handleClose}
          disabled={false}
        />
        <View style={styles.bannerWrap}>
          <ErrorBanner
            message={loadError ?? 'Repair unavailable.'}
            onRetry={() => {
              haptics.light();
              load();
            }}
          />
        </View>
      </SafeAreaView>
    );
  }

  const items = repair.items;
  const totalDollars = items.reduce((sum, i) => sum + i.line_total, 0);

  // The draft is "metered" when a stock part whose unit_type allows fractional
  // quantity is linked. Drives the decimal keyboard, the qty label unit, and
  // the "N <unit> in stock" chip. `draftUnit` is the display unit (null for a
  // plain 'each' item so we don't clutter the label).
  const draftMetered = draft.allows_decimal;
  const draftUnit =
    draft.unit_type && draft.unit_type !== 'each' ? draft.unit_type : null;
  // A stock part is linked, or the operator has revealed off-catalogue entry —
  // either way there's something to price + add, so the qty/price + Add surface.
  const isLinked = draft.product_id != null;
  const canAddNow = isLinked || manualEntry;

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right', 'bottom']}>
      <SheetHeader
        title="Edit repair items"
        onClose={handleClose}
        disabled={mutating}
      />
      <KeyboardAvoidingView style={styles.kbAvoid}>
        <ScrollView
          contentContainerStyle={[styles.scroll, tabletCap]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          // The Quantity + Unit price inputs sit near the bottom of the add
          // form; the KeyboardAvoidingView 'padding' behaviour under-shifted
          // them inside the formSheet, leaving the field hidden behind the
          // keypad. automaticallyAdjustKeyboardInsets makes iOS add a bottom
          // inset equal to the keyboard height and scroll the focused field
          // into view — the reliable fix for a scrolling form on a sheet.
          automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}>
          {banner ? (
            <View style={styles.bannerWrap}>
              <ErrorBanner
                message={banner}
                onDismiss={() => setBanner(null)}
              />
            </View>
          ) : null}

          <EyebrowLabel>Items</EyebrowLabel>
          {items.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyText}>
                No items on this repair yet.
              </Text>
              <Text style={styles.emptySub}>
                Add parts with the button below.
              </Text>
            </View>
          ) : (
            <View style={styles.itemsList}>
              {items.map(item => (
                <View
                  key={item.id}
                  style={styles.itemRow}
                  accessibilityLabel={`${
                    item.item_type === 'labor' ? 'Labour: ' : ''
                  }${item.item_name}`}>
                  <View style={styles.itemBody}>
                    <View style={styles.itemHeader}>
                      <Text style={styles.itemName} numberOfLines={2}>
                        {item.item_name}
                      </Text>
                      {/* Items are parts-only now, so a "Part" chip on every
                          row is noise — show a chip ONLY for a legacy labour
                          line that may still exist on a repair created before
                          the pivot (or on web). */}
                      {item.item_type === 'labor' ? (
                        <View style={[styles.typeChip, styles.typeChipLabour]}>
                          <Text
                            style={[
                              styles.typeChipText,
                              styles.typeChipTextLabour,
                            ]}>
                            Labour
                          </Text>
                        </View>
                      ) : null}
                    </View>
                    {item.item_sku ? (
                      <Text style={styles.itemSku}>SKU {item.item_sku}</Text>
                    ) : null}
                    <View style={styles.itemMetaRow}>
                      {Number.isInteger(item.quantity) ? (
                        <View style={styles.qtyGroup}>
                          <TouchableOpacity
                            style={[
                              styles.qtyBtn,
                              item.quantity <= 1 || mutating
                                ? styles.qtyBtnDisabled
                                : null,
                            ]}
                            onPress={() => handleAdjustQty(item, -1)}
                            disabled={item.quantity <= 1 || mutating}
                            accessibilityRole="button"
                            accessibilityLabel={`Decrease quantity of ${item.item_name}`}>
                            <Text style={styles.qtyBtnText}>−</Text>
                          </TouchableOpacity>
                          <Text style={styles.qtyText}>{item.quantity}</Text>
                          <TouchableOpacity
                            style={[
                              styles.qtyBtn,
                              mutating ? styles.qtyBtnDisabled : null,
                            ]}
                            onPress={() => handleAdjustQty(item, 1)}
                            disabled={mutating}
                            accessibilityRole="button"
                            accessibilityLabel={`Increase quantity of ${item.item_name}`}>
                            <Text style={styles.qtyBtnText}>+</Text>
                          </TouchableOpacity>
                        </View>
                      ) : (
                        // Fractional (metered) line — a whole-number +/- step
                        // is nonsensical and the Math.max(1,…) floor would
                        // destroy the fraction. Show the measured quantity;
                        // to change it, remove + re-add the line. (RepairItem
                        // doesn't carry unit_type, so the unit label isn't
                        // shown here — see the optional server note.)
                        <Text style={styles.qtyMeasured}>
                          {formatMeasuredQty(item.quantity)}
                        </Text>
                      )}
                      <Text style={styles.priceText}>
                        ${item.unit_price.toFixed(2)}
                        {Number.isInteger(item.quantity) ? ' each' : ''}
                      </Text>
                    </View>
                    <Text style={styles.lineTotal}>
                      Line total: ${item.line_total.toFixed(2)}
                    </Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => handleRemove(item)}
                    disabled={mutating}
                    style={[
                      styles.removeBtn,
                      mutating ? styles.removeBtnDisabled : null,
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${item.item_name}`}>
                    <Text style={styles.removeBtnText}>Remove</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}

          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Items total</Text>
            <Text style={styles.totalValue}>${totalDollars.toFixed(2)}</Text>
          </View>

          {/* -------- Add item -------- */}
          {showAdd ? (
            <View style={styles.addCard}>
              <EyebrowLabel>Add part</EyebrowLabel>
              {isLinked ? (
                // ---- A stock item is linked: chip with live on-hand + a
                // "Change" affordance to re-search. Qty/price render below. ----
                <View style={styles.stockChip}>
                  <View style={styles.stockChipBody}>
                    <Text style={styles.stockChipName} numberOfLines={1}>
                      {draft.name}
                    </Text>
                    <Text style={styles.stockChipMeta}>
                      {draft.sku ? `SKU ${draft.sku} · ` : ''}
                      {draft.stock_on_hand != null
                        ? `${draft.stock_on_hand}${
                            draftUnit ? ` ${draftUnit}` : ''
                          } in stock`
                        : 'linked to stock'}
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={styles.chipChangeBtn}
                    onPress={handleUnlinkProduct}
                    accessibilityRole="button"
                    accessibilityLabel="Change stock item">
                    <Icon
                      name="refresh-cw"
                      size={ICON_SIZE.action}
                      color={COLORS.crimson}
                    />
                    <Text style={styles.stockChipChange}>Change</Text>
                  </TouchableOpacity>
                </View>
              ) : manualEntry ? (
                // ---- Off-catalogue entry (secondary path): name + SKU. ----
                <>
                  <TouchableOpacity
                    style={styles.backToSearchBtn}
                    onPress={handleBackToSearch}
                    accessibilityRole="button"
                    accessibilityLabel="Back to stock search">
                    <Icon
                      name="chevron-back"
                      size={ICON_SIZE.action}
                      color={COLORS.accent}
                    />
                    <Text style={styles.backToSearchText}>
                      Search stock instead
                    </Text>
                  </TouchableOpacity>
                  <Text style={styles.fieldLabel}>Part name</Text>
                  <TextInput
                    ref={nameInputRef}
                    style={styles.input}
                    value={draft.name}
                    onChangeText={n => setDraft(d => ({...d, name: n}))}
                    placeholder="e.g. iPhone 13 screen assembly"
                    placeholderTextColor={COLORS.inputPlaceholder}
                    autoCapitalize="sentences"
                    inputAccessoryViewID={iosBar}
                    accessibilityLabel="Part name"
                  />
                  <Text style={styles.fieldLabel}>SKU (optional)</Text>
                  <TextInput
                    style={styles.input}
                    value={draft.sku}
                    onChangeText={s => setDraft(d => ({...d, sku: s}))}
                    placeholder="Optional SKU / part number"
                    placeholderTextColor={COLORS.inputPlaceholder}
                    autoCapitalize="characters"
                    autoCorrect={false}
                    inputAccessoryViewID={iosBar}
                    accessibilityLabel="SKU"
                  />
                </>
              ) : (
                // ---- Primary path: search stock (+ Scan). ----
                <>
                  <Text style={styles.fieldLabel}>Add from stock</Text>
                  <View style={styles.searchRow}>
                    <View style={styles.searchFieldWrap}>
                      <Icon
                        name="search"
                        size={ICON_SIZE.action}
                        color={COLORS.textMuted}
                      />
                      <TextInput
                        ref={searchInputRef}
                        style={styles.searchFieldInput}
                        value={productQuery}
                        onChangeText={setProductQuery}
                        placeholder="Search parts by name or SKU"
                        placeholderTextColor={COLORS.inputPlaceholder}
                        autoCapitalize="none"
                        autoCorrect={false}
                        inputAccessoryViewID={iosBar}
                        accessibilityLabel="Search stock parts"
                      />
                      {productQuery.length > 0 ? (
                        <TouchableOpacity
                          onPress={() => setProductQuery('')}
                          accessibilityRole="button"
                          accessibilityLabel="Clear search"
                          hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}>
                          <Icon
                            name="close-circle"
                            size={ICON_SIZE.action}
                            color={COLORS.textMuted}
                          />
                        </TouchableOpacity>
                      ) : null}
                    </View>
                    <TouchableOpacity
                      style={styles.scanBtn}
                      onPress={handleScanToAdd}
                      accessibilityRole="button"
                      accessibilityLabel="Scan a product barcode to add">
                      <Icon
                        name="barcode-outline"
                        size={ICON_SIZE.action}
                        color={COLORS.crimson}
                      />
                      <Text style={styles.scanBtnText}>Scan</Text>
                    </TouchableOpacity>
                  </View>
                  {productSearching ? (
                    <View style={styles.searchStatusRow}>
                      <ActivityIndicator color={COLORS.accent} size="small" />
                      <Text style={styles.searchStatusText}>Searching…</Text>
                    </View>
                  ) : null}
                  {productResults.length > 0 ? (
                    <View style={styles.resultsList}>
                      {productResults.map(p => {
                        // Suffix the on-hand with the unit for metered items
                        // ("12.5 m in stock"); plain for 'each'.
                        const u =
                          p.unit_type && p.unit_type !== 'each'
                            ? ` ${p.unit_type}`
                            : '';
                        return (
                          <TouchableOpacity
                            key={p.id}
                            style={styles.resultRow}
                            activeOpacity={0.7}
                            onPress={() => handleSelectProduct(p)}
                            accessibilityRole="button"
                            accessibilityLabel={`Add ${p.name}${
                              p.sku ? `, ${p.sku}` : ''
                            }, $${(p.price_cents / 100).toFixed(2)}, ${
                              p.stock_on_hand
                            }${u} in stock`}>
                            <View style={styles.resultBody}>
                              <Text
                                style={styles.resultName}
                                numberOfLines={1}>
                                {p.name}
                              </Text>
                              <Text style={styles.resultMeta}>
                                {p.sku ? `${p.sku} · ` : ''}$
                                {(p.price_cents / 100).toFixed(2)} ·{' '}
                                <Text
                                  style={{color: stockColor(p.stock_on_hand)}}>
                                  {p.stock_on_hand}
                                  {u} in stock
                                </Text>
                              </Text>
                            </View>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  ) : null}
                  {productQuery.trim().length > 0 &&
                  !productSearching &&
                  productResults.length === 0 ? (
                    <Text style={styles.searchEmptyText}>
                      No matching stock parts — tap “Enter part manually” below.
                    </Text>
                  ) : null}
                  {productQuery.trim().length === 0 && !productSearching ? (
                    <Text style={styles.searchEmptyText}>
                      Search your stock to add a part, or scan its barcode.
                    </Text>
                  ) : null}
                  <PillButton
                    label="Enter part manually"
                    variant="tertiary"
                    onPress={handleRevealManual}
                    disabled={mutating}
                    accessibilityLabel="Enter an off-catalogue part manually"
                    style={styles.manualEntryBtn}
                  />
                </>
              )}

              {canAddNow ? (
                <View style={styles.rowFields}>
                  <View style={styles.qtyField}>
                    <Text style={styles.fieldLabel}>
                      {draftUnit ? `Quantity (${draftUnit})` : 'Quantity'}
                    </Text>
                    <TextInput
                      style={styles.input}
                      value={draft.quantity}
                      onChangeText={q => setDraft(d => ({...d, quantity: q}))}
                      keyboardType={draftMetered ? 'decimal-pad' : 'number-pad'}
                      inputAccessoryViewID={iosBar}
                      accessibilityLabel={
                        draftUnit ? `Quantity in ${draftUnit}` : 'Quantity'
                      }
                    />
                  </View>
                  <View style={styles.priceField}>
                    <Text style={styles.fieldLabel}>Unit price</Text>
                    <View style={styles.priceInputWrap}>
                      <Text style={styles.pricePrefix}>$</Text>
                      <TextInput
                        style={styles.priceInput}
                        value={draft.unit_price}
                        onChangeText={p =>
                          setDraft(d => ({...d, unit_price: p}))
                        }
                        keyboardType="decimal-pad"
                        placeholder="0.00"
                        placeholderTextColor={COLORS.inputPlaceholder}
                        inputAccessoryViewID={iosBar}
                        accessibilityLabel="Unit price in dollars"
                      />
                    </View>
                  </View>
                </View>
              ) : null}
              <View style={styles.addBtnRow}>
                <PillButton
                  label="Done"
                  variant="secondary"
                  onPress={handleCancelAdd}
                  disabled={mutating}
                  accessibilityLabel="Done adding parts"
                  style={styles.addRowBtn}
                />
                {canAddNow ? (
                  <PillButton
                    label="Add"
                    variant="solid"
                    onPress={handleSubmitAdd}
                    disabled={mutating}
                    accessibilityLabel="Add item to repair"
                    style={styles.addRowBtn}
                  />
                ) : null}
              </View>
            </View>
          ) : (
            <PillButton
              label="Add part"
              variant="tertiary"
              onPress={handleOpenAdd}
              disabled={mutating}
              accessibilityLabel="Add part"
              style={styles.addTriggerBtn}
            />
          )}
        </ScrollView>
      </KeyboardAvoidingView>
      <KeyboardDoneAccessory nativeID={ITEMS_INPUT_BAR} />
    </SafeAreaView>
  );
};

// Local sub-component just to keep the render tree lean — the sheet has three
// header variants (loading / error / ready) and the header itself stays the
// same three-slot layout.
const SheetHeader: React.FC<{
  title: string;
  onClose: () => void;
  disabled: boolean;
}> = ({title, onClose, disabled}) => (
  <View style={styles.header}>
    <TouchableOpacity
      onPress={onClose}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel="Close editor"
      hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}>
      <Text
        style={[
          styles.headerCancel,
          disabled ? styles.headerActionDisabled : null,
        ]}>
        Close
      </Text>
    </TouchableOpacity>
    <Text style={styles.headerTitle}>{title}</Text>
    <Text style={styles.headerSpacer}>{'  '}</Text>
  </View>
);

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: COLORS.background},
  kbAvoid: {flex: 1},
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.surfaceBorder,
    backgroundColor: COLORS.surface,
  },
  headerCancel: {
    color: COLORS.navy,
    fontSize: FONT_SIZE.md,
    fontFamily: FONT_FAMILY.medium,
  },
  headerTitle: {
    color: COLORS.text,
    fontSize: FONT_SIZE.lg,
    fontFamily: FONT_FAMILY.semibold,
  },
  headerActionDisabled: {opacity: 0.4},
  headerSpacer: {color: COLORS.transparent, fontSize: FONT_SIZE.md},
  scroll: {padding: SPACING.lg, paddingBottom: SPACING.xxl},
  bannerWrap: {padding: SPACING.md},

  emptyCard: {
    padding: SPACING.lg,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.surfaceBorder,
    backgroundColor: COLORS.surface,
    alignItems: 'center',
    marginTop: SPACING.sm,
  },
  emptyText: {
    color: COLORS.text,
    fontSize: FONT_SIZE.md,
    fontFamily: FONT_FAMILY.semibold,
  },
  emptySub: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.sm,
    fontFamily: FONT_FAMILY.regular,
    marginTop: SPACING.xs,
  },

  itemsList: {
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.surfaceBorder,
    backgroundColor: COLORS.surface,
    marginTop: SPACING.sm,
    overflow: 'hidden',
  },
  itemRow: {
    padding: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.surfaceBorder,
    flexDirection: 'row',
    gap: SPACING.md,
  },
  itemBody: {flex: 1, gap: SPACING.xs},
  itemHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SPACING.sm,
  },
  itemName: {
    flex: 1,
    color: COLORS.text,
    fontSize: FONT_SIZE.md,
    fontFamily: FONT_FAMILY.semibold,
  },
  typeChip: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: 2,
    borderRadius: BORDER_RADIUS.sm,
  },
  typeChipLabour: {backgroundColor: 'rgba(193, 18, 31, 0.10)'},
  typeChipText: {
    fontSize: FONT_SIZE.xs,
    fontFamily: FONT_FAMILY.semibold,
    letterSpacing: 0.4,
  },
  typeChipTextLabour: {color: COLORS.crimson},
  itemSku: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.xs,
    fontFamily: FONT_FAMILY.medium,
  },
  itemMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: SPACING.xs,
  },
  qtyGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  qtyBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.inputBorder,
    backgroundColor: COLORS.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qtyBtnDisabled: {opacity: 0.4},
  qtyBtnText: {
    color: COLORS.text,
    fontSize: FONT_SIZE.lg,
    fontFamily: FONT_FAMILY.semibold,
    lineHeight: FONT_SIZE.lg + 2,
  },
  qtyText: {
    minWidth: 28,
    textAlign: 'center',
    color: COLORS.text,
    fontSize: FONT_SIZE.md,
    fontFamily: FONT_FAMILY.semibold,
  },
  qtyMeasured: {
    color: COLORS.text,
    fontSize: FONT_SIZE.md,
    fontFamily: FONT_FAMILY.semibold,
  },
  priceText: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.sm,
    fontFamily: FONT_FAMILY.medium,
  },
  lineTotal: {
    color: COLORS.text,
    fontSize: FONT_SIZE.sm,
    fontFamily: FONT_FAMILY.semibold,
  },
  removeBtn: {
    alignSelf: 'flex-start',
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
  },
  removeBtnDisabled: {opacity: 0.4},
  removeBtnText: {
    color: COLORS.crimson,
    fontSize: FONT_SIZE.sm,
    fontFamily: FONT_FAMILY.semibold,
  },

  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
    marginTop: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.surfaceBorder,
  },
  totalLabel: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.sm,
    fontFamily: FONT_FAMILY.medium,
  },
  totalValue: {
    color: COLORS.text,
    fontSize: FONT_SIZE.lg,
    fontFamily: FONT_FAMILY.semibold,
  },

  addTriggerBtn: {marginTop: SPACING.lg, alignSelf: 'stretch'},
  addCard: {
    marginTop: SPACING.lg,
    padding: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.surfaceBorder,
    backgroundColor: COLORS.surface,
    gap: SPACING.sm,
  },
  fieldLabel: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.sm,
    fontFamily: FONT_FAMILY.medium,
  },
  input: {
    minHeight: 44,
    backgroundColor: COLORS.inputBg,
    borderWidth: 1,
    borderColor: COLORS.inputBorder,
    borderRadius: BORDER_RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm + 2,
    color: COLORS.text,
    fontSize: FONT_SIZE.md,
    fontFamily: FONT_FAMILY.regular,
  },
  rowFields: {
    flexDirection: 'row',
    gap: SPACING.md,
    marginTop: SPACING.xs,
  },
  qtyField: {flex: 1},
  priceField: {flex: 1},

  // Stock search input row (search field + Scan button) + results + chip.
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  // Bordered field wrapping a leading search icon, the input, and a clear-X.
  searchFieldWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    minHeight: 44,
    backgroundColor: COLORS.inputBg,
    borderWidth: 1,
    borderColor: COLORS.inputBorder,
    borderRadius: BORDER_RADIUS.md,
    paddingHorizontal: SPACING.md,
  },
  searchFieldInput: {
    flex: 1,
    paddingVertical: SPACING.sm + 2,
    color: COLORS.text,
    fontSize: FONT_SIZE.md,
    fontFamily: FONT_FAMILY.regular,
  },
  manualEntryBtn: {marginTop: SPACING.sm, alignSelf: 'stretch'},
  // "Back to search" link shown in off-catalogue entry.
  backToSearchBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    alignSelf: 'flex-start',
    paddingVertical: SPACING.xs,
    paddingRight: SPACING.sm,
  },
  backToSearchText: {
    color: COLORS.accent,
    fontSize: FONT_SIZE.sm,
    fontFamily: FONT_FAMILY.semibold,
  },
  // "$" prefix + borderless input, together reading as one price field.
  priceInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    backgroundColor: COLORS.inputBg,
    borderWidth: 1,
    borderColor: COLORS.inputBorder,
    borderRadius: BORDER_RADIUS.md,
    paddingHorizontal: SPACING.md,
  },
  pricePrefix: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.md,
    fontFamily: FONT_FAMILY.medium,
    marginRight: 2,
  },
  priceInput: {
    flex: 1,
    paddingVertical: SPACING.sm + 2,
    color: COLORS.text,
    fontSize: FONT_SIZE.md,
    fontFamily: FONT_FAMILY.regular,
  },
  scanBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: 44,
    paddingHorizontal: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.crimson,
    backgroundColor: 'rgba(193, 18, 31, 0.06)',
  },
  scanBtnText: {
    color: COLORS.crimson,
    fontSize: FONT_SIZE.sm,
    fontFamily: FONT_FAMILY.semibold,
  },
  searchStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingVertical: SPACING.sm,
  },
  searchStatusText: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.sm,
    fontFamily: FONT_FAMILY.medium,
  },
  searchEmptyText: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.sm,
    fontFamily: FONT_FAMILY.regular,
    marginTop: SPACING.xs,
  },
  resultsList: {
    marginTop: SPACING.xs,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.surfaceBorder,
    backgroundColor: COLORS.surface,
    overflow: 'hidden',
  },
  resultRow: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm + 2,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.surfaceBorder,
  },
  resultBody: {gap: 2},
  resultName: {
    color: COLORS.text,
    fontSize: FONT_SIZE.md,
    fontFamily: FONT_FAMILY.semibold,
  },
  resultMeta: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.sm,
    fontFamily: FONT_FAMILY.medium,
  },
  stockChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    padding: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.crimson,
    backgroundColor: 'rgba(193, 18, 31, 0.06)',
  },
  stockChipBody: {flex: 1, gap: 2},
  stockChipName: {
    color: COLORS.text,
    fontSize: FONT_SIZE.md,
    fontFamily: FONT_FAMILY.semibold,
  },
  stockChipMeta: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.xs,
    fontFamily: FONT_FAMILY.medium,
  },
  // Bordered "Change" pill (icon + label) — a clear 44pt tap target, not bare
  // text, so the unlink affordance reads as a control.
  chipChangeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: 44,
    paddingHorizontal: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.crimson,
    backgroundColor: COLORS.surface,
  },
  stockChipChange: {
    color: COLORS.crimson,
    fontSize: FONT_SIZE.sm,
    fontFamily: FONT_FAMILY.semibold,
  },
  addBtnRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
    marginTop: SPACING.sm,
  },
  addRowBtn: {flex: 1},
});

export default RepairItemsEditorSheet;
