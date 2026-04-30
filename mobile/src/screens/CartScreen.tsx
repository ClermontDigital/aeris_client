import React, {useCallback} from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Alert,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {COLORS, SPACING, FONT_SIZE, BORDER_RADIUS} from '../constants/theme';
import {useCartStore} from '../stores/cartStore';
import type {CartItem} from '../types/api.types';
import type {QuickSaleStackParamList} from '../types/navigation.types';

type NavigationProp = NativeStackNavigationProp<QuickSaleStackParamList>;

const formatCurrency = (cents: number) => '$' + (cents / 100).toFixed(2);

export default function CartScreen() {
  const navigation = useNavigation<NavigationProp>();
  const {
    items,
    discountCents,
    notes,
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
    navigation.navigate('Checkout');
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
            onPress={() =>
              updateQuantity(item.product.id, item.quantity - 1)
            }>
            <Text style={styles.stepperButtonText}>-</Text>
          </TouchableOpacity>
          <Text style={styles.quantityText}>{item.quantity}</Text>
          <TouchableOpacity
            style={styles.stepperButton}
            onPress={() =>
              updateQuantity(item.product.id, item.quantity + 1)
            }>
            <Text style={styles.stepperButtonText}>+</Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity
          style={styles.deleteButton}
          onPress={() => handleSwipeDelete(item.product.id)}>
          <Text style={styles.deleteButtonText}>X</Text>
        </TouchableOpacity>
      </View>
    );
  };

  const renderEmpty = () => (
    <View style={styles.emptyContainer}>
      <Text style={styles.emptyText}>Your cart is empty</Text>
      <Text style={styles.emptySubtext}>
        Add products from the Quick Sale screen
      </Text>
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Cart</Text>
        <Text style={styles.headerCount}>
          {itemCount} {itemCount === 1 ? 'item' : 'items'}
        </Text>
      </View>

      {/* Cart Items */}
      <FlatList
        data={items}
        renderItem={renderCartItem}
        keyExtractor={item => String(item.product.id)}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={renderEmpty}
      />

      {/* Discount & Notes */}
      {items.length > 0 && (
        <View style={styles.inputsSection}>
          <View style={styles.inputRow}>
            <Text style={styles.inputLabel}>Discount (cents)</Text>
            <TextInput
              style={styles.input}
              value={discountCents > 0 ? String(discountCents) : ''}
              onChangeText={text => {
                const val = parseInt(text, 10);
                setDiscount(isNaN(val) ? 0 : val);
              }}
              keyboardType="numeric"
              placeholder="0"
              placeholderTextColor={COLORS.textDim}
            />
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
              <Text style={[styles.summaryValue, {color: COLORS.danger}]}>
                -{formatCurrency(discountCents)}
              </Text>
            </View>
          )}
          <View style={[styles.summaryRow, styles.totalRow]}>
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  headerTitle: {
    color: COLORS.text,
    fontSize: FONT_SIZE.xxl,
    fontWeight: '700',
  },
  headerCount: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.md,
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
    fontWeight: '600',
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
  },
  quantityStepper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.toolbarBtn,
    borderWidth: 1,
    borderColor: COLORS.toolbarBtnBorder,
    borderRadius: BORDER_RADIUS.md,
    overflow: 'hidden',
  },
  stepperButton: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
  },
  stepperButtonText: {
    color: COLORS.text,
    fontSize: FONT_SIZE.lg,
    fontWeight: '700',
  },
  quantityText: {
    color: COLORS.text,
    fontSize: FONT_SIZE.md,
    fontWeight: '600',
    minWidth: 28,
    textAlign: 'center',
  },
  deleteButton: {
    marginLeft: SPACING.sm,
    padding: SPACING.sm,
  },
  deleteButtonText: {
    color: COLORS.danger,
    fontSize: FONT_SIZE.md,
    fontWeight: '700',
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: SPACING.xxl,
  },
  emptyText: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.lg,
    fontWeight: '600',
  },
  emptySubtext: {
    color: COLORS.textDim,
    fontSize: FONT_SIZE.sm,
    marginTop: SPACING.sm,
  },
  inputsSection: {
    paddingHorizontal: SPACING.md,
    paddingBottom: SPACING.sm,
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
  summaryCard: {
    backgroundColor: COLORS.surfaceHover,
    borderWidth: 1,
    borderColor: COLORS.surfaceBorder,
    borderTopLeftRadius: BORDER_RADIUS.xl,
    borderTopRightRadius: BORDER_RADIUS.xl,
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.lg,
    paddingBottom: SPACING.xl,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: SPACING.sm,
  },
  summaryLabel: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.md,
  },
  summaryValue: {
    color: COLORS.text,
    fontSize: FONT_SIZE.md,
  },
  totalRow: {
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    paddingTop: SPACING.sm,
    marginTop: SPACING.xs,
    marginBottom: SPACING.lg,
  },
  totalLabel: {
    color: COLORS.text,
    fontSize: FONT_SIZE.lg,
    fontWeight: '700',
  },
  totalValue: {
    color: COLORS.accent,
    fontSize: FONT_SIZE.xl,
    fontWeight: '700',
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
    fontWeight: '600',
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
    fontWeight: '700',
  },
});
