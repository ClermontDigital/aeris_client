import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  ActivityIndicator,
  Alert,
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
import {useNavigation, useRoute} from '@react-navigation/native';
import type {RouteProp} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import ApiClient from '../services/ApiClient';
import ErrorBanner from '../components/ErrorBanner';
import EyebrowLabel from '../components/EyebrowLabel';
import PillButton from '../components/PillButton';
import {useHaptics} from '../hooks/useHaptics';
import {useResponsiveLayout} from '../hooks/useResponsiveLayout';
import {useWorkspaceFeaturesStore} from '../stores/workspaceFeaturesStore';
import {useTransactionActivityStore} from '../stores/transactionActivityStore';
import {RelayError} from '@aeris/shared';
import type {RepairDetail, RepairItem} from '../types/api.types';
import type {RepairsStackParamList} from '../types/navigation.types';
import {
  BORDER_RADIUS,
  COLORS,
  FONT_FAMILY,
  FONT_SIZE,
  SPACING,
} from '../constants/theme';

type Nav = NativeStackNavigationProp<
  RepairsStackParamList,
  'RepairItemsEditor'
>;
type RouteProps = RouteProp<RepairsStackParamList, 'RepairItemsEditor'>;

type NewItemType = 'part' | 'labor';

// Repair item add form — local state; committed to the server via
// ApiClient.addRepairItem on submit.
interface NewItemDraft {
  type: NewItemType;
  name: string;
  quantity: string;
  unit_price: string;
  sku: string;
}

const EMPTY_DRAFT: NewItemDraft = {
  type: 'part',
  name: '',
  quantity: '1',
  unit_price: '',
  sku: '',
};

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
        if (mountedRef.current) setRepair(next);
        haptics.success();
        return next;
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
    [haptics],
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

  // ---------------- add-new-item form ----------------
  const handleOpenAdd = useCallback(() => {
    haptics.selection();
    setDraft(EMPTY_DRAFT);
    setShowAdd(true);
  }, [haptics]);

  const handleCancelAdd = useCallback(() => {
    haptics.light();
    setShowAdd(false);
    setDraft(EMPTY_DRAFT);
  }, [haptics]);

  const handleDraftTypeChange = useCallback(
    (type: NewItemType) => {
      haptics.selection();
      setDraft(d => ({...d, type}));
    },
    [haptics],
  );

  const handleSubmitAdd = useCallback(async () => {
    if (!repair) return;
    const name = draft.name.trim();
    const qty = parseInt(draft.quantity, 10);
    const price = parseFloat(draft.unit_price);
    // Field guards — inline validation avoids a round-trip 422 for the
    // most common typos.
    if (name.length === 0) {
      setBanner('Item name is required.');
      return;
    }
    if (!Number.isFinite(qty) || qty < 1) {
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
          item_type: draft.type,
          item_name: name,
          quantity: qty,
          unit_price: price,
          // Labour never carries a product_id or sku; parts can have either
          // or both. product_id: null explicitly so a snapshot-only part
          // (no catalog link, e.g. a random spare a technician had) still
          // records the row.
          product_id: null,
          item_sku: sku.length > 0 ? sku : null,
        }),
      'Could not add item',
    );
    if (next) {
      setShowAdd(false);
      setDraft(EMPTY_DRAFT);
    }
  }, [repair, draft, runMutation]);

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

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right', 'bottom']}>
      <SheetHeader
        title="Edit repair items"
        onClose={handleClose}
        disabled={mutating}
      />
      <KeyboardAvoidingView
        style={styles.kbAvoid}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={[styles.scroll, tabletCap]}
          keyboardShouldPersistTaps="handled">
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
                Add parts or labour with the button below.
              </Text>
            </View>
          ) : (
            <View style={styles.itemsList}>
              {items.map(item => (
                <View
                  key={item.id}
                  style={styles.itemRow}
                  accessibilityLabel={`${
                    item.item_type === 'labor' ? 'Labour' : 'Part'
                  }: ${item.item_name}`}>
                  <View style={styles.itemBody}>
                    <View style={styles.itemHeader}>
                      <Text style={styles.itemName} numberOfLines={2}>
                        {item.item_name}
                      </Text>
                      <View
                        style={[
                          styles.typeChip,
                          item.item_type === 'labor'
                            ? styles.typeChipLabour
                            : styles.typeChipPart,
                        ]}>
                        <Text
                          style={[
                            styles.typeChipText,
                            item.item_type === 'labor'
                              ? styles.typeChipTextLabour
                              : styles.typeChipTextPart,
                          ]}>
                          {item.item_type === 'labor' ? 'Labour' : 'Part'}
                        </Text>
                      </View>
                    </View>
                    {item.item_sku ? (
                      <Text style={styles.itemSku}>SKU {item.item_sku}</Text>
                    ) : null}
                    <View style={styles.itemMetaRow}>
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
                      <Text style={styles.priceText}>
                        ${item.unit_price.toFixed(2)} each
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
              <EyebrowLabel>Add item</EyebrowLabel>
              <View style={styles.typeToggleRow}>
                <TouchableOpacity
                  style={[
                    styles.typeToggleBtn,
                    draft.type === 'part'
                      ? styles.typeToggleBtnActive
                      : null,
                  ]}
                  onPress={() => handleDraftTypeChange('part')}
                  accessibilityRole="radio"
                  accessibilityState={{selected: draft.type === 'part'}}
                  accessibilityLabel="Part">
                  <Text
                    style={[
                      styles.typeToggleText,
                      draft.type === 'part'
                        ? styles.typeToggleTextActive
                        : null,
                    ]}>
                    Part
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.typeToggleBtn,
                    draft.type === 'labor'
                      ? styles.typeToggleBtnActive
                      : null,
                  ]}
                  onPress={() => handleDraftTypeChange('labor')}
                  accessibilityRole="radio"
                  accessibilityState={{selected: draft.type === 'labor'}}
                  accessibilityLabel="Labour">
                  <Text
                    style={[
                      styles.typeToggleText,
                      draft.type === 'labor'
                        ? styles.typeToggleTextActive
                        : null,
                    ]}>
                    Labour
                  </Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.fieldLabel}>
                {draft.type === 'labor' ? 'Labour description' : 'Part name'}
              </Text>
              <TextInput
                style={styles.input}
                value={draft.name}
                onChangeText={n => setDraft(d => ({...d, name: n}))}
                placeholder={
                  draft.type === 'labor'
                    ? 'e.g. Screen replacement labour'
                    : 'e.g. iPhone 13 screen assembly'
                }
                placeholderTextColor={COLORS.inputPlaceholder}
                autoCapitalize="sentences"
                accessibilityLabel="Item name"
              />
              {draft.type === 'part' ? (
                <>
                  <Text style={styles.fieldLabel}>SKU (optional)</Text>
                  <TextInput
                    style={styles.input}
                    value={draft.sku}
                    onChangeText={s => setDraft(d => ({...d, sku: s}))}
                    placeholder="Optional SKU / part number"
                    placeholderTextColor={COLORS.inputPlaceholder}
                    autoCapitalize="characters"
                    autoCorrect={false}
                    accessibilityLabel="SKU"
                  />
                </>
              ) : null}
              <View style={styles.rowFields}>
                <View style={styles.qtyField}>
                  <Text style={styles.fieldLabel}>Quantity</Text>
                  <TextInput
                    style={styles.input}
                    value={draft.quantity}
                    onChangeText={q => setDraft(d => ({...d, quantity: q}))}
                    keyboardType="number-pad"
                    accessibilityLabel="Quantity"
                  />
                </View>
                <View style={styles.priceField}>
                  <Text style={styles.fieldLabel}>Unit price</Text>
                  <TextInput
                    style={styles.input}
                    value={draft.unit_price}
                    onChangeText={p =>
                      setDraft(d => ({...d, unit_price: p}))
                    }
                    keyboardType="decimal-pad"
                    placeholder="0.00"
                    placeholderTextColor={COLORS.inputPlaceholder}
                    accessibilityLabel="Unit price in dollars"
                  />
                </View>
              </View>
              <View style={styles.addBtnRow}>
                <PillButton
                  label="Cancel"
                  variant="secondary"
                  onPress={handleCancelAdd}
                  disabled={mutating}
                  accessibilityLabel="Cancel adding item"
                  style={styles.addRowBtn}
                />
                <PillButton
                  label="Add"
                  variant="solid"
                  onPress={handleSubmitAdd}
                  disabled={mutating}
                  accessibilityLabel="Add item to repair"
                  style={styles.addRowBtn}
                />
              </View>
            </View>
          ) : (
            <PillButton
              label="Add part or labour"
              variant="tertiary"
              onPress={handleOpenAdd}
              disabled={mutating}
              accessibilityLabel="Add part or labour"
              style={styles.addTriggerBtn}
            />
          )}
        </ScrollView>
      </KeyboardAvoidingView>
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
  typeChipPart: {backgroundColor: 'rgba(0, 48, 73, 0.10)'},
  typeChipLabour: {backgroundColor: 'rgba(193, 18, 31, 0.10)'},
  typeChipText: {
    fontSize: FONT_SIZE.xs,
    fontFamily: FONT_FAMILY.semibold,
    letterSpacing: 0.4,
  },
  typeChipTextPart: {color: COLORS.navy},
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
  typeToggleRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
    marginTop: SPACING.xs,
  },
  typeToggleBtn: {
    flex: 1,
    paddingVertical: SPACING.sm,
    borderRadius: BORDER_RADIUS.sm,
    borderWidth: 1,
    borderColor: COLORS.inputBorder,
    alignItems: 'center',
    backgroundColor: COLORS.surface,
  },
  typeToggleBtnActive: {
    borderColor: COLORS.crimson,
    backgroundColor: 'rgba(193, 18, 31, 0.06)',
  },
  typeToggleText: {
    color: COLORS.text,
    fontSize: FONT_SIZE.md,
    fontFamily: FONT_FAMILY.medium,
  },
  typeToggleTextActive: {
    color: COLORS.crimson,
    fontFamily: FONT_FAMILY.semibold,
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
  addBtnRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
    marginTop: SPACING.sm,
  },
  addRowBtn: {flex: 1},
});

export default RepairItemsEditorSheet;
