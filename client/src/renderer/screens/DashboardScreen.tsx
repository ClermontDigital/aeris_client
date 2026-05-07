import React from 'react';
import type { DailySummary } from '@aeris/shared';
import { useRelayQuery } from '../hooks/useRelayQuery';
import { Spinner } from '../components/Spinner';
import { EmptyState } from '../components/EmptyState';
import { ErrorBanner } from '../components/ErrorBanner';
import { Button } from '../components/Button';
import { COLORS, SPACING, FONT_SIZE, BORDER_RADIUS } from '../theme/tokens';
import { formatCents, formatNumber } from '../utils/format';

function StatCard({
  label,
  value,
}: {
  label: string;
  value: string;
}): React.ReactElement {
  return (
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
      <div style={{ color: COLORS.textMuted, fontSize: FONT_SIZE.sm, textTransform: 'uppercase', letterSpacing: 0.4 }}>
        {label}
      </div>
      <div style={{ color: COLORS.text, fontSize: FONT_SIZE.title, fontWeight: 700 }}>
        {value}
      </div>
    </div>
  );
}

function isEmptySummary(s: DailySummary): boolean {
  return (
    (s.revenue_cents ?? 0) === 0 &&
    (s.sales_count ?? 0) === 0 &&
    (s.items_sold ?? 0) === 0 &&
    (!s.top_products || s.top_products.length === 0)
  );
}

export function DashboardScreen(): React.ReactElement {
  const { data, loading, errorCode, errorMessage, refetch } =
    useRelayQuery<DailySummary>('dashboard.summary', {});

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: SPACING.lg }}>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h1 style={{ margin: 0, color: COLORS.text, fontSize: FONT_SIZE.xxl }}>Dashboard</h1>
        <Button variant="secondary" onClick={() => void refetch()} disabled={loading}>
          Refresh
        </Button>
      </header>

      {errorCode && errorMessage ? (
        <ErrorBanner
          message={errorMessage}
          tone={errorCode === 'NETWORK' || errorCode === 'TIMEOUT' ? 'warning' : 'error'}
        />
      ) : null}

      {loading && !data ? (
        <Spinner label="Loading today's summary…" />
      ) : data && isEmptySummary(data) ? (
        <EmptyState
          title="No sales yet today"
          description="Your first sale will appear here."
        />
      ) : data ? (
        <>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: SPACING.md,
            }}
          >
            <StatCard label="Revenue" value={formatCents(data.revenue_cents)} />
            <StatCard label="Sales" value={formatNumber(data.sales_count)} />
            <StatCard label="Items sold" value={formatNumber(data.items_sold)} />
            <StatCard label="Avg sale" value={formatCents(data.average_sale_cents)} />
          </div>

          {data.top_products && data.top_products.length > 0 ? (
            <section
              style={{
                background: COLORS.surface,
                borderRadius: BORDER_RADIUS.lg,
                border: `1px solid ${COLORS.surfaceBorder}`,
                padding: SPACING.lg,
                display: 'flex',
                flexDirection: 'column',
                gap: SPACING.md,
              }}
            >
              <h2 style={{ margin: 0, fontSize: FONT_SIZE.lg, color: COLORS.text }}>
                Top products
              </h2>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: SPACING.sm }}>
                {data.top_products.map((p) => (
                  <li
                    key={p.id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: SPACING.md,
                      paddingBottom: SPACING.sm,
                      borderBottom: `1px solid ${COLORS.surfaceBorder}`,
                    }}
                  >
                    <span style={{ color: COLORS.text }}>{p.name}</span>
                    <span style={{ color: COLORS.textMuted }}>
                      {formatNumber(p.quantity)} sold · {formatCents(p.revenue_cents)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
