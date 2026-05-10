import React, { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { ProductDetail } from '@aeris/shared';
import { useRelayQuery } from '../hooks/useRelayQuery';
import { Spinner } from '../components/Spinner';
import { EmptyState } from '../components/EmptyState';
import { ErrorBanner } from '../components/ErrorBanner';
import { Button } from '../components/Button';
import { StockAdjustmentModal } from '../components/StockAdjustmentModal';
import { COLORS, SPACING, FONT_SIZE, BORDER_RADIUS } from '../theme/tokens';
import { formatCents, formatNumber } from '../utils/format';

function Field({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: `${SPACING.xs}px 0` }}>
      <span style={{ color: COLORS.textMuted }}>{label}</span>
      <span style={{ color: COLORS.text }}>{value}</span>
    </div>
  );
}

export function ProductDetailScreen(): React.ReactElement {
  const params = useParams<{ id: string }>();
  const navigate = useNavigate();
  const productId = Number(params.id);

  const { data, loading, errorCode, errorMessage, refetch } = useRelayQuery<ProductDetail | null>(
    'products.detail',
    { product_id: productId, id: productId },
  );

  const [adjustOpen, setAdjustOpen] = useState(false);

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: SPACING.md }}>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Button variant="ghost" onClick={() => navigate('/items')}>
          ← Back to items
        </Button>
        {data ? (
          <div style={{ display: 'flex', gap: SPACING.sm }}>
            <Button variant="secondary" onClick={() => setAdjustOpen(true)}>
              Adjust stock
            </Button>
            <Button onClick={() => navigate(`/items/${productId}/edit`)}>Edit</Button>
          </div>
        ) : null}
      </header>

      {data ? (
        <StockAdjustmentModal
          open={adjustOpen}
          onClose={() => setAdjustOpen(false)}
          productId={productId}
          currentStock={data.stock_on_hand}
          onComplete={() => {
            void refetch();
          }}
        />
      ) : null}

      {errorCode && errorMessage ? (
        <ErrorBanner
          message={errorMessage}
          tone={errorCode === 'NETWORK' || errorCode === 'TIMEOUT' ? 'warning' : 'error'}
        />
      ) : null}

      {loading && !data ? (
        <Spinner label="Loading product…" />
      ) : !loading && !data ? (
        <EmptyState
          title="Product not found"
          description="That product may have been removed."
        />
      ) : data ? (
        <>
          <div
            style={{
              background: COLORS.surface,
              borderRadius: BORDER_RADIUS.lg,
              border: `1px solid ${COLORS.surfaceBorder}`,
              padding: SPACING.lg,
              display: 'flex',
              gap: SPACING.lg,
              alignItems: 'flex-start',
            }}
          >
            {data.image_url ? (
              <img
                src={data.image_url}
                alt={data.name}
                style={{
                  width: 160,
                  height: 160,
                  objectFit: 'cover',
                  borderRadius: BORDER_RADIUS.md,
                  border: `1px solid ${COLORS.surfaceBorder}`,
                }}
              />
            ) : (
              <div
                aria-hidden
                style={{
                  width: 160,
                  height: 160,
                  borderRadius: BORDER_RADIUS.md,
                  background: COLORS.creamLight,
                  border: `1px solid ${COLORS.surfaceBorder}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: COLORS.textMuted,
                }}
              >
                No image
              </div>
            )}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: SPACING.xs }}>
              <h1 style={{ margin: 0, color: COLORS.text, fontSize: FONT_SIZE.xxl }}>{data.name}</h1>
              <div style={{ color: COLORS.textMuted }}>
                {data.category_name ?? 'Uncategorised'}
              </div>
              <div style={{ marginTop: SPACING.sm, fontSize: FONT_SIZE.title, fontWeight: 700, color: COLORS.text }}>
                {formatCents(data.price_cents)}
              </div>
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
            }}
          >
            <h2 style={{ margin: 0, fontSize: FONT_SIZE.lg, color: COLORS.text }}>Details</h2>
            <Field label="SKU" value={data.sku} />
            <Field label="Barcode" value={data.barcode ?? '—'} />
            <Field label="Stock on hand" value={formatNumber(data.stock_on_hand)} />
            <Field label="Status" value={data.is_active ? 'Active' : 'Inactive'} />
          </section>

          {data.stock_levels && data.stock_levels.length > 0 ? (
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
              <h2 style={{ margin: 0, fontSize: FONT_SIZE.lg, color: COLORS.text }}>Stock by location</h2>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ color: COLORS.textMuted }}>
                    <th style={{ textAlign: 'left', padding: SPACING.xs, fontSize: FONT_SIZE.sm }}>Location</th>
                    <th style={{ textAlign: 'right', padding: SPACING.xs, fontSize: FONT_SIZE.sm }}>On hand</th>
                    <th style={{ textAlign: 'right', padding: SPACING.xs, fontSize: FONT_SIZE.sm }}>Available</th>
                  </tr>
                </thead>
                <tbody>
                  {data.stock_levels.map((s) => (
                    <tr key={s.location_id} style={{ borderTop: `1px solid ${COLORS.surfaceBorder}` }}>
                      <td style={{ padding: SPACING.xs, color: COLORS.text }}>{s.location_name}</td>
                      <td style={{ padding: SPACING.xs, color: COLORS.text, textAlign: 'right' }}>
                        {formatNumber(s.on_hand)}
                      </td>
                      <td style={{ padding: SPACING.xs, color: COLORS.text, textAlign: 'right' }}>
                        {formatNumber(s.available)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ) : null}

          {data.description ? (
            <section
              style={{
                background: COLORS.surface,
                borderRadius: BORDER_RADIUS.lg,
                border: `1px solid ${COLORS.surfaceBorder}`,
                padding: SPACING.lg,
              }}
            >
              <h2 style={{ margin: 0, marginBottom: SPACING.sm, fontSize: FONT_SIZE.lg, color: COLORS.text }}>
                Description
              </h2>
              <p style={{ margin: 0, color: COLORS.text, lineHeight: 1.6 }}>{data.description}</p>
            </section>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
