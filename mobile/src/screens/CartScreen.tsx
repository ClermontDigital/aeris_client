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
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {Ionicons} from '@expo/vector-icons';
import {
  COLORS,
  SPACING,
  FONT_SIZE,
  FONT_FAMILY,
  BORDER_RADIUS,
  ICON_SIZE,
} from '../constants/theme';
import {useCartStore} from '../stores/cartStore';
import {useHaptics} from '../hooks/useHaptics';
import EmptyState from '../components/EmptyState';
import type {CartItem} from '../types/api.types';
import type {QuickSaleStackParamList} from '../types/navigation.types';
import {formatCurrency} from '../utils/format';

type NavigationProp = NativeStackNavigationProp<QuickSaleStackParamList>;

export default function CartScreen() {
  const navigation = useNavigation<NavigationProp>();
  const haptics = useHaptics();
  const {
    items,
    discountCents,
    notes,
    customerId,
    customerName,
    updateQuantity,
    removeItem,
    setDiscount,
    setNotes,
    clear,
    getSubtotalCents,
    getTaxCents,
    getTotalCents,
    getItemCount,
  } = useCartStore();

  const subtotal = getSubtotalCents();
  const tax = getTaxCents();
  const total = getTotalCents();
  const itemCount = getItemCount();

  // The discount input is dollars-as-text on screen but the store holds
  // cents. We mirror the store value into local state so the user can type
  // freely (decimal in progress, intermediate empty string) without the
  // store clobbering each keystroke. Commit on blur/submit.
  const [discountInput, setDiscountInput] = useState<string>(
    discountCents > 0 ? (discountCents / 100).toFixed(2) : '',
  );
  const [discountOverCap, setDiscountOverCap] = useState(false);
  const overCapHapticFiredRef = useRef(false);
  // If another path resets discountCents (e.g. clear cart), reflect it.
  useEffect(() => {
    setDiscountInput(discountCents > 0 ? (discountCents / 100).toFixed(2) : '');
  }, [discountCents]);

  const handleDiscountChange = useCallback(
    (text: string) => {
      setDiscountInput(text);
      const trimmed = text.trim();
      if (trimmed === '') {
        setDiscountOverCap(false);
        overCapHapticFiredRef.current = false;
        return;
      }
      const dollars = parseFloat(trimmed);
      if (!Number.isFinite(dollars) || dollars < 0) {
        setDiscountOverCap(false);
        overCapHapticFiredRef.current = false;
        return;
      }
      const requestedCents = Math.round(dollars * 100);
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
    [haptics],
  );

  const commitDiscount = useCallback(() => {
    const trimmed = discountInput.trim();
    if (trimmed === '') {
      setDiscount(0);
      setDiscountOverCap(false);
      overCapHapticFiredRef.current = false;
      return;
    }
    const dollars = parseFloat(trimmed);
    if (!Number.isFinite(dollars) || dollars < 0) {
      setDiscount(0);
      setDiscountInput('');
      setDiscountOverCap(false);
      overCapHapticFiredRef.current = false;
      return;
    }
    const requested = Math.round(dollars * 100);
    setDiscount(requested);
    const after = useCartStore.getState().discountCents;
    if (after !== requested) {
      setDiscountInput(after > 0 ? (after / 100).toFixed(2) : '');
    }
    setDiscountOverCap(false);
    overCapHapticFiredRef.current = false;
  }, [discountInput, setDiscount]);

  const handleClearCart = useCallback(() => {
    Alert.alert(
      'Clear Cart',
      'Are you sure you want to remove all items from the cart?',
      [
        {text: 'Cancel', style: 'cancel'},
        {text: 'Clear', style: 'destructive', onPress: () => clear()},
      ],
    );
  }, [clear]);

  const handleCheckout = useCallback(() => {
    haptics.medium();
    navigation.navigate('Checkout');
  }, [navigation, haptics]);

  const handleBackToProducts = useCallback(() => {
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

  const handleSwipeDelete = useCallback(
    (productId: number) => {
      Alert.alert('Remove Item', 'Remove this item from the cart?', [
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
            {formatCurrency(item.unit_price_cents)} x {item.quantity} ={' '}
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
            <Ionicons
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
            <Ionicons name="add" size={ICON_SIZE.action} color={COLORS.text} />
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
          <Ionicons
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
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={handleBackToProducts}
          accessibilityRole="button"
          accessibilityLabel="Back to products">
          <Ionicons
            name="chevron-back"
            size={ICON_SIZE.action}
            color={COLORS.text}
          />
          <Text style={styles.backText}>Products</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Cart</Text>
        <Text style={styles.headerCount}>
          {itemCount} {itemCount === 1 ? 'item' : 'items'}
        </Text>
      </View>

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
          <Ionicons
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
          <Ionicons
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
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={renderEmpty}
        keyboardShouldPersistTaps="handled"
      />

      {/* Discount & Notes */}
      {items.length > 0 && (
        <View style={styles.inputsSection}>
          <View style={styles.inputRow}>
            <Text style={styles.inputLabel}>Discount ($)</Text>
            <TextInput
              style={styles.input}
              value={discountInput}
              onChangeText={handleDiscountChange}
              onBlur={commitDiscount}
              onSubmitEditing={commitDiscount}
              keyboardType="decimal-pad"
              placeholder="0.00"
              placeholderTextColor={COLORS.textDim}
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
            />
          </View>
        </View>
      )}

      {/* Summary */}
      {items.length > 0 && (
        <View style={styles.summaryCard}>
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
              onPress={handleClearCart}>
              <Text style={styles.clearButtonText}>Clear Cart</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.checkoutButton}
              onPress={handleCheckout}>
              <Text style={styles.checkoutButtonText}>Checkout</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
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
});
