import React, { useEffect, useState } from 'react';
import type { DailySummary } from '@aeris/shared';
import { useRelayQuery } from '../hooks/useRelayQuery';
import { Spinner } from '../components/Spinner';
import { EmptyState } from '../components/EmptyState';
import { ErrorBanner } from '../components/ErrorBanner';
import { Button } from '../components/Button';
import { StatCard } from '../components/StatCard';
import { COLORS, SPACING, FONT_SIZE, BORDER_RADIUS } from '../theme/tokens';
import { formatCents, formatNumber, formatDateTime } from '../utils/format';

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

  const [lastRefreshed, setLastRefreshed] = useState<string | null>(null);
  useEffect(() => {
    if (!loading && (data || errorCode)) {
      setLastRefreshed(new Date().toISOString());
    }
  }, [loading, data, errorCode]);

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
        <Spinner label="Loading dashboard…" />
      ) : data && isEmptySummary(data) ? (
        <EmptyState
          title="You're all set."
          description="No sales recorded yet today. Your dashboard will fill in as transactions come through."
        />
      ) : data ? (
        <>
          <div className="aeris-stat-strip">
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

      {lastRefreshed ? (
        <div
          aria-live="polite"
          style={{
            color: COLORS.textMuted,
            fontSize: FONT_SIZE.sm,
            textAlign: 'right',
          }}
        >
          Last refreshed: {formatDateTime(lastRefreshed)}
        </div>
      ) : null}
    </section>
  );
}
