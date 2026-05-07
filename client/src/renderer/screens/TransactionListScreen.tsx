import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { PaginatedResponse, Sale } from '@aeris/shared';
import { useRelayQuery } from '../hooks/useRelayQuery';
import { Spinner } from '../components/Spinner';
import { EmptyState } from '../components/EmptyState';
import { ErrorBanner } from '../components/ErrorBanner';
import { Button } from '../components/Button';
import { COLORS, SPACING, FONT_SIZE, BORDER_RADIUS } from '../theme/tokens';
import { formatCents, formatDateTime } from '../utils/format';

const PER_PAGE = 20;

function StatusChip({ status }: { status: Sale['status'] }): React.ReactElement {
  const palette: Record<Sale['status'], { bg: string; fg: string }> = {
    completed: { bg: '#dcfce7', fg: '#15803d' },
    refunded: { bg: '#fef3c7', fg: '#92400e' },
    voided: { bg: '#fde7e9', fg: '#900' },
  };
  const c = palette[status];
  return (
    <span
      style={{
        background: c.bg,
        color: c.fg,
        fontSize: FONT_SIZE.xs,
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        padding: '2px 8px',
        borderRadius: BORDER_RADIUS.full,
      }}
    >
      {status}
    </span>
  );
}

export function TransactionListScreen(): React.ReactElement {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);

  const { data, loading, errorCode, errorMessage, refetch } = useRelayQuery<
    PaginatedResponse<Sale>
  >('transactions.list', { page, per_page: PER_PAGE });

  const sales = data?.data ?? [];
  const meta = data?.meta;
  const isEmpty = !loading && sales.length === 0 && !errorCode;
  const lastPage = meta?.last_page ?? 1;

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: SPACING.md }}>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h1 style={{ margin: 0, color: COLORS.text, fontSize: FONT_SIZE.xxl }}>Transactions</h1>
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

      {loading && sales.length === 0 ? (
        <Spinner label="Loading transactions…" />
      ) : isEmpty ? (
        <EmptyState
          title="No transactions yet"
          description="No transactions in this date range."
        />
      ) : (
        <div
          style={{
            background: COLORS.surface,
            borderRadius: BORDER_RADIUS.lg,
            border: `1px solid ${COLORS.surfaceBorder}`,
            overflow: 'hidden',
          }}
        >
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: COLORS.creamLight, color: COLORS.text }}>
                <th style={{ textAlign: 'left', padding: SPACING.sm, fontSize: FONT_SIZE.sm }}>Sale #</th>
                <th style={{ textAlign: 'left', padding: SPACING.sm, fontSize: FONT_SIZE.sm }}>Customer</th>
                <th style={{ textAlign: 'left', padding: SPACING.sm, fontSize: FONT_SIZE.sm }}>Date</th>
                <th style={{ textAlign: 'right', padding: SPACING.sm, fontSize: FONT_SIZE.sm }}>Total</th>
                <th style={{ textAlign: 'left', padding: SPACING.sm, fontSize: FONT_SIZE.sm }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {sales.map((s) => (
                <tr
                  key={s.id}
                  onClick={() => navigate(`/transactions/${s.id}`)}
                  style={{ cursor: 'pointer', borderTop: `1px solid ${COLORS.surfaceBorder}` }}
                >
                  <td style={{ padding: SPACING.sm, color: COLORS.text }}>{s.sale_number}</td>
                  <td style={{ padding: SPACING.sm, color: COLORS.text }}>
                    {s.customer_name ?? 'Walk-in'}
                  </td>
                  <td style={{ padding: SPACING.sm, color: COLORS.textMuted, fontSize: FONT_SIZE.sm }}>
                    {formatDateTime(s.created_at)}
                  </td>
                  <td style={{ padding: SPACING.sm, color: COLORS.text, textAlign: 'right' }}>
                    {formatCents(s.total_cents)}
                  </td>
                  <td style={{ padding: SPACING.sm }}>
                    <StatusChip status={s.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {meta && lastPage > 1 ? (
        <nav
          aria-label="Transactions pagination"
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
        >
          <Button
            variant="secondary"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={loading || page <= 1}
          >
            Previous
          </Button>
          <div style={{ color: COLORS.textMuted }}>
            Page {meta.current_page} of {meta.last_page}
          </div>
          <Button
            variant="secondary"
            onClick={() => setPage((p) => Math.min(lastPage, p + 1))}
            disabled={loading || page >= lastPage}
          >
            Next
          </Button>
        </nav>
      ) : null}
    </section>
  );
}
