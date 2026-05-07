import {create} from 'zustand';
import type {Product, CartItem} from '../types/api.types';
import {
  clampDiscountCents,
  getItemCount,
  getSubtotalCents,
  getTaxCents,
  getTotalCents,
} from '@aeris/shared';

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
  setDiscount: (cents) => {
    set({discountCents: clampDiscountCents(get().items, cents)});
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

  getSubtotalCents: () => getSubtotalCents(get().items),
  getTaxCents: () => getTaxCents(get().items),
  getTotalCents: () => getTotalCents(get().items, get().discountCents),
  getItemCount: () => getItemCount(get().items),
}));
