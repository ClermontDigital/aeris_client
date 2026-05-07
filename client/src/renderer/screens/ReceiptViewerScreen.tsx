import React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { ReceiptData } from '@aeris/shared';
import { useRelayQuery } from '../hooks/useRelayQuery';
import { Spinner } from '../components/Spinner';
import { ErrorBanner } from '../components/ErrorBanner';
import { Button } from '../components/Button';
import { COLORS, SPACING, FONT_SIZE, BORDER_RADIUS } from '../theme/tokens';

// v1 limitation: receipt is read-only — no print path. Adding a print
// path requires plumbing through Electron's printToPDF + printer
// discovery, which is deferred to v1.5+ alongside the mobile receipt
// print path.

export function ReceiptViewerScreen(): React.ReactElement {
  const params = useParams<{ id: string }>();
  const navigate = useNavigate();
  const saleId = Number(params.id);

  const { data, loading, errorCode, errorMessage } = useRelayQuery<ReceiptData>(
    'transactions.receipt',
    { sale_id: saleId, id: saleId },
  );

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: SPACING.md }}>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Button variant="ghost" onClick={() => navigate(`/transactions/${saleId}`)}>
          ← Back
        </Button>
      </header>

      {errorCode && errorMessage ? <ErrorBanner message={errorMessage} /> : null}
      {loading && !data ? <Spinner label="Loading receipt…" /> : null}

      {data ? (
        <article
          style={{
            background: COLORS.surface,
            borderRadius: BORDER_RADIUS.lg,
            border: `1px solid ${COLORS.surfaceBorder}`,
            padding: SPACING.xl,
            maxWidth: 480,
            margin: '0 auto',
            width: '100%',
            display: 'flex',
            flexDirection: 'column',
            gap: SPACING.sm,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
          }}
        >
          <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: SPACING.xs }}>
            <div style={{ fontSize: FONT_SIZE.xl, fontWeight: 700, color: COLORS.text }}>
              {data.business_name}
            </div>
            <div style={{ color: COLORS.textMuted, fontSize: FONT_SIZE.sm }}>
              {data.business_address}
            </div>
          </div>

          <div style={{ borderTop: `1px dashed ${COLORS.surfaceBorder}`, marginTop: SPACING.sm, paddingTop: SPACING.sm, display: 'flex', justifyContent: 'space-between', color: COLORS.textMuted, fontSize: FONT_SIZE.sm }}>
            <span>Sale #{data.sale_number}</span>
            <span>{data.date}</span>
          </div>

          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: SPACING.xs }}>
            <thead>
              <tr style={{ color: COLORS.textMuted }}>
                <th style={{ textAlign: 'left', fontSize: FONT_SIZE.sm, padding: SPACING.xs }}>Item</th>
                <th style={{ textAlign: 'right', fontSize: FONT_SIZE.sm, padding: SPACING.xs }}>Qty</th>
                <th style={{ textAlign: 'right', fontSize: FONT_SIZE.sm, padding: SPACING.xs }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((it, i) => (
                <tr key={i} style={{ borderTop: `1px solid ${COLORS.surfaceBorder}` }}>
                  <td style={{ padding: SPACING.xs, color: COLORS.text }}>{it.name}</td>
                  <td style={{ padding: SPACING.xs, color: COLORS.text, textAlign: 'right' }}>{it.quantity}</td>
                  <td style={{ padding: SPACING.xs, color: COLORS.text, textAlign: 'right' }}>{it.line_total}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div style={{ borderTop: `1px dashed ${COLORS.surfaceBorder}`, marginTop: SPACING.sm, paddingTop: SPACING.sm, display: 'flex', flexDirection: 'column', gap: 2, fontSize: FONT_SIZE.md }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', color: COLORS.textMuted }}>
              <span>Subtotal</span>
              <span>{data.subtotal}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', color: COLORS.textMuted }}>
              <span>Tax</span>
              <span>{data.tax}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', color: COLORS.text, fontWeight: 700 }}>
              <span>Total</span>
              <span>{data.total}</span>
            </div>
          </div>

          {data.payments.length > 0 ? (
            <div style={{ borderTop: `1px dashed ${COLORS.surfaceBorder}`, marginTop: SPACING.sm, paddingTop: SPACING.sm, display: 'flex', flexDirection: 'column', gap: 2 }}>
              {data.payments.map((p, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', color: COLORS.text }}>
                  <span>{p.method}</span>
                  <span>{p.amount}</span>
                </div>
              ))}
            </div>
          ) : null}

          {data.served_by ? (
            <div style={{ marginTop: SPACING.sm, color: COLORS.textMuted, fontSize: FONT_SIZE.sm, textAlign: 'center' }}>
              Served by {data.served_by}
            </div>
          ) : null}

          <div style={{ marginTop: SPACING.md, color: COLORS.textDim, fontSize: FONT_SIZE.xs, textAlign: 'center' }}>
            Read-only — printing coming in a later release.
          </div>
        </article>
      ) : null}
    </section>
  );
}
