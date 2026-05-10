import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, User } from 'lucide-react';
import type { PaymentMethod } from '@aeris/shared';
import { useCartStore } from '../stores/cartStore';
import { relayCall } from '../services/relay';
import { Button } from '../components/Button';
import { Spinner } from '../components/Spinner';
import { ErrorBanner } from '../components/ErrorBanner';
import { COLORS, SPACING, FONT_SIZE, BORDER_RADIUS } from '../theme/tokens';
import { formatCents } from '../utils/format';

// `account` is workspace-config-dependent; omitting it from defaults so an
// offline fallback can't push the operator into a method the server will 422.
const DEFAULT_PAYMENT_METHODS: PaymentMethod[] = [
  { code: 'cash', name: 'Cash', requires_reference: false },
  { code: 'card', name: 'Card', requires_reference: false },
];

interface SaleResult {
  sale_id: number;
  sale_number: string;
  total_cents: number;
}

export function CheckoutScreen(): React.ReactElement {
  const navigate = useNavigate();
  const items = useCartStore((s) => s.items);
  const customerId = useCartStore((s) => s.customerId);
  const customerName = useCartStore((s) => s.customerName);
  const discountCents = useCartStore((s) => s.discountCents);
  const notes = useCartStore((s) => s.notes);
  const totalCents = useCartStore((s) => s.getTotalCents());
  const itemCount = useCartStore((s) => s.getItemCount());
  const clear = useCartStore((s) => s.clear);

  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>(
    DEFAULT_PAYMENT_METHODS,
  );
  const [paymentMethodsState, setPaymentMethodsState] = useState<
    'loading' | 'live' | 'fallback'
  >('loading');
  const [selectedMethod, setSelectedMethod] = useState<string | null>(null);
  const [amountTendered, setAmountTendered] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saleResult, setSaleResult] = useState<SaleResult | null>(null);
  const [printing, setPrinting] = useState(false);
  const [printToast, setPrintToast] = useState<{
    kind: 'success' | 'error';
    text: string;
  } | null>(null);
  const printToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear any pending toast timer on unmount so React 18 StrictMode doesn't
  // setState after the component is gone.
  useEffect(() => {
    return () => {
      if (printToastTimerRef.current) {
        clearTimeout(printToastTimerRef.current);
        printToastTimerRef.current = null;
      }
    };
  }, []);

  const handlePrintReceipt = useCallback(async () => {
    if (!saleResult || saleResult.sale_id <= 0) return;
    setPrinting(true);
    try {
      const res = await window.aeris.print.receipt(saleResult.sale_id);
      setPrintToast(
        res.ok
          ? { kind: 'success', text: 'Receipt sent to the printer.' }
          : { kind: 'error', text: res.message || 'Print failed.' },
      );
      if (printToastTimerRef.current) clearTimeout(printToastTimerRef.current);
      printToastTimerRef.current = setTimeout(() => {
        setPrintToast(null);
        printToastTimerRef.current = null;
      }, 4000);
    } finally {
      setPrinting(false);
    }
  }, [saleResult]);

  const loadPaymentMethods = useCallback(async () => {
    setPaymentMethodsState('loading');
    const res = await relayCall<PaymentMethod[]>('pos.payment-methods', {});
    if (res.ok && Array.isArray(res.data) && res.data.length > 0) {
      setPaymentMethods(res.data);
      setPaymentMethodsState('live');
    } else {
      // Fall back to cash/card/account so the operator isn't blocked when
      // the workspace's payment-method list isn't reachable. We still mark
      // the state so they see "tap to retry".
      setPaymentMethods(DEFAULT_PAYMENT_METHODS);
      setPaymentMethodsState('fallback');
    }
  }, []);

  useEffect(() => {
    void loadPaymentMethods();
  }, [loadPaymentMethods]);

  const tenderedCents = Math.round(parseFloat(amountTendered || '0') * 100);
  const changeCents =
    selectedMethod === 'cash' && tenderedCents > totalCents
      ? tenderedCents - totalCents
      : 0;

  // Both 'live' and 'fallback' allow submit — fallback keeps the operator
  // selling when the workspace payment-method list is unreachable.
  const canComplete =
    paymentMethodsState !== 'loading' &&
    selectedMethod !== null &&
    items.length > 0 &&
    (selectedMethod !== 'cash' || tenderedCents >= totalCents);

  const handleSubmit = useCallback(async () => {
    if (!selectedMethod) return;
    setSubmitting(true);
    setError(null);
    try {
      // Server reconciles subtotal + tax - discount == sum(payments[].amount)
      // ±$0.02; sending tendered would 422 on overpayment. Recording change
      // server-side waits on a 2.2 `change_cents` field on createSale.
      const payload = {
        items: items.map((i) => ({
          product_id: i.product.id,
          quantity: i.quantity,
          unit_price_cents: i.unit_price_cents,
          // Per-line tax_rate so RelayClient.createSale can flag
          // gst_applicable correctly — without this, GST-free items default
          // to 10% and the server's cross-field math diverges from the cart.
          tax_rate: i.product.tax_rate,
          ...(i.discount_cents ? { discount_cents: i.discount_cents } : {}),
        })),
        payments: [
          { method: selectedMethod, amount_cents: totalCents },
        ],
        ...(customerId != null ? { customer_id: customerId } : {}),
        ...(discountCents > 0 ? { discount_cents: discountCents } : {}),
        ...(notes ? { notes } : {}),
      };
      // relayBridge.callDispatch routes sale.create through the typed
      // RelayClient.createSale, which always returns this normalized shape.
      const res = await relayCall<{
        sale_id: number;
        sale_number: string;
        total_cents: number;
      }>('sale.create', payload);
      if (!res.ok) {
        setError(res.message || 'Sale failed');
        return;
      }
      const d = res.data || { sale_id: 0, sale_number: '', total_cents: totalCents };
      setSaleResult({
        sale_id: d.sale_id,
        sale_number: d.sale_number,
        total_cents: d.total_cents,
      });
      // Drop the cart immediately on success so closing the window or
      // navigating away can't replay the same items into a duplicate sale.
      clear();
    } finally {
      setSubmitting(false);
    }
  }, [
    selectedMethod,
    items,
    totalCents,
    customerId,
    discountCents,
    notes,
    clear,
  ]);

  const handleNewSale = useCallback(() => {
    clear();
    navigate('/pos');
  }, [clear, navigate]);

  const handleViewTransaction = useCallback(() => {
    if (!saleResult) return;
    clear();
    navigate(`/transactions/${saleResult.sale_id}`);
  }, [saleResult, clear, navigate]);

  // Keyboard shortcuts for the cashier persona: F1/F2/F3 pick the first
  // three payment methods, Enter submits, Esc starts a new sale once the
  // success view is up.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (saleResult) {
        if (e.key === 'Escape') {
          e.preventDefault();
          handleNewSale();
        }
        return;
      }
      if (e.key === 'F1' || e.key === 'F2' || e.key === 'F3') {
        if (paymentMethodsState === 'loading') return;
        const idx = Number(e.key.slice(1)) - 1;
        const m = paymentMethods[idx];
        if (m) {
          e.preventDefault();
          setSelectedMethod(m.code);
          setAmountTendered('');
        }
      } else if (e.key === 'Enter') {
        const target = e.target as HTMLElement | null;
        const tag = target?.tagName;
        // Don't hijack Enter while the operator is typing in the tender input.
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        if (canComplete && !submitting) {
          e.preventDefault();
          void handleSubmit();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    saleResult,
    paymentMethodsState,
    paymentMethods,
    canComplete,
    submitting,
    handleNewSale,
    handleSubmit,
  ]);

  if (saleResult) {
    return (
      <section
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '60vh',
          padding: SPACING.lg,
        }}
      >
        <div style={{ width: '100%', maxWidth: 480, display: 'flex', flexDirection: 'column', gap: SPACING.lg }}>
          <div
            className="aeris-card"
            style={{
              background: COLORS.surface,
              border: `1px solid ${COLORS.surfaceBorder}`,
              borderRadius: BORDER_RADIUS.xl,
              padding: SPACING.xl,
              textAlign: 'center',
            }}
          >
            <div
              aria-hidden
              style={{
                width: 56,
                height: 56,
                borderRadius: '50%',
                background: COLORS.success,
                color: COLORS.white,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: SPACING.md,
              }}
            >
              <Check size={24} />
            </div>
            <h2 style={{ margin: 0, color: COLORS.text, fontSize: FONT_SIZE.xxl }}>Sale complete</h2>
            <div style={{ color: COLORS.crimson, fontSize: FONT_SIZE.xl, fontWeight: 700, marginTop: SPACING.sm }}>
              #{saleResult.sale_number || saleResult.sale_id}
            </div>
            <div style={{ color: COLORS.crimson, fontSize: FONT_SIZE.xxl, fontWeight: 700, marginTop: SPACING.xs }}>
              {formatCents(saleResult.total_cents)}
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: SPACING.sm }}>
            <Button
              variant="primary"
              onClick={() => void handlePrintReceipt()}
              loading={printing}
              disabled={printing || saleResult.sale_id <= 0}
            >
              Print receipt
            </Button>
            {printToast ? (
              <div
                role="status"
                style={{
                  color:
                    printToast.kind === 'success' ? COLORS.success : COLORS.danger,
                  fontSize: FONT_SIZE.sm,
                  textAlign: 'center',
                }}
              >
                {printToast.text}
              </div>
            ) : null}
            <Button variant="secondary" onClick={handleViewTransaction}>
              View transaction
            </Button>
            <Button variant="primary" onClick={handleNewSale}>
              New sale
            </Button>
            <div
              style={{
                color: COLORS.textMuted,
                fontSize: FONT_SIZE.xs,
                textAlign: 'center',
                marginTop: SPACING.xs,
              }}
            >
              Esc — New sale
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: SPACING.md }}>
      <header>
        <h1 style={{ margin: 0, color: COLORS.text, fontSize: FONT_SIZE.xxl }}>Checkout</h1>
      </header>

      <div
        className="aeris-card"
        style={{
          background: COLORS.surface,
          border: `1px solid ${COLORS.surfaceBorder}`,
          borderRadius: BORDER_RADIUS.lg,
          padding: SPACING.md,
          display: 'flex',
          alignItems: 'center',
          gap: SPACING.md,
        }}
      >
        <div
          aria-hidden
          style={{
            width: 36,
            height: 36,
            borderRadius: '50%',
            background: COLORS.cream,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: COLORS.crimson,
          }}
        >
          <User size={18} />
        </div>
        <div style={{ flex: 1 }}>
          <div
            style={{
              color: COLORS.textMuted,
              fontSize: FONT_SIZE.xs,
              textTransform: 'uppercase',
              letterSpacing: 0.5,
              fontWeight: 600,
            }}
          >
            Customer
          </div>
          <div style={{ color: COLORS.text, fontWeight: 600 }}>
            {customerId != null && customerName ? customerName : 'Walk-in'}
          </div>
        </div>
      </div>

      <div
        className="aeris-card"
        style={{
          background: COLORS.surface,
          border: `1px solid ${COLORS.surfaceBorder}`,
          borderRadius: BORDER_RADIUS.lg,
          padding: SPACING.lg,
          textAlign: 'center',
        }}
      >
        <div style={{ color: COLORS.text, fontSize: FONT_SIZE.xxl, fontWeight: 700 }}>
          {formatCents(totalCents)}
        </div>
        <div style={{ color: COLORS.textMuted, fontSize: FONT_SIZE.md, marginTop: SPACING.xs }}>
          {itemCount} {itemCount === 1 ? 'item' : 'items'}
        </div>
      </div>

      <div>
        <SectionLabel>Payment method</SectionLabel>
        {paymentMethodsState === 'loading' ? (
          <Spinner label="Loading payment methods..." />
        ) : null}
        {paymentMethodsState === 'fallback' ? (
          <button
            type="button"
            onClick={() => void loadPaymentMethods()}
            style={{
              alignSelf: 'flex-start',
              marginBottom: SPACING.sm,
              padding: `${SPACING.xs}px ${SPACING.sm}px`,
              border: `1px solid ${COLORS.warning}`,
              borderRadius: BORDER_RADIUS.md,
              background: COLORS.surface,
              color: COLORS.warning,
              fontSize: FONT_SIZE.xs,
              cursor: 'pointer',
            }}
          >
            Using offline defaults — tap to retry
          </button>
        ) : null}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
            gap: SPACING.sm,
          }}
        >
          {paymentMethods.map((m, idx) => {
            const active = selectedMethod === m.code;
            const shortcut = idx < 3 ? `F${idx + 1}` : null;
            return (
              <button
                key={m.code}
                type="button"
                onClick={() => {
                  setSelectedMethod(m.code);
                  setAmountTendered('');
                }}
                aria-pressed={active}
                style={{
                  background: active ? COLORS.surfaceHover : COLORS.surface,
                  color: active ? COLORS.crimson : COLORS.textMuted,
                  border: `2px solid ${active ? COLORS.crimson : COLORS.surfaceBorder}`,
                  borderRadius: BORDER_RADIUS.lg,
                  padding: SPACING.md,
                  fontSize: FONT_SIZE.md,
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 2,
                }}
              >
                <span>{m.name}</span>
                {shortcut ? (
                  <span style={{ color: COLORS.textMuted, fontSize: FONT_SIZE.xs, fontWeight: 500 }}>
                    {shortcut}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      {selectedMethod === 'cash' ? (
        <div>
          <SectionLabel>Amount tendered</SectionLabel>
          <input
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            value={amountTendered}
            onChange={(e) => setAmountTendered(e.target.value)}
            placeholder="0.00"
            aria-label="Amount tendered"
            style={{
              width: '100%',
              padding: SPACING.lg,
              background: COLORS.inputBg,
              border: `1px solid ${COLORS.inputBorder}`,
              borderRadius: BORDER_RADIUS.lg,
              fontSize: FONT_SIZE.xxl,
              fontWeight: 700,
              color: COLORS.text,
              textAlign: 'center',
              outline: 'none',
            }}
          />
          {tenderedCents > 0 && tenderedCents >= totalCents ? (
            <div
              style={{
                marginTop: SPACING.sm,
                padding: SPACING.md,
                background: COLORS.surface,
                border: `1px solid ${COLORS.surfaceBorder}`,
                borderRadius: BORDER_RADIUS.md,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <span style={{ color: COLORS.textMuted }}>Change</span>
              <span style={{ color: COLORS.success, fontWeight: 700, fontSize: FONT_SIZE.lg }}>
                {formatCents(changeCents)}
              </span>
            </div>
          ) : null}
          {tenderedCents > 0 && tenderedCents < totalCents ? (
            <div
              style={{
                marginTop: SPACING.sm,
                color: COLORS.warning,
                fontSize: FONT_SIZE.sm,
                textAlign: 'center',
              }}
            >
              Insufficient amount ({formatCents(totalCents - tenderedCents)} remaining)
            </div>
          ) : null}
        </div>
      ) : null}

      {error ? <ErrorBanner message={error} onDismiss={() => setError(null)} /> : null}

      <Button
        variant="primary"
        onClick={() => void handleSubmit()}
        disabled={!canComplete || submitting}
        loading={submitting}
        fullWidth
        style={{ padding: SPACING.md, fontSize: FONT_SIZE.lg }}
      >
        Process sale
      </Button>
      <div
        style={{
          color: COLORS.textMuted,
          fontSize: FONT_SIZE.xs,
          textAlign: 'center',
        }}
      >
        Shortcuts: F1/F2/F3 select payment method · Enter to submit
      </div>
    </section>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <div
      style={{
        color: COLORS.textMuted,
        fontSize: FONT_SIZE.sm,
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: 1,
        marginBottom: SPACING.sm,
      }}
    >
      {children}
    </div>
  );
}
