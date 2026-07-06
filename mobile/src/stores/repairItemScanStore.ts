import {create} from 'zustand';
import type {Product} from '../types/api.types';

// Hand-off channel for "scan a product barcode to add it to a repair".
//
// The barcode scanner is a full-screen route presented over the (formSheet)
// RepairItemsEditorSheet. Passing the resolved product back through
// navigation params is awkward for an object + a formSheet that stays mounted
// underneath, so the scanner writes the hit here and pops; the editor
// subscribes and links the product on the next render, then clears it.
//
// `pendingProduct` is null except in the brief window between a successful
// scan and the editor consuming it. The editor clears it immediately after
// linking (and on open) so a stale scan can't leak into a later session.
interface RepairItemScanState {
  pendingProduct: Product | null;
  setPendingProduct: (product: Product) => void;
  clear: () => void;
}

export const useRepairItemScanStore = create<RepairItemScanState>(set => ({
  pendingProduct: null,
  setPendingProduct: product => set({pendingProduct: product}),
  clear: () => set({pendingProduct: null}),
}));
