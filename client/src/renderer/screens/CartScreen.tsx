import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, Minus, Plus, Trash2 } from 'lucide-react';
import type { ProductDetail } from '@aeris/shared';
import { useCartStore } from '../stores/cartStore';
import { relayCall } from '../services/relay';
import { Button } from '../components/Button';
import { Modal } from '../components/Modal';
import { ErrorBanner } from '../components/ErrorBanner';
import { COLORS, SPACING, FONT_SIZE, BORDER_RADIUS } from '../theme/tokens';
import { formatCents } from '../utils/format';

export function CartScreen(): React.ReactElement {
  const navigate = useNavigate();
  const items = useCartStore((s) => s.items);
  const discountCents = useCartStore((s) => s.discountCents);
  const notes = useCartStore((s) => s.notes);
  const updateQuantity = useCartStore((s) => s.updateQuantity);
  const removeItem = useCartStore((s) => s.removeItem);
  const setDiscount = useCartStore((s) => s.setDiscount);
  const setNotes = useCartStore((s) => s.setNotes);
  const clear = useCartStore((s) => s.clear);
  const addItem = useCartStore((s) => s.addItem);
  const subtotal = useCartStore((s) => s.getSubtotalCents());
  const tax = useCartStore((s) => s.getTaxCents());
  const total = useCartStore((s) => s.getTotalCents());
  const itemCount = useCartStore((s) => s.getItemCount());

  const [discountInput, setDiscountInput] = useState<string>(
    discountCents > 0 ? (discountCents / 100).toFixed(2) : '',
  );
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const [barcode, setBarcode] = useState('');
  const [barcodeError, setBarcodeError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);

  // Mirror store-side discount changes (clamping, clear) into the controlled input.
  useEffect(() => {
    setDiscountInput(discountCents > 0 ? (discountCents / 100).toFixed(2) : '');
  }, [discountCents]);

  const commitDiscount = useCallback(() => {
    const trimmed = discountInput.trim();
    if (trimmed === '') {
      setDiscount(0);
      return;
    }
    const dollars = parseFloat(trimmed);
    if (!Number.isFinite(dollars) || dollars < 0) {
      setDiscount(0);
      setDiscountInput('');
      return;
    }
    setDiscount(Math.round(dollars * 100));
  }, [discountInput, setDiscount]);

  // USB barcode scanners present as keyboard wedges — they type the
  // captured digits and emit Enter. No camera scanner in 2.1; v2.2 will
  // pick up that work behind a quagga2/jsQR replacement.
  const handleBarcodeSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const code = barcode.trim();
      if (!code) return;
      setScanning(true);
      setBarcodeError(null);
      const res = await relayCall<ProductDetail | null>('products.barcode', {
        barcode: code,
      });
      setScanning(false);
      if (!res.ok) {
        setBarcodeError(res.message || 'Lookup failed');
      } else if (res.data) {
        addItem(res.data);
        setBarcode('');
      } else {
        setBarcodeError(`No product matches barcode "${code}".`);
      }
    },
    [addItem, barcode],
  );

  return (
    <section
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: SPACING.md,
        height: '100%',
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: SPACING.md,
        }}
      >
        <Button
          variant="ghost"
          onClick={() => navigate('/pos')}
          aria-label="Back to products"
          style={{ display: 'flex', alignItems: 'center', gap: SPACING.xs, paddingLeft: 0 }}
        >
          <ChevronLeft size={18} aria-hidden /> Products
        </Button>
        <h1 style={{ margin: 0, color: COLORS.text, fontSize: FONT_SIZE.xxl }}>Cart</h1>
        <span style={{ color: COLORS.textMuted, fontSize: FONT_SIZE.md }}>
          {itemCount} {itemCount === 1 ? 'item' : 'items'}
        </span>
      </header>

      <form
        onSubmit={handleBarcodeSubmit}
        style={{ display: 'flex', gap: SPACING.sm }}
        aria-label="Barcode scan input"
      >
        <input
          type="text"
          value={barcode}
          onChange={(e) => setBarcode(e.target.value)}
          placeholder="Scan or type barcode, press Enter"
          aria-label="Barcode"
          autoFocus
          style={{
            flex: 1,
            padding: `${SPACING.sm}px ${SPACING.md}px`,
            background: COLORS.inputBg,
            border: `1px solid ${COLORS.inputBorder}`,
            borderRadius: BORDER_RADIUS.md,
            fontSize: FONT_SIZE.md,
            color: COLORS.text,
            outline: 'none',
          }}
        />
        <Button type="submit" variant="secondary" disabled={scanning || !barcode.trim()}>
          {scanning ? 'Looking up...' : 'Add'}
        </Button>
      </form>
      {barcodeError ? (
        <ErrorBanner message={barcodeError} onDismiss={() => setBarcodeError(null)} />
      ) : null}

      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          background: COLORS.surface,
          border: `1px solid ${COLORS.surfaceBorder}`,
          borderRadius: BORDER_RADIUS.lg,
          padding: items.length === 0 ? SPACING.xl : SPACING.sm,
        }}
      >
        {items.length === 0 ? (
          <div
            style={{
              textAlign: 'center',
              color: COLORS.textMuted,
              padding: SPACING.xl,
            }}
          >
            <p style={{ fontSize: FONT_SIZE.lg, fontWeight: 600, margin: 0 }}>
              Your cart is empty
            </p>
            <p style={{ marginTop: SPACING.sm }}>
              Add products from Quick Sale or scan a barcode.
            </p>
          </div>
        ) : (
          items.map((item) => {
            const lineTotal = item.unit_price_cents * item.quantity;
            return (
              <div
                key={item.product.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: SPACING.md,
                  padding: SPACING.sm,
                  borderBottom: `1px solid ${COLORS.surfaceBorder}`,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      color: COLORS.text,
                      fontSize: FONT_SIZE.md,
                      fontWeight: 600,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {item.product.name}
                  </div>
                  <div style={{ color: COLORS.textMuted, fontSize: FONT_SIZE.xs }}>
                    {item.product.sku}
                  </div>
                  <div style={{ color: COLORS.textLight, fontSize: FONT_SIZE.sm, marginTop: 2 }}>
                    {formatCents(item.unit_price_cents)} × {item.quantity} = {formatCents(lineTotal)}
                    {item.discount_cents > 0 ? (
                      <span style={{ color: COLORS.warning, marginLeft: SPACING.sm }}>
                        −{formatCents(item.discount_cents)}
                      </span>
                    ) : null}
                  </div>
                </div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: SPACING.xs,
                    border: `1px solid ${COLORS.surfaceBorder}`,
                    borderRadius: BORDER_RADIUS.md,
                    overflow: 'hidden',
                  }}
                >
                  <button
                    type="button"
                    onClick={() => updateQuantity(item.product.id, item.quantity - 1)}
                    aria-label={`Decrease ${item.product.name}`}
                    style={{
                      background: 'transparent',
                      border: 0,
                      padding: `${SPACING.sm}px ${SPACING.md}px`,
                      cursor: 'pointer',
                      color: COLORS.text,
                    }}
                  >
                    <Minus size={18} aria-hidden />
                  </button>
                  <span
                    style={{
                      minWidth: 28,
                      textAlign: 'center',
                      fontWeight: 600,
                      color: COLORS.text,
                    }}
                  >
                    {item.quantity}
                  </span>
                  <button
                    type="button"
                    onClick={() => updateQuantity(item.product.id, item.quantity + 1)}
                    aria-label={`Increase ${item.product.name}`}
                    style={{
                      background: 'transparent',
                      border: 0,
                      padding: `${SPACING.sm}px ${SPACING.md}px`,
                      cursor: 'pointer',
                      color: COLORS.text,
                    }}
                  >
                    <Plus size={18} aria-hidden />
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => removeItem(item.product.id)}
                  aria-label={`Remove ${item.product.name}`}
                  style={{
                    background: 'transparent',
                    border: 0,
                    padding: SPACING.sm,
                    color: COLORS.danger,
                    cursor: 'pointer',
                    display: 'flex',
                  }}
                >
                  <Trash2 size={18} aria-hidden />
                </button>
              </div>
            );
          })
        )}
      </div>

      {items.length > 0 ? (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: SPACING.md,
          }}
        >
          <label
            style={{ display: 'flex', flexDirection: 'column', gap: SPACING.xs }}
          >
            <span style={{ color: COLORS.textMuted, fontSize: FONT_SIZE.sm }}>
              Discount ($)
            </span>
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              value={discountInput}
              onChange={(e) => setDiscountInput(e.target.value)}
              onBlur={commitDiscount}
              placeholder="0.00"
              aria-label="Cart discount"
              style={{
                padding: `${SPACING.sm}px ${SPACING.md}px`,
                background: COLORS.inputBg,
                border: `1px solid ${COLORS.inputBorder}`,
                borderRadius: BORDER_RADIUS.md,
                fontSize: FONT_SIZE.md,
                color: COLORS.text,
                outline: 'none',
              }}
            />
          </label>
          <label
            style={{ display: 'flex', flexDirection: 'column', gap: SPACING.xs }}
          >
            <span style={{ color: COLORS.textMuted, fontSize: FONT_SIZE.sm }}>Notes</span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Order notes..."
              rows={2}
              aria-label="Order notes"
              style={{
                padding: `${SPACING.sm}px ${SPACING.md}px`,
                background: COLORS.inputBg,
                border: `1px solid ${COLORS.inputBorder}`,
                borderRadius: BORDER_RADIUS.md,
                fontSize: FONT_SIZE.md,
                color: COLORS.text,
                outline: 'none',
                resize: 'vertical',
                fontFamily: 'inherit',
              }}
            />
          </label>
        </div>
      ) : null}

      {items.length > 0 ? (
        <div
          className="aeris-card"
          style={{
            background: COLORS.surface,
            border: `1px solid ${COLORS.surfaceBorder}`,
            borderRadius: BORDER_RADIUS.lg,
            padding: SPACING.lg,
          }}
        >
          <SummaryRow label="Subtotal" value={formatCents(subtotal)} />
          <SummaryRow label="Tax" value={formatCents(tax)} />
          {discountCents > 0 ? (
            <SummaryRow
              label="Discount"
              value={`−${formatCents(discountCents)}`}
              valueColor={COLORS.warning}
            />
          ) : null}
          <div
            style={{
              borderTop: `1px solid ${COLORS.surfaceBorder}`,
              marginTop: SPACING.sm,
              paddingTop: SPACING.sm,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <span style={{ fontSize: FONT_SIZE.lg, fontWeight: 700, color: COLORS.text }}>
              Total
            </span>
            <span style={{ fontSize: FONT_SIZE.xxl, fontWeight: 700, color: COLORS.crimson }}>
              {formatCents(total)}
            </span>
          </div>

          <div style={{ display: 'flex', gap: SPACING.md, marginTop: SPACING.lg }}>
            <Button
              variant="secondary"
              onClick={() => setConfirmClearOpen(true)}
              style={{
                color: COLORS.danger,
                borderColor: COLORS.danger,
                flex: 1,
              }}
            >
              Clear cart
            </Button>
            <Button
              variant="primary"
              onClick={() => navigate('/pos/checkout')}
              style={{ flex: 2 }}
            >
              Continue to checkout
            </Button>
          </div>
        </div>
      ) : null}

      <Modal
        open={confirmClearOpen}
        onClose={() => setConfirmClearOpen(false)}
        title="Clear cart?"
        actions={
          <>
            <Button variant="secondary" onClick={() => setConfirmClearOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                clear();
                setConfirmClearOpen(false);
              }}
            >
              Clear
            </Button>
          </>
        }
      >
        <p style={{ margin: 0, color: COLORS.textMuted }}>
          Remove all {itemCount} {itemCount === 1 ? 'item' : 'items'} from the cart?
        </p>
      </Modal>
    </section>
  );
}

function SummaryRow({
  label,
  value,
  valueColor,
}: {
  label: string;
  value: string;
  valueColor?: string;
}): React.ReactElement {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: `${SPACING.xs}px 0`,
      }}
    >
      <span style={{ color: COLORS.textMuted, fontSize: FONT_SIZE.sm }}>{label}</span>
      <span
        style={{
          color: valueColor ?? COLORS.text,
          fontSize: FONT_SIZE.sm,
          fontWeight: valueColor ? 600 : 400,
        }}
      >
        {value}
      </span>
    </div>
  );
}
