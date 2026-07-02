import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Alert,
  KeyboardAvoidingView,
  Platform,
  InputAccessoryView,
  Keyboard,
  Pressable,
  Modal,
  ActivityIndicator,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {useNavigation, useFocusEffect} from '@react-navigation/native';
import {useHeaderBackStore} from '../stores/headerBackStore';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import Icon from '../components/Icon';
import {
  COLORS,
  SPACING,
  FONT_SIZE,
  FONT_FAMILY,
  BORDER_RADIUS,
  ICON_SIZE,
} from '../constants/theme';
import {useCartStore} from '../stores/cartStore';
import {useWorkspaceFeaturesStore} from '../stores/workspaceFeaturesStore';
import {useHaptics} from '../hooks/useHaptics';
import {useResponsiveLayout} from '../hooks/useResponsiveLayout';
import EmptyState from '../components/EmptyState';
import ApiClient from '../services/ApiClient';
import type {CartItem, PendingRepair, Product} from '../types/api.types';
import type {QuickSaleStackParamList} from '../types/navigation.types';
import {formatCurrency} from '../utils/format';

type NavigationProp = NativeStackNavigationProp<QuickSaleStackParamList>;

// Shared nativeID for the iOS keyboard accessory bar — both TextInputs
// reference it so they share one Done button rather than each rendering
// their own.
const CART_INPUT_BAR = 'cart-input-bar';

export default function CartScreen() {
  const navigation = useNavigation<NavigationProp>();
  const haptics = useHaptics();
  const {isTablet} = useResponsiveLayout();
  // Cap list rows + summary card to 720pt and centre on iPad so the cart
  // doesn't read as a stretched billboard. Phone layout untouched.
  const tabletWidthCap = isTablet
    ? ({maxWidth: 720, alignSelf: 'center', width: '100%'} as const)
    : null;
  const {
    items,
    discountCents,
    notes,
    customerId,
    customerName,
    repairId,
    repairNumber,
    updateQuantity,
    removeItem,
    setDiscount,
    setNotes,
    setRepairId,
    setRepairNumber,
    addItem,
    clear,
    getSubtotalCents,
    getTaxCents,
    getTotalCents,
    getItemCount,
  } = useCartStore();

  // Workspace flag — the "Take payment for repair" affordance only shows
  // for deployments that have shipped the repairs surface. Selector-shaped
  // read so a flip of the flag re-renders the screen without needing a
  // full store subscribe.
  const repairsEnabled = useWorkspaceFeaturesStore(s => s.repairs_enabled);

  // Picker state — repair-picker bottom-sheet modal. When shown, we fetch
  // pending repairs for the current customer and let the cashier pick one.
  // Kept LOCAL to CartScreen (not a route) because the deployment sitrep
  // wants the picker to feel like a native bottom-sheet pull rather than a
  // full-screen stack push. Hooks above the early-return contract per
  // feedback_hooks_above_early_returns — always mounted, opens on demand.
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const [pendingRepairs, setPendingRepairs] = useState<PendingRepair[]>([]);

  const loadPendingRepairs = useCallback(async () => {
    if (customerId == null) return;
    setPickerLoading(true);
    setPickerError(null);
    try {
      const list = await ApiClient.getPendingRepairsForCustomer(customerId);
      setPendingRepairs(list);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to load repairs';
      setPickerError(msg);
    } finally {
      setPickerLoading(false);
    }
  }, [customerId]);

  const openRepairPicker = useCallback(() => {
    haptics.light();
    setPickerOpen(true);
    loadPendingRepairs();
  }, [haptics, loadPendingRepairs]);

  const closeRepairPicker = useCallback(() => {
    setPickerOpen(false);
  }, []);

  const handlePickRepair = useCallback(
    async (repair: PendingRepair) => {
      haptics.medium();
      try {
        // Fetch full detail so we can synthesise cart items from
        // repair.items. The picker's PendingRepair shape doesn't carry
        // items (see api.types.ts).
        const detail = await ApiClient.getRepairDetail(repair.id);
        if (!detail) {
          setPickerError('Repair not found.');
          return;
        }
        // T8-C3: verify status is still 'ready' at pick time. The
        // getPendingRepairsForCustomer endpoint already filters on ready,
        // but a race between the picker fetch and the pick tap (e.g.
        // another cashier just moved the repair to 'completed') would
        // otherwise silently link a non-ready repair, which the server
        // no-ops the completion side-effect on.
        if (detail.status !== 'ready') {
          setPickerError('Repair no longer ready for checkout.');
          return;
        }
        // T8-C2: clear the cart first so a mixed retail + repair basket
        // doesn't accidentally carry across into the sale. Mirrors
        // RepairDetailScreen.handleRepairCheckout.
        clear();
        // Money on the repair wire travels as DOLLAR FLOATS (per api.types.ts
        // §Repair). cartStore.addItem expects a Product-shaped object whose
        // price_cents is CENTS. Synthesise a stub Product per repair item:
        //  - id: negative repair_item.id so it doesn't collide with real
        //    Product primary keys already in the cart.
        //  - price_cents: Math.round(item.unit_price * 100) - convert
        //    dollars to cents at the boundary.
        //  - tax_rate: 0 - repair labour + parts are quoted GST-inclusive
        //    already; a repeat 10% would double-tax.
        detail.items.forEach(ri => {
          const synth: Product = {
            id: -ri.id,
            name: ri.item_name,
            sku: ri.item_sku ?? '',
            barcode: null,
            price_cents: Math.round(ri.unit_price * 100),
            tax_rate: 0,
            stock_on_hand: 0,
            category_id: null,
            category_name: null,
            image_url: null,
            is_active: true,
          };
          addItem(synth, ri.quantity);
        });
        setRepairId(detail.id);
        setRepairNumber(detail.repair_number);
        setPickerOpen(false);
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Failed to load repair';
        setPickerError(msg);
      }
    },
    [addItem, clear, setRepairId, setRepairNumber, haptics],
  );

  const clearRepairLink = useCallback(() => {
    haptics.light();
    setRepairId(null);
    setRepairNumber(null);
  }, [haptics, setRepairId, setRepairNumber]);

  const subtotal = getSubtotalCents();
  const tax = getTaxCents();
  const total = getTotalCents();
  const itemCount = getItemCount();

  // Discount input modes: '$' = absolute dollar amount, '%' = percent of
  // (subtotal + tax). The store always holds cents — the percent mode just
  // changes how we interpret the typed string at commit time. Default to
  // '$' for back-compat with existing operators. The mode lives in local
  // state (not persisted) so each new cart starts in $ mode.
  type DiscountMode = '$' | '%';
  const [discountMode, setDiscountMode] = useState<DiscountMode>('$');

  // Keyboard dismissal — iOS-canonical pattern only:
  //   (a) `InputAccessoryView` below renders a Done bar above the keyboard
  //   (b) FlatList `keyboardDismissMode="on-drag"` lets the operator
  //       drag the cart list down to dismiss
  //   (c) Wrapping the screen body in `TouchableWithoutFeedback` so any
  //       tap outside an input dismisses (added on the SafeAreaView below)
  // The earlier "Hide keyboard" pill was dropped in v1.3.26 — it felt
  // clunky and competed with the canonical iOS UX. If the InputAccessoryView
  // ever proves unreliable on a specific device, prefer tap-outside +
  // drag-to-dismiss over re-introducing inline chrome.
  // The discount input is text-as-typed on screen but the store holds cents.
  // We mirror the store value into local state so the user can type freely
  // (decimal in progress, intermediate empty string) without the store
  // clobbering each keystroke. Commit on blur/submit.
  const [discountInput, setDiscountInput] = useState<string>(
    discountCents > 0 ? (discountCents / 100).toFixed(2) : '',
  );
  const [discountOverCap, setDiscountOverCap] = useState(false);
  const overCapHapticFiredRef = useRef(false);
  // If another path resets discountCents (e.g. clear cart), reflect it.
  // Only updates the $ mode display — in % mode the user-typed percent
  // stays put while the store value mirrors it.
  useEffect(() => {
    if (discountMode === '$') {
      setDiscountInput(discountCents > 0 ? (discountCents / 100).toFixed(2) : '');
    }
  }, [discountCents, discountMode]);

  // Percent mode: when the cart's subtotal/tax change mid-edit (e.g. the
  // operator bumps a quantity) the typed percent stays visible but the
  // applied cents amount needs to re-derive against the new base. Without
  // this the display drifts away from what's actually applied.
  useEffect(() => {
    if (discountMode !== '%') return;
    if (discountInput.trim() === '') return;
    const requested = computeRequestedCents(discountInput, '%');
    if (requested != null) {
      setDiscount(requested);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [discountMode, discountInput, subtotal, tax]);

  // When the cart empties (items.length transitions to 0) we tear down the
  // inputs UI. In $ mode the typed value snaps back from the store on next
  // mount, but in % mode we'd otherwise carry a stale percent that gets
  // applied to the next freshly populated cart. Zero discountCents in that
  // case so the next add-item starts clean.
  useEffect(() => {
    if (items.length === 0 && discountMode === '%') {
      setDiscountInput('');
      setDiscount(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length]);

  // Convert a typed string + current mode into a cents amount. `null` if
  // the input is empty or unparseable. In % mode the percentage is applied
  // to (subtotal + tax) — same base the cap is computed against.
  const computeRequestedCents = useCallback(
    (text: string, mode: DiscountMode): number | null => {
      const trimmed = text.trim();
      if (trimmed === '') return null;
      const parsed = parseFloat(trimmed);
      if (!Number.isFinite(parsed) || parsed < 0) return null;
      if (mode === '$') {
        return Math.round(parsed * 100);
      }
      // Percent mode — cap at 100% so a stray "150" doesn't try to pay the
      // customer back. The cents-side clamp in setDiscount catches the
      // remaining cases (rounding above subtotal+tax, etc).
      const pct = Math.min(parsed, 100);
      const state = useCartStore.getState();
      const base = state.getSubtotalCents() + state.getTaxCents();
      return Math.round((base * pct) / 100);
    },
    [],
  );

  const handleDiscountChange = useCallback(
    (text: string) => {
      setDiscountInput(text);
      const requestedCents = computeRequestedCents(text, discountMode);
      if (requestedCents === null) {
        setDiscountOverCap(false);
        overCapHapticFiredRef.current = false;
        return;
      }
      const state = useCartStore.getState();
      const cap = state.getSubtotalCents() + state.getTaxCents();
      if (requestedCents > cap) {
        if (!overCapHapticFiredRef.current) {
          haptics.error();
          overCapHapticFiredRef.current = true;
        }
        setDiscountOverCap(true);
      } else {
        setDiscountOverCap(false);
        overCapHapticFiredRef.current = false;
      }
    },
    [haptics, discountMode, computeRequestedCents],
  );

  const commitDiscount = useCallback(() => {
    const requested = computeRequestedCents(discountInput, discountMode);
    if (requested === null) {
      setDiscount(0);
      setDiscountInput('');
      setDiscountOverCap(false);
      overCapHapticFiredRef.current = false;
      return;
    }
    setDiscount(requested);
    const after = useCartStore.getState().discountCents;
    // In $ mode, snap the display back to the clamped value (e.g. cap
    // overflow). In % mode, keep the user-typed percent — the cap clamp
    // happens in cents, so re-rendering the percent would be lossy.
    if (discountMode === '$' && after !== requested) {
      setDiscountInput(after > 0 ? (after / 100).toFixed(2) : '');
    }
    setDiscountOverCap(false);
    overCapHapticFiredRef.current = false;
  }, [discountInput, discountMode, setDiscount, computeRequestedCents]);

  // Swap mode without resetting the cart's discount. We rewrite the typed
  // value to the equivalent in the new mode so the visible number tracks
  // what's actually applied. Going $ → % needs a non-zero subtotal to
  // compute a meaningful percent; if the cart is empty, drop to "".
  const handleSwapDiscountMode = useCallback(
    (next: DiscountMode) => {
      if (next === discountMode) return;
      haptics.selection();
      setDiscountMode(next);
      const cents = useCartStore.getState().discountCents;
      if (cents <= 0) {
        setDiscountInput('');
        return;
      }
      if (next === '$') {
        setDiscountInput((cents / 100).toFixed(2));
      } else {
        const state = useCartStore.getState();
        const base = state.getSubtotalCents() + state.getTaxCents();
        if (base <= 0) {
          setDiscountInput('');
        } else {
          const pct = (cents / base) * 100;
          // Keep one decimal of resolution — POS users rarely want more.
          setDiscountInput(pct.toFixed(1).replace(/\.0$/, ''));
        }
      }
    },
    [discountMode, haptics],
  );

  // One-shot guard: handleBackToProducts is fired from the brand-header
  // Back affordance and from the Clear-cart confirm. Resetting on focus
  // mirrors the ProductDetail/CustomerDetail pattern so a fast double-tap
  // can't over-navigate while a transition is in flight.
  const backFiredRef = useRef(false);
  const handleBackToProducts = useCallback(() => {
    if (backFiredRef.current) return;
    backFiredRef.current = true;
    // Pop back if we have history (came from ProductGrid → Cart navigate),
    // otherwise jump to ProductGrid directly. Both land on the same screen
    // either way; popping preserves any existing scroll/search state on
    // ProductGrid.
    if (navigation.canGoBack()) {
      navigation.goBack();
    } else {
      navigation.navigate('ProductGrid');
    }
  }, [navigation]);

  // Surface the Back button in the shared brand header while focused.
  // beforeRemove handles the slot cleanup with an identity-matched clearIf
  // so the revealed screen's own handler never gets wiped (the v1.3.70
  // race fix — see ProductDetailScreen comment for the rationale).
  const setHeaderBack = useHeaderBackStore(s => s.setOnBack);
  const clearHeaderBackIf = useHeaderBackStore(s => s.clearIf);
  useFocusEffect(
    useCallback(() => {
      backFiredRef.current = false;
      setHeaderBack(handleBackToProducts);
      return undefined;
    }, [setHeaderBack, handleBackToProducts]),
  );
  useEffect(() => {
    const sub = navigation.addListener('beforeRemove', () => {
      clearHeaderBackIf(handleBackToProducts);
    });
    return sub;
  }, [navigation, clearHeaderBackIf, handleBackToProducts]);

  const handleClearCart = useCallback(() => {
    Alert.alert(
      'Clear cart',
      'Are you sure you want to remove all items from the cart?',
      [
        {text: 'Cancel', style: 'cancel'},
        {
          text: 'Clear',
          style: 'destructive',
          // Cart is now empty so nothing to do on this screen — kick the
          // user straight back to the product list, which is where they'd
          // start a fresh sale anyway.
          onPress: () => {
            clear();
            handleBackToProducts();
          },
        },
      ],
    );
  }, [clear, handleBackToProducts]);

  const handleCheckout = useCallback(() => {
    haptics.medium();
    navigation.navigate('Checkout');
  }, [navigation, haptics]);

  const handleSwipeDelete = useCallback(
    (productId: number) => {
      Alert.alert('Remove item', 'Remove this item from the cart?', [
        {text: 'Cancel', style: 'cancel'},
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => removeItem(productId),
        },
      ]);
    },
    [removeItem],
  );

  const renderCartItem = ({item}: {item: CartItem}) => {
    const lineTotal = item.unit_price_cents * item.quantity;

    return (
      <View style={styles.cartItem}>
        <View style={styles.cartItemInfo}>
          <Text style={styles.cartItemName} numberOfLines={1}>
            {item.product.name}
          </Text>
          <Text style={styles.cartItemSku}>{item.product.sku}</Text>
          <Text style={styles.cartItemPrice}>
            {formatCurrency(item.unit_price_cents)} × {item.quantity} ={' '}
            {formatCurrency(lineTotal)}
          </Text>
        </View>
        <View style={styles.quantityStepper}>
          <TouchableOpacity
            style={styles.stepperButton}
            hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}
            accessibilityRole="button"
            accessibilityLabel="Decrease quantity"
            onPress={() => {
              haptics.light();
              updateQuantity(item.product.id, item.quantity - 1);
            }}>
            <Icon
              name="remove"
              size={ICON_SIZE.action}
              color={COLORS.text}
            />
          </TouchableOpacity>
          <Text style={styles.quantityText}>{item.quantity}</Text>
          <TouchableOpacity
            style={styles.stepperButton}
            hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}
            accessibilityRole="button"
            accessibilityLabel="Increase quantity"
            onPress={() => {
              haptics.light();
              updateQuantity(item.product.id, item.quantity + 1);
            }}>
            <Icon name="add" size={ICON_SIZE.action} color={COLORS.text} />
          </TouchableOpacity>
        </View>
        <TouchableOpacity
          style={styles.deleteButton}
          accessibilityRole="button"
          accessibilityLabel="Remove item"
          onPress={() => {
            haptics.light();
            handleSwipeDelete(item.product.id);
          }}>
          <Icon
            name="trash-outline"
            size={ICON_SIZE.action}
            color={COLORS.danger}
          />
        </TouchableOpacity>
      </View>
    );
  };

  const renderEmpty = () => (
    <EmptyState
      icon="cart-outline"
      title="Your cart is empty"
      description="Add products from the Quick Sale screen"
    />
  );

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right']}>
      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {/* Tap any non-input area to dismiss the keyboard. Pressable's
          onPress only fires when no touchable child (FlatList rows, qty
          buttons, the input itself) intercepts the tap — so this doesn't
          fight existing interaction. accessible={false} keeps it out of
          the VoiceOver tree (the children carry their own labels). */}
      <Pressable
        style={styles.dismissArea}
        onPress={Keyboard.dismiss}
        accessible={false}>
      {/* Header — Back lives in the shared brand header (top-left of the
          chrome) via useHeaderBackStore above; this row just titles the
          screen and shows the item count. */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Cart</Text>
        <Text style={styles.headerCount}>
          {itemCount} {itemCount === 1 ? 'item' : 'items'}
        </Text>
      </View>

      {/* T8 — "Checking out repair" chip. Renders whenever the cart is
          linked to a repair (regardless of items count) so the cashier can
          always see + clear the link. Tap to unlink; the cart items stay
          put (the cashier may still want to complete a mixed transaction). */}
      {repairId != null && (
        <TouchableOpacity
          style={styles.repairLinkChip}
          onPress={clearRepairLink}
          accessibilityRole="button"
          accessibilityLabel="Clear repair link"
          activeOpacity={0.7}>
          <Icon
            name="construct-outline"
            size={ICON_SIZE.action}
            color={COLORS.crimson}
          />
          <Text style={styles.repairLinkText} numberOfLines={1}>
            Checking out repair {repairNumber ? `REP-${repairNumber}` : ''}
          </Text>
          <Icon
            name="close"
            size={ICON_SIZE.action - 4}
            color={COLORS.textMuted}
          />
        </TouchableOpacity>
      )}

      {/* T8 — "Take payment for repair" affordance. Gated on customer set
          AND workspace repairs_enabled AND no active repair link (once
          linked, the chip above is the source of truth). Unconditional
          on items.length so a cashier can start the flow from an empty
          cart — the picker populates the cart. */}
      {customerId != null && repairsEnabled && repairId == null && (
        <TouchableOpacity
          style={styles.repairLink}
          onPress={openRepairPicker}
          accessibilityRole="button"
          accessibilityLabel="Take payment for repair"
          activeOpacity={0.7}>
          <Icon
            name="construct-outline"
            size={ICON_SIZE.action}
            color={COLORS.accent}
          />
          <Text style={styles.repairLinkTextAction}>
            Take payment for repair
          </Text>
          <Icon
            name="chevron-forward"
            size={ICON_SIZE.action - 4}
            color={COLORS.accent}
          />
        </TouchableOpacity>
      )}

      {/* Customer chip — same picker the Checkout screen uses. Surfacing
          customer attribution here (before total/checkout) is the cue for
          the operator to register the sale against the right account. */}
      {items.length > 0 && (
        <TouchableOpacity
          style={styles.customerChip}
          activeOpacity={0.7}
          onPress={() => {
            haptics.light();
            navigation.navigate('CustomerPicker');
          }}
          accessibilityRole="button"
          accessibilityLabel={
            customerId != null && customerName
              ? `Change customer, currently ${customerName}`
              : 'Select customer or walk-in'
          }>
          <Icon
            name={customerId != null ? 'person' : 'walk-outline'}
            size={ICON_SIZE.action}
            color={customerId != null ? COLORS.crimson : COLORS.textMuted}
          />
          <View style={styles.customerChipText}>
            <Text style={styles.customerChipLabel}>Customer</Text>
            <Text style={styles.customerChipValue} numberOfLines={1}>
              {customerId != null && customerName ? customerName : 'Walk-in'}
            </Text>
          </View>
          <Text style={styles.customerChipChange}>Change</Text>
          <Icon
            name="chevron-forward"
            size={ICON_SIZE.action - 4}
            color={COLORS.textMuted}
          />
        </TouchableOpacity>
      )}

      {/* Cart Items */}
      <FlatList
        data={items}
        renderItem={renderCartItem}
        keyExtractor={item => String(item.product.id)}
        // tabletWidthCap on `style` (outer scroll container), not
        // `contentContainerStyle` — the latter sits inside the scroll
        // container and its width=100% beats maxWidth, leaving the list
        // full-bleed while the chrome is centred at 720pt.
        style={tabletWidthCap}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={renderEmpty}
        keyboardShouldPersistTaps="handled"
        // Standard iOS pattern: dragging the list down dismisses the
        // keyboard. Belt-and-braces with the always-visible Hide keyboard
        // pill below — InputAccessoryView on this RN/Fabric version has
        // been unreliable on some devices, so we don't lean on it alone.
        keyboardDismissMode="on-drag"
      />

      {/* Discount & Notes */}
      {items.length > 0 && (
        <View style={[styles.inputsSection, tabletWidthCap]}>
          <View style={styles.inputRow}>
            <View style={styles.discountHeader}>
              <Text style={styles.inputLabel}>Discount</Text>
              {/* $/% segmented toggle. Tap-target sized at SPACING.lg
                  vertical for thumb reach on a small phone. */}
              <View style={styles.discountModeToggle}>
                <TouchableOpacity
                  onPress={() => handleSwapDiscountMode('$')}
                  accessibilityRole="button"
                  accessibilityLabel="Discount in dollars"
                  accessibilityState={{selected: discountMode === '$'}}
                  hitSlop={{top: 8, bottom: 8, left: 4, right: 4}}
                  style={[
                    styles.discountModeBtn,
                    discountMode === '$' && styles.discountModeBtnActive,
                  ]}>
                  <Text
                    style={[
                      styles.discountModeText,
                      discountMode === '$' && styles.discountModeTextActive,
                    ]}>
                    $
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => handleSwapDiscountMode('%')}
                  accessibilityRole="button"
                  accessibilityLabel="Discount as percentage"
                  accessibilityState={{selected: discountMode === '%'}}
                  hitSlop={{top: 8, bottom: 8, left: 4, right: 4}}
                  style={[
                    styles.discountModeBtn,
                    discountMode === '%' && styles.discountModeBtnActive,
                  ]}>
                  <Text
                    style={[
                      styles.discountModeText,
                      discountMode === '%' && styles.discountModeTextActive,
                    ]}>
                    %
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
            <TextInput
              style={styles.input}
              value={discountInput}
              onChangeText={handleDiscountChange}
              onBlur={commitDiscount}
              onSubmitEditing={commitDiscount}
              keyboardType="decimal-pad"
              placeholder={discountMode === '$' ? '0.00' : '0'}
              placeholderTextColor={COLORS.textDim}
              inputAccessoryViewID={
                Platform.OS === 'ios' ? CART_INPUT_BAR : undefined
              }
            />
            {discountOverCap ? (
              <Text style={styles.discountHelper}>
                Max {formatCurrency(subtotal + tax)}
              </Text>
            ) : null}
          </View>
          <View style={styles.inputRow}>
            <Text style={styles.inputLabel}>Notes</Text>
            <TextInput
              style={[styles.input, styles.notesInput]}
              value={notes}
              onChangeText={setNotes}
              placeholder="Order notes..."
              placeholderTextColor={COLORS.textDim}
              multiline
              inputAccessoryViewID={
                Platform.OS === 'ios' ? CART_INPUT_BAR : undefined
              }
            />
          </View>
        </View>
      )}

      {/* iOS-only "Done" bar above the keyboard. The decimal-pad keyboard
          has no return key, so without this the operator can't dismiss
          the keyboard except by tapping outside (and there's no large
          outside area while the summary card occupies the bottom).
          Android numeric keyboards expose a system-level back / return
          affordance, so we don't render this on Android. */}
      {Platform.OS === 'ios' ? (
        <InputAccessoryView nativeID={CART_INPUT_BAR}>
          <View style={styles.keyboardAccessory}>
            <TouchableOpacity
              onPress={() => Keyboard.dismiss()}
              accessibilityRole="button"
              accessibilityLabel="Dismiss keyboard"
              hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}>
              <Text style={styles.keyboardAccessoryDone}>Done</Text>
            </TouchableOpacity>
          </View>
        </InputAccessoryView>
      ) : null}

      {/* Summary — full-bleed at the screen edges so the rounded top +
          downward shadow visual reads as "card pinned to the bottom of
          the screen" on every device. On iPad, only the inner content
          gets capped/centred so we don't float a tiny card with cream
          gutters either side. */}
      {items.length > 0 && (
        <View style={styles.summaryCard}>
          <View style={tabletWidthCap}>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Subtotal</Text>
            <Text style={styles.summaryValue}>{formatCurrency(subtotal)}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Tax</Text>
            <Text style={styles.summaryValue}>{formatCurrency(tax)}</Text>
          </View>
          {discountCents > 0 && (
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Discount</Text>
              <Text style={[styles.summaryValue, styles.summaryDiscountValue]}>
                −{formatCurrency(discountCents)}
              </Text>
            </View>
          )}
          <View style={styles.summaryDivider} />
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Total</Text>
            <Text style={styles.totalValue}>{formatCurrency(total)}</Text>
          </View>

          {/* Action Buttons */}
          <View style={styles.buttonRow}>
            <TouchableOpacity
              style={styles.clearButton}
              onPress={handleClearCart}
              accessibilityRole="button"
              accessibilityLabel="Clear cart">
              <Text style={styles.clearButtonText}>Clear cart</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.checkoutButton}
              onPress={handleCheckout}
              accessibilityRole="button"
              accessibilityLabel="Checkout">
              <Text style={styles.checkoutButtonText}>Checkout</Text>
            </TouchableOpacity>
          </View>
          </View>
        </View>
      )}
      </Pressable>
      </KeyboardAvoidingView>

      {/* T8 — Repair picker bottom sheet. Fed by
          ApiClient.getPendingRepairsForCustomer on open; picking a repair
          synthesises cart items from repair.items and links the cart. */}
      <Modal
        visible={pickerOpen}
        animationType="slide"
        transparent
        onRequestClose={closeRepairPicker}
        accessibilityViewIsModal>
        <View style={styles.pickerBackdrop}>
          <View style={styles.pickerSheet}>
            <View style={styles.pickerHeader}>
              <Text style={styles.pickerTitle}>Pick a repair</Text>
              <TouchableOpacity
                onPress={closeRepairPicker}
                accessibilityRole="button"
                accessibilityLabel="Close repair picker"
                hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}>
                <Icon
                  name="close"
                  size={ICON_SIZE.action}
                  color={COLORS.text}
                />
              </TouchableOpacity>
            </View>
            {pickerLoading ? (
              <View style={styles.pickerCenter}>
                <ActivityIndicator color={COLORS.accent} size="large" />
              </View>
            ) : pickerError ? (
              <View style={styles.pickerCenter}>
                <Text style={styles.pickerError}>{pickerError}</Text>
              </View>
            ) : pendingRepairs.length === 0 ? (
              <View style={styles.pickerCenter}>
                <Text style={styles.pickerEmpty}>
                  No repairs ready for pickup for this customer.
                </Text>
              </View>
            ) : (
              <FlatList
                data={pendingRepairs}
                keyExtractor={r => String(r.id)}
                renderItem={({item: repair}) => (
                  <TouchableOpacity
                    style={styles.pickerRow}
                    onPress={() => handlePickRepair(repair)}
                    accessibilityRole="button"
                    accessibilityLabel={`Pick repair ${repair.repair_number}`}>
                    <View style={styles.pickerRowLeft}>
                      <Text style={styles.pickerRowNumber}>
                        REP-{repair.repair_number}
                      </Text>
                      <Text
                        style={styles.pickerRowIssue}
                        numberOfLines={2}>
                        {repair.issue_description}
                      </Text>
                    </View>
                    {repair.estimated_cost != null ? (
                      <Text style={styles.pickerRowCost}>
                        {'$' + repair.estimated_cost.toFixed(2)}
                      </Text>
                    ) : null}
                  </TouchableOpacity>
                )}
              />
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  dismissArea: {
    flex: 1,
  },
  keyboardView: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    gap: SPACING.md,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: SPACING.xs,
    paddingRight: SPACING.sm,
    marginLeft: -SPACING.xs, // visual alignment to the screen edge
  },
  backText: {
    color: COLORS.text,
    fontSize: FONT_SIZE.md,
    fontFamily: FONT_FAMILY.medium,
  },
  headerTitle: {
    color: COLORS.text,
    fontSize: FONT_SIZE.xxl,
    fontFamily: FONT_FAMILY.bold,
    flex: 1,
  },
  headerCount: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.md,
  },
  customerChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    marginHorizontal: SPACING.md,
    marginBottom: SPACING.sm,
    paddingVertical: SPACING.sm + 2,
    paddingHorizontal: SPACING.md,
    borderRadius: BORDER_RADIUS.lg,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.surfaceBorder,
  },
  customerChipText: {
    flex: 1,
    minWidth: 0,
  },
  customerChipLabel: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.xs,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  customerChipValue: {
    color: COLORS.text,
    fontSize: FONT_SIZE.md,
    fontFamily: FONT_FAMILY.medium,
    marginTop: 2,
  },
  customerChipChange: {
    color: COLORS.accent,
    fontSize: FONT_SIZE.sm,
    fontFamily: FONT_FAMILY.medium,
  },
  listContent: {
    padding: SPACING.md,
    flexGrow: 1,
  },
  cartItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.surfaceBorder,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.sm,
  },
  cartItemInfo: {
    flex: 1,
    marginRight: SPACING.md,
  },
  cartItemName: {
    color: COLORS.text,
    fontSize: FONT_SIZE.md,
    fontFamily: FONT_FAMILY.medium,
  },
  cartItemSku: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.xs,
    marginTop: 2,
  },
  cartItemPrice: {
    color: COLORS.textLight,
    fontSize: FONT_SIZE.sm,
    marginTop: SPACING.xs,
    fontVariant: ['tabular-nums'],
  },
  quantityStepper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.toolbarBtn,
    borderWidth: 1,
    borderColor: COLORS.toolbarBtnBorder,
    borderRadius: BORDER_RADIUS.md,
    overflow: 'hidden',
    gap: SPACING.xs,
  },
  stepperButton: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
  },
  quantityText: {
    color: COLORS.text,
    fontSize: FONT_SIZE.md,
    fontFamily: FONT_FAMILY.medium,
    minWidth: 28,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  deleteButton: {
    marginLeft: SPACING.sm,
    padding: SPACING.sm,
  },
  inputsSection: {
    paddingHorizontal: SPACING.md,
    paddingBottom: SPACING.md,
  },
  inputRow: {
    marginBottom: SPACING.sm,
  },
  inputLabel: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.sm,
    marginBottom: SPACING.xs,
  },
  discountHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.xs,
  },
  discountModeToggle: {
    flexDirection: 'row',
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.surfaceBorder,
    borderRadius: BORDER_RADIUS.full,
    padding: 2,
  },
  discountModeBtn: {
    minWidth: 36,
    paddingHorizontal: SPACING.sm + 2,
    // ~36pt visible height; with hitSlop (8 top/bottom) the effective
    // tap target clears Apple HIG's 44pt floor while the pill stays
    // visually tight inside the segmented toggle.
    paddingVertical: SPACING.sm,
    borderRadius: BORDER_RADIUS.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  discountModeBtnActive: {
    backgroundColor: COLORS.crimson,
  },
  discountModeText: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.sm,
    fontFamily: FONT_FAMILY.semibold,
    letterSpacing: 0.2,
  },
  discountModeTextActive: {
    color: COLORS.white,
  },
  keyboardAccessory: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderTopWidth: 1,
    borderTopColor: COLORS.surfaceBorder,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
  },
  keyboardAccessoryDone: {
    color: COLORS.crimson,
    fontSize: FONT_SIZE.md,
    fontFamily: FONT_FAMILY.semibold,
    paddingHorizontal: SPACING.sm,
  },
  input: {
    backgroundColor: COLORS.inputBg,
    borderWidth: 1,
    borderColor: COLORS.inputBorder,
    borderRadius: BORDER_RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    color: COLORS.text,
    fontSize: FONT_SIZE.md,
  },
  notesInput: {
    minHeight: 48,
    textAlignVertical: 'top',
  },
  discountHelper: {
    color: COLORS.danger,
    fontSize: FONT_SIZE.xs,
    marginTop: SPACING.xs,
  },
  summaryCard: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.surfaceBorder,
    borderTopLeftRadius: BORDER_RADIUS.xl,
    borderTopRightRadius: BORDER_RADIUS.xl,
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.lg,
    paddingBottom: SPACING.xl,
    shadowColor: COLORS.black,
    shadowOffset: {width: 0, height: -2},
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 4,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: SPACING.xs,
  },
  summaryLabel: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.sm,
  },
  summaryValue: {
    color: COLORS.text,
    fontSize: FONT_SIZE.sm,
    fontVariant: ['tabular-nums'],
  },
  summaryDiscountValue: {
    color: COLORS.warning,
    fontFamily: FONT_FAMILY.medium,
  },
  summaryDivider: {
    height: 1,
    backgroundColor: COLORS.border,
    marginTop: SPACING.sm,
    marginBottom: SPACING.sm,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.lg,
  },
  totalLabel: {
    color: COLORS.text,
    fontSize: FONT_SIZE.lg,
    fontFamily: FONT_FAMILY.bold,
  },
  totalValue: {
    color: COLORS.crimson,
    fontSize: FONT_SIZE.xxl,
    fontFamily: FONT_FAMILY.bold,
    fontVariant: ['tabular-nums'],
  },
  buttonRow: {
    flexDirection: 'row',
    gap: SPACING.md,
  },
  clearButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: COLORS.danger,
    borderRadius: BORDER_RADIUS.lg,
    paddingVertical: SPACING.md,
    alignItems: 'center',
  },
  clearButtonText: {
    color: COLORS.danger,
    fontSize: FONT_SIZE.md,
    fontFamily: FONT_FAMILY.medium,
  },
  checkoutButton: {
    flex: 2,
    backgroundColor: COLORS.accent,
    borderRadius: BORDER_RADIUS.lg,
    paddingVertical: SPACING.md,
    alignItems: 'center',
  },
  checkoutButtonText: {
    color: COLORS.white,
    fontSize: FONT_SIZE.md,
    fontFamily: FONT_FAMILY.bold,
  },
  // T8 — Repair link affordance + linked chip. Both sit under the header
  // row, above the customer chip. The "Take payment for repair" link uses
  // the accent colour so it reads as an actionable link, not a chip
  // showing a currently-linked repair.
  repairLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    marginHorizontal: SPACING.md,
    marginBottom: SPACING.sm,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
    borderRadius: BORDER_RADIUS.lg,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.surfaceBorder,
  },
  repairLinkTextAction: {
    flex: 1,
    color: COLORS.accent,
    fontSize: FONT_SIZE.md,
    fontFamily: FONT_FAMILY.medium,
  },
  repairLinkChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    marginHorizontal: SPACING.md,
    marginBottom: SPACING.sm,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
    borderRadius: BORDER_RADIUS.lg,
    // Cream tint so a currently-linked repair reads as "attached", not as
    // an available action.
    backgroundColor: COLORS.cream,
    borderWidth: 1,
    borderColor: COLORS.crimson,
  },
  repairLinkText: {
    flex: 1,
    color: COLORS.text,
    fontSize: FONT_SIZE.md,
    fontFamily: FONT_FAMILY.medium,
  },
  // Picker sheet
  pickerBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  pickerSheet: {
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: BORDER_RADIUS.xl,
    borderTopRightRadius: BORDER_RADIUS.xl,
    padding: SPACING.md,
    maxHeight: '75%',
  },
  pickerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.md,
  },
  pickerTitle: {
    color: COLORS.text,
    fontSize: FONT_SIZE.lg,
    fontFamily: FONT_FAMILY.bold,
  },
  pickerCenter: {
    padding: SPACING.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickerEmpty: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.md,
    textAlign: 'center',
  },
  pickerError: {
    color: COLORS.danger,
    fontSize: FONT_SIZE.md,
    textAlign: 'center',
  },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.surfaceBorder,
  },
  pickerRowLeft: {
    flex: 1,
    marginRight: SPACING.md,
  },
  pickerRowNumber: {
    color: COLORS.text,
    fontSize: FONT_SIZE.md,
    fontFamily: FONT_FAMILY.bold,
    fontVariant: ['tabular-nums'],
  },
  pickerRowIssue: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.sm,
    marginTop: 2,
  },
  pickerRowCost: {
    color: COLORS.text,
    fontSize: FONT_SIZE.md,
    fontFamily: FONT_FAMILY.bold,
    fontVariant: ['tabular-nums'],
  },
});
