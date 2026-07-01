import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { PaginatedResponse, Product } from '@aeris/shared';
import { useRelayQuery } from '../hooks/useRelayQuery';
import { useDebounce } from '../hooks/useDebounce';
import { Spinner } from '../components/Spinner';
import { EmptyState } from '../components/EmptyState';
import { ErrorBanner } from '../components/ErrorBanner';
import { Button } from '../components/Button';
import { TextField } from '../components/TextField';
import { StatCard } from '../components/StatCard';
import { COLORS, SPACING, FONT_SIZE, BORDER_RADIUS } from '../theme/tokens';
import { formatCents, formatNumber } from '../utils/format';

const PER_PAGE = 20;

// Table column header with click-to-sort + active-direction indicator.
// Preserves the alignment convention (numeric columns render right-aligned
// with the arrow rendered inline after the label).
function SortableHeader({
  label,
  align,
  active,
  dir,
  onClick,
}: {
  label: string;
  align: 'left' | 'right';
  active: boolean;
  dir: 'asc' | 'desc';
  onClick: () => void;
}): React.ReactElement {
  const arrow = active ? (dir === 'asc' ? ' ↑' : ' ↓') : '';
  return (
    <th
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      role="button"
      tabIndex={0}
      aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      style={{
        textAlign: align,
        fontSize: FONT_SIZE.sm,
        cursor: 'pointer',
        userSelect: 'none',
        color: active ? COLORS.crimson : COLORS.text,
      }}
    >
      {label}
      {arrow}
    </th>
  );
}

function ProductThumb({ url, alt }: { url: string | null; alt: string }): React.ReactElement {
  if (url) {
    return (
      <img
        src={url}
        alt={alt}
        style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: BORDER_RADIUS.md }}
      />
    );
  }
  return (
    <div
      aria-hidden
      style={{
        width: 40,
        height: 40,
        borderRadius: BORDER_RADIUS.md,
        background: COLORS.creamLight,
        border: `1px solid ${COLORS.surfaceBorder}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: COLORS.textMuted,
        fontSize: FONT_SIZE.sm,
      }}
    >
      —
    </div>
  );
}

export function ItemsScreen(): React.ReactElement {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search.trim(), 300);

  const action = debouncedSearch ? 'products.search' : 'products.list';
  const params = useMemo(
    () =>
      debouncedSearch
        ? { query: debouncedSearch, page, per_page: PER_PAGE }
        : { page, per_page: PER_PAGE },
    [debouncedSearch, page],
  );

  const { data, loading, errorCode, errorMessage, refetch } = useRelayQuery<
    PaginatedResponse<Product>
  >(action, params);

  const products = data?.data ?? [];
  const meta = data?.meta;
  const lastPage = meta?.last_page ?? 1;
  const isEmpty = !loading && products.length === 0 && !errorCode;

  // Column sort state. Client-side sort over the visible page — the server
  // paginates by name by default; this lets the operator reorder rows in-place
  // without re-fetching. Reset when the query params change so pagination /
  // search don't carry a stale sort into a fresh dataset.
  type SortKey = 'name' | 'sku' | 'price_cents' | 'stock_on_hand';
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const toggleSort = (key: SortKey): void => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };
  const sortedProducts = useMemo(() => {
    if (!sortKey) return products;
    const dir = sortDir === 'asc' ? 1 : -1;
    const copy = [...products];
    copy.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === 'string' && typeof bv === 'string') {
        return av.localeCompare(bv) * dir;
      }
      const an = typeof av === 'number' ? av : 0;
      const bn = typeof bv === 'number' ? bv : 0;
      return (an - bn) * dir;
    });
    return copy;
  }, [products, sortKey, sortDir]);

  // Stat-strip metrics derived from the visible page; revisit when the
  // relay surfaces aggregated meta in B3.
  const stats = useMemo(() => {
    const total = products.length;
    let lowStock = 0;
    let outOfStock = 0;
    let valueCents = 0;
    for (const p of products) {
      if (p.stock_on_hand === 0) outOfStock += 1;
      else if (p.stock_on_hand < 10) lowStock += 1;
      valueCents += p.price_cents * p.stock_on_hand;
    }
    return { total, lowStock, outOfStock, valueCents };
  }, [products]);

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: SPACING.md }}>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h1 style={{ margin: 0, color: COLORS.text, fontSize: FONT_SIZE.xxl }}>Items</h1>
        <div style={{ display: 'flex', gap: SPACING.sm }}>
          <Button variant="secondary" onClick={() => void refetch()} disabled={loading}>
            Refresh
          </Button>
          <Button onClick={() => navigate('/items/new')}>+ New item</Button>
        </div>
      </header>

      <div className="aeris-stat-strip">
        <StatCard label="Total items" value={formatNumber(stats.total)} />
        <StatCard
          label="Low stock"
          value={formatNumber(stats.lowStock)}
          tone={stats.lowStock > 0 ? 'warning' : 'default'}
        />
        <StatCard
          label="Out of stock"
          value={formatNumber(stats.outOfStock)}
          tone={stats.outOfStock > 0 ? 'danger' : 'default'}
        />
        <StatCard label="Total value" value={formatCents(stats.valueCents)} />
      </div>

      <TextField
        label="Search"
        placeholder="Name, SKU, barcode…"
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

      {loading && products.length === 0 ? (
        <Spinner label="Loading items…" />
      ) : isEmpty ? (
        <EmptyState
          title="No products"
          description={
            debouncedSearch
              ? `Nothing matched "${debouncedSearch}".`
              : 'Your catalogue is empty. Add products in Aeris ERP and they will appear here.'
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
          <table className="aeris-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: COLORS.creamLight, color: COLORS.text }}>
                <th style={{ width: 56, textAlign: 'left' }} aria-label="Image" />
                <SortableHeader
                  label="Name"
                  align="left"
                  active={sortKey === 'name'}
                  dir={sortDir}
                  onClick={() => toggleSort('name')}
                />
                <SortableHeader
                  label="SKU"
                  align="left"
                  active={sortKey === 'sku'}
                  dir={sortDir}
                  onClick={() => toggleSort('sku')}
                />
                <SortableHeader
                  label="Price"
                  align="right"
                  active={sortKey === 'price_cents'}
                  dir={sortDir}
                  onClick={() => toggleSort('price_cents')}
                />
                <SortableHeader
                  label="Stock"
                  align="right"
                  active={sortKey === 'stock_on_hand'}
                  dir={sortDir}
                  onClick={() => toggleSort('stock_on_hand')}
                />
              </tr>
            </thead>
            <tbody>
              {sortedProducts.map((p) => (
                <tr
                  key={p.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => navigate(`/items/${p.id}`)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      navigate(`/items/${p.id}`);
                    }
                  }}
                  className="aeris-row-clickable"
                  style={{ cursor: 'pointer', borderTop: `1px solid ${COLORS.surfaceBorder}` }}
                >
                  <td>
                    <ProductThumb url={p.image_url} alt={p.name} />
                  </td>
                  <td style={{ color: COLORS.text }}>{p.name}</td>
                  <td style={{ color: COLORS.textMuted, fontSize: FONT_SIZE.sm }}>{p.sku}</td>
                  <td style={{ color: COLORS.text, textAlign: 'right' }}>
                    {formatCents(p.price_cents)}
                  </td>
                  <td style={{ color: COLORS.text, textAlign: 'right' }}>
                    {formatNumber(p.stock_on_hand)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {meta && lastPage > 1 ? (
        <nav
          aria-label="Items pagination"
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
