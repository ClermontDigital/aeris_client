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
  // Clamp discount into [0, subtotal+tax]. We deliberately use the
  // pre-discount total here — a negative result would let the cashier
  // print a sale where the customer owes nothing or even gets cash back,
  // which the gateway would reject anyway. NaN/negative input defaults
  // to 0; any over-cap value caps at subtotal+tax so the final total
  // bottoms at $0.
  setDiscount: (cents) => {
    const max = get().getSubtotalCents() + get().getTaxCents();
    const safeMax = Math.max(0, max);
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

  getSubtotalCents: () => {
    return get().items.reduce(
      (sum, item) =>
        sum + item.unit_price_cents * item.quantity - item.discount_cents,
      0,
    );
  },

  getTaxCents: () => {
    // Aeris2's ProductResource emits tax_rate as a *percentage* number
    // (e.g. `tax_rate: 10` for 10% GST). The cart math needs a decimal
    // multiplier, hence /100. Without this divide, a $10 item with 10%
    // GST computes to $100 of tax instead of $1.
    return get().items.reduce(
      (sum, item) =>
        sum +
        Math.round(
          ((item.unit_price_cents * item.quantity - item.discount_cents) *
            item.product.tax_rate) /
            100,
        ),
      0,
    );
  },

  getTotalCents: () => {
    return get().getSubtotalCents() + get().getTaxCents() - get().discountCents;
  },

  getItemCount: () => {
    return get().items.reduce((sum, item) => sum + item.quantity, 0);
  },
}));
