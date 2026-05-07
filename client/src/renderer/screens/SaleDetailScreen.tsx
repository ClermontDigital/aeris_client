import React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { SaleDetail } from '@aeris/shared';
import { useRelayQuery } from '../hooks/useRelayQuery';
import { Spinner } from '../components/Spinner';
import { ErrorBanner } from '../components/ErrorBanner';
import { Button } from '../components/Button';
import { COLORS, SPACING, FONT_SIZE, BORDER_RADIUS } from '../theme/tokens';
import { formatCents, formatDateTime } from '../utils/format';

function Row({
  label,
  value,
  bold,
}: {
  label: string;
  value: string;
  bold?: boolean;
}): React.ReactElement {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: `${SPACING.xs}px 0` }}>
      <span style={{ color: COLORS.textMuted }}>{label}</span>
      <span style={{ color: COLORS.text, fontWeight: bold ? 700 : 400 }}>{value}</span>
    </div>
  );
}

export function SaleDetailScreen(): React.ReactElement {
  const params = useParams<{ id: string }>();
  const navigate = useNavigate();
  const saleId = Number(params.id);

  const { data, loading, errorCode, errorMessage } = useRelayQuery<SaleDetail | null>(
    'transactions.detail',
    { sale_id: saleId, id: saleId },
  );

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: SPACING.md }}>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: SPACING.md }}>
        <Button variant="ghost" onClick={() => navigate('/transactions')}>
          ← Back
        </Button>
        {data ? (
          <Button onClick={() => navigate(`/transactions/${saleId}/receipt`)}>
            View Receipt
          </Button>
        ) : null}
      </header>

      {errorCode && errorMessage ? <ErrorBanner message={errorMessage} /> : null}

      {loading && !data ? <Spinner label="Loading sale…" /> : null}

      {data ? (
        <>
          <div
            style={{
              background: COLORS.surface,
              borderRadius: BORDER_RADIUS.lg,
              border: `1px solid ${COLORS.surfaceBorder}`,
              padding: SPACING.lg,
              display: 'flex',
              flexDirection: 'column',
              gap: SPACING.xs,
            }}
          >
            <h1 style={{ margin: 0, fontSize: FONT_SIZE.xxl, color: COLORS.text }}>
              Sale {data.sale_number}
            </h1>
            <div style={{ color: COLORS.textMuted }}>{formatDateTime(data.created_at)}</div>
            <div style={{ color: COLORS.textMuted }}>
              {data.customer?.name ?? 'Walk-in customer'}
            </div>
          </div>

          <section
            style={{
              background: COLORS.surface,
              borderRadius: BORDER_RADIUS.lg,
              border: `1px solid ${COLORS.surfaceBorder}`,
              padding: SPACING.lg,
              display: 'flex',
              flexDirection: 'column',
              gap: SPACING.sm,
            }}
          >
            <h2 style={{ margin: 0, fontSize: FONT_SIZE.lg, color: COLORS.text }}>Items</h2>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ color: COLORS.textMuted }}>
                  <th style={{ textAlign: 'left', padding: SPACING.xs, fontSize: FONT_SIZE.sm }}>Item</th>
                  <th style={{ textAlign: 'right', padding: SPACING.xs, fontSize: FONT_SIZE.sm }}>Qty</th>
                  <th style={{ textAlign: 'right', padding: SPACING.xs, fontSize: FONT_SIZE.sm }}>Unit</th>
                  <th style={{ textAlign: 'right', padding: SPACING.xs, fontSize: FONT_SIZE.sm }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((it, idx) => (
                  <tr key={`${it.product_id}-${idx}`} style={{ borderTop: `1px solid ${COLORS.surfaceBorder}` }}>
                    <td style={{ padding: SPACING.xs, color: COLORS.text }}>{it.product_name}</td>
                    <td style={{ padding: SPACING.xs, color: COLORS.text, textAlign: 'right' }}>{it.quantity}</td>
                    <td style={{ padding: SPACING.xs, color: COLORS.text, textAlign: 'right' }}>{formatCents(it.unit_price_cents)}</td>
                    <td style={{ padding: SPACING.xs, color: COLORS.text, textAlign: 'right' }}>{formatCents(it.line_total_cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section
            style={{
              background: COLORS.surface,
              borderRadius: BORDER_RADIUS.lg,
              border: `1px solid ${COLORS.surfaceBorder}`,
              padding: SPACING.lg,
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <h2 style={{ margin: 0, fontSize: FONT_SIZE.lg, color: COLORS.text }}>Totals</h2>
            <Row label="Subtotal" value={formatCents(data.subtotal_cents)} />
            <Row label="Tax" value={formatCents(data.tax_cents)} />
            {data.discount_cents > 0 ? (
              <Row label="Discount" value={`− ${formatCents(data.discount_cents)}`} />
            ) : null}
            <div style={{ borderTop: `1px solid ${COLORS.surfaceBorder}`, marginTop: SPACING.xs, paddingTop: SPACING.xs }}>
              <Row label="Total" value={formatCents(data.total_cents)} bold />
            </div>
          </section>

          {data.payments.length > 0 ? (
            <section
              style={{
                background: COLORS.surface,
                borderRadius: BORDER_RADIUS.lg,
                border: `1px solid ${COLORS.surfaceBorder}`,
                padding: SPACING.lg,
                display: 'flex',
                flexDirection: 'column',
                gap: SPACING.xs,
              }}
            >
              <h2 style={{ margin: 0, fontSize: FONT_SIZE.lg, color: COLORS.text }}>Payments</h2>
              {data.payments.map((p, i) => (
                <Row key={i} label={p.method} value={formatCents(p.amount_cents)} />
              ))}
            </section>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
