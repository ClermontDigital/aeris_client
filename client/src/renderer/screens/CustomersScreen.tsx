import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Customer, PaginatedResponse } from '@aeris/shared';
import { useRelayQuery } from '../hooks/useRelayQuery';
import { useDebounce } from '../hooks/useDebounce';
import { Spinner } from '../components/Spinner';
import { EmptyState } from '../components/EmptyState';
import { ErrorBanner } from '../components/ErrorBanner';
import { Button } from '../components/Button';
import { TextField } from '../components/TextField';
import { COLORS, SPACING, FONT_SIZE, BORDER_RADIUS } from '../theme/tokens';
import { formatCents } from '../utils/format';

const PER_PAGE = 20;

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? '').join('') || '?';
}

function Avatar({ name }: { name: string }): React.ReactElement {
  return (
    <div
      aria-hidden
      style={{
        width: 36,
        height: 36,
        borderRadius: BORDER_RADIUS.full,
        background: COLORS.navyLight,
        color: COLORS.cream,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: FONT_SIZE.sm,
        fontWeight: 600,
        flexShrink: 0,
      }}
    >
      {initialsOf(name)}
    </div>
  );
}

export function CustomersScreen(): React.ReactElement {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search.trim(), 300);

  const action = debouncedSearch ? 'customers.search' : 'customers.list';
  const params = useMemo(
    () =>
      debouncedSearch
        ? { query: debouncedSearch, term: debouncedSearch, page }
        : { page, per_page: PER_PAGE },
    [debouncedSearch, page],
  );

  const { data, loading, errorCode, errorMessage, refetch } = useRelayQuery<
    PaginatedResponse<Customer>
  >(action, params);

  const customers = data?.data ?? [];
  const meta = data?.meta;
  const lastPage = meta?.last_page ?? 1;
  const isEmpty = !loading && customers.length === 0 && !errorCode;

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: SPACING.md }}>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h1 style={{ margin: 0, color: COLORS.text, fontSize: FONT_SIZE.xxl }}>Customers</h1>
        <Button variant="secondary" onClick={() => void refetch()} disabled={loading}>
          Refresh
        </Button>
      </header>

      <TextField
        label="Search"
        placeholder="Name, email, phone…"
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setPage(1);
        }}
      />

      {errorCode && errorMessage ? (
        <ErrorBanner
          message={errorMessage}
          tone={errorCode === 'NETWORK' || errorCode === 'TIMEOUT' ? 'warning' : 'error'}
        />
      ) : null}

      {loading && customers.length === 0 ? (
        <Spinner label="Loading customers…" />
      ) : isEmpty ? (
        <EmptyState
          title="No customers"
          description={
            debouncedSearch
              ? `Nothing matched "${debouncedSearch}".`
              : 'Customers added in Aeris ERP will appear here.'
          }
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
                <th style={{ width: 56, padding: SPACING.sm }} aria-label="Avatar" />
                <th style={{ textAlign: 'left', padding: SPACING.sm, fontSize: FONT_SIZE.sm }}>Name</th>
                <th style={{ textAlign: 'left', padding: SPACING.sm, fontSize: FONT_SIZE.sm }}>Email</th>
                <th style={{ textAlign: 'left', padding: SPACING.sm, fontSize: FONT_SIZE.sm }}>Phone</th>
                <th style={{ textAlign: 'right', padding: SPACING.sm, fontSize: FONT_SIZE.sm }}>Total spent</th>
              </tr>
            </thead>
            <tbody>
              {customers.map((c) => (
                <tr
                  key={c.id}
                  onClick={() => navigate(`/customers/${c.id}`)}
                  style={{ cursor: 'pointer', borderTop: `1px solid ${COLORS.surfaceBorder}` }}
                >
                  <td style={{ padding: SPACING.sm }}>
                    <Avatar name={c.name} />
                  </td>
                  <td style={{ padding: SPACING.sm, color: COLORS.text }}>{c.name}</td>
                  <td style={{ padding: SPACING.sm, color: COLORS.textMuted, fontSize: FONT_SIZE.sm }}>
                    {c.email ?? '—'}
                  </td>
                  <td style={{ padding: SPACING.sm, color: COLORS.textMuted, fontSize: FONT_SIZE.sm }}>
                    {c.phone ?? c.mobile ?? '—'}
                  </td>
                  <td style={{ padding: SPACING.sm, color: COLORS.text, textAlign: 'right' }}>
                    {c.total_spent_cents != null ? formatCents(c.total_spent_cents) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {meta && lastPage > 1 ? (
        <nav
          aria-label="Customers pagination"
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
