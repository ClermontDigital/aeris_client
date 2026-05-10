import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import {
  clampDiscountCents,
  getItemCount,
  getSubtotalCents,
  getTaxCents,
  getTotalCents,
  type CartItem,
  type Product,
} from '@aeris/shared';
import { useAuthStore } from './authStore';

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

  getSubtotalCents: () => number;
  getTaxCents: () => number;
  getTotalCents: () => number;
  getItemCount: () => number;
}

// Cart math defers to @aeris/shared so the desktop, mobile, and the server
// agree on the inc-GST split. Keep the store thin: it stores raw cart state
// and delegates totals.
export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],
      customerId: null,
      customerName: null,
      discountCents: 0,
      notes: '',

      addItem: (product, quantity = 1) => {
        set((state) => {
          const existing = state.items.find((i) => i.product.id === product.id);
          if (existing) {
            return {
              items: state.items.map((i) =>
                i.product.id === product.id
                  ? { ...i, quantity: i.quantity + quantity }
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

      removeItem: (productId) => {
        set((state) => ({
          items: state.items.filter((i) => i.product.id !== productId),
        }));
      },

      updateQuantity: (productId, quantity) => {
        if (quantity <= 0) {
          get().removeItem(productId);
          return;
        }
        set((state) => ({
          items: state.items.map((i) =>
            i.product.id === productId ? { ...i, quantity } : i,
          ),
        }));
      },

      setCustomer: (id, name) => set({ customerId: id, customerName: name }),

      // Re-clamp on every set so a user typing past the line-total cap can't
      // produce a negative grand total — clampDiscountCents floors at the
      // pre-discount inc-GST line total.
      setDiscount: (cents) => {
        set({ discountCents: clampDiscountCents(get().items, cents) });
      },

      setNotes: (notes) => set({ notes }),

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
    }),
    {
      name: 'aeris-cart',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        items: state.items,
        customerId: state.customerId,
        customerName: state.customerName,
        discountCents: state.discountCents,
        notes: state.notes,
      }),
    },
  ),
);

// Drop the cart on logout so the next operator can't pick up a half-built
// sale. authStore is the single source of truth — a renderer-side
// subscribe is the cleanest path that keeps everything inside cartStore.
let lastAuthed = useAuthStore.getState().isAuthenticated;
useAuthStore.subscribe((state) => {
  if (lastAuthed && !state.isAuthenticated) {
    useCartStore.getState().clear();
  }
  lastAuthed = state.isAuthenticated;
});
