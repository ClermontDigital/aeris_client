import {create} from 'zustand';
import type {Product, CartItem} from '../types/api.types';

interface CartState {
  items: CartItem[];
  customerId: number | null;
  customerName: string | null;
  discountCents: number;
  notes: string;

  addItem: (product: Product, quantity?: number) => void;
  removeItem: (productId: number) => void;
  updateQuantity: (productId: number, quantity: number) => void;
  setCustomer: (id: number | null, name: string | null) => void;
  setDiscount: (cents: number) => void;
  setNotes: (notes: string) => void;
  clear: () => void;

  // Computed-like getters
  getSubtotalCents: () => number;
  getTaxCents: () => number;
  getTotalCents: () => number;
  getItemCount: () => number;
}

export const useCartStore = create<CartState>((set, get) => ({
  items: [],
  customerId: null,
  customerName: null,
  discountCents: 0,
  notes: '',

  addItem: (product: Product, quantity = 1) => {
    set(state => {
      const existing = state.items.find(i => i.product.id === product.id);
      if (existing) {
        return {
          items: state.items.map(i =>
            i.product.id === product.id
              ? {...i, quantity: i.quantity + quantity}
              : i,
          ),
        };
      }
      return {
        items: [
          ...state.items,
          {
            product,
            quantity,
            unit_price_cents: product.price_cents,
            discount_cents: 0,
          },
        ],
      };
    });
  },

  removeItem: (productId: number) => {
    set(state => ({
      items: state.items.filter(i => i.product.id !== productId),
    }));
  },

  updateQuantity: (productId: number, quantity: number) => {
    if (quantity <= 0) {
      get().removeItem(productId);
      return;
    }
    set(state => ({
      items: state.items.map(i =>
        i.product.id === productId ? {...i, quantity} : i,
      ),
    }));
  },

  setCustomer: (id, name) => set({customerId: id, customerName: name}),
  // Discount is taken off the inc-GST grand total (subtotal_ex + tax = line
  // total inc), so the cap is the sum of the line totals before discount.
  // Clamping there floors the final total at $0.
  setDiscount: (cents) => {
    const lineTotalInc = get().items.reduce(
      (sum, item) =>
        sum + item.unit_price_cents * item.quantity - item.discount_cents,
      0,
    );
    const safeMax = Math.max(0, lineTotalInc);
    const numeric = Number.isFinite(cents) ? cents : 0;
    const clamped = Math.max(0, Math.min(numeric, safeMax));
    set({discountCents: clamped});
  },
  setNotes: (notes) => set({notes}),
  clear: () =>
    set({
      items: [],
      customerId: null,
      customerName: null,
      discountCents: 0,
      notes: '',
    }),

  // unit_price_cents is GST-inclusive (Product.price_cents is inc-GST), so
  // each line total is inc-GST. To match the server (SaleDetailScreen +
  // ProcessSaleRequest), the cart exposes the same shape: subtotal is the
  // ex-GST split, tax is the embedded GST, total = subtotal + tax - cart
  // discount. Computing tax as (lineTotalInc - subtotal) mirrors the
  // server's single-round `tax = totalInc - round(totalInc/1.1)` exactly,
  // so subtotal + tax === lineTotalInc with no per-line drift.
  getSubtotalCents: () => {
    const subtotalFloat = get().items.reduce((sum, item) => {
      const lineInc =
        item.unit_price_cents * item.quantity - item.discount_cents;
      const rate = item.product.tax_rate;
      if (!rate || !Number.isFinite(rate)) return sum + lineInc;
      return sum + lineInc / (1 + rate / 100);
    }, 0);
    return Math.round(subtotalFloat);
  },

  getTaxCents: () => {
    const lineTotalInc = get().items.reduce(
      (sum, item) =>
        sum + item.unit_price_cents * item.quantity - item.discount_cents,
      0,
    );
    return lineTotalInc - get().getSubtotalCents();
  },

  getTotalCents: () => {
    const lineTotalInc = get().items.reduce(
      (sum, item) =>
        sum + item.unit_price_cents * item.quantity - item.discount_cents,
      0,
    );
    return lineTotalInc - get().discountCents;
  },

  getItemCount: () => {
    return get().items.reduce((sum, item) => sum + item.quantity, 0);
  },
}));
