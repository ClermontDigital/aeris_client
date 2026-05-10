import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, ShoppingCart, X } from 'lucide-react';
import type { PaginatedResponse, Product } from '@aeris/shared';
import { useRelayQuery } from '../hooks/useRelayQuery';
import { useDebounce } from '../hooks/useDebounce';
import { useCartStore } from '../stores/cartStore';
import { Spinner } from '../components/Spinner';
import { EmptyState } from '../components/EmptyState';
import { ErrorBanner } from '../components/ErrorBanner';
import { COLORS, SPACING, FONT_SIZE, BORDER_RADIUS, TRANSITION } from '../theme/tokens';
import { formatCents } from '../utils/format';

const PER_PAGE = 50;

function stockTone(stock: number): string {
  if (stock > 10) return COLORS.success;
  if (stock > 0) return COLORS.warning;
  return COLORS.danger;
}

// `track_stock` isn't on the public Product type yet but the server can
// return it on stock-bearing items. Treat absence as "tracked" so the
// default gate matches the cashier's expectation.
function isOutOfStock(p: Product): boolean {
  const tracked = (p as Product & { track_stock?: boolean }).track_stock;
  if (tracked === false) return false;
  return p.stock_on_hand <= 0;
}

export function QuickSaleScreen(): React.ReactElement {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search.trim(), 300);

  const addItem = useCartStore((s) => s.addItem);
  const itemCount = useCartStore((s) => s.getItemCount());
  const totalCents = useCartStore((s) => s.getTotalCents());

  const action = debouncedSearch ? 'products.search' : 'products.list';
  const params = useMemo(
    () =>
      debouncedSearch
        ? { query: debouncedSearch, page: 1, per_page: PER_PAGE }
        : { page: 1, per_page: PER_PAGE },
    [debouncedSearch],
  );

  const { data, loading, errorCode, errorMessage } = useRelayQuery<
    PaginatedResponse<Product>
  >(action, params);

  const products = data?.data ?? [];
  const isEmpty = !loading && products.length === 0 && !errorCode;

  const [stockNotice, setStockNotice] = useState<string | null>(null);
  const stockNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (stockNoticeTimerRef.current) {
        clearTimeout(stockNoticeTimerRef.current);
        stockNoticeTimerRef.current = null;
      }
    };
  }, []);

  const handleProductClick = (p: Product) => {
    if (isOutOfStock(p)) {
      setStockNotice(`${p.name} is out of stock.`);
      if (stockNoticeTimerRef.current) clearTimeout(stockNoticeTimerRef.current);
      stockNoticeTimerRef.current = setTimeout(() => {
        setStockNotice(null);
        stockNoticeTimerRef.current = null;
      }, 2500);
      return;
    }
    addItem(p);
  };

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
          alignItems: 'baseline',
          justifyContent: 'space-between',
        }}
      >
        <h1 style={{ margin: 0, color: COLORS.text, fontSize: FONT_SIZE.xxl }}>
          Quick Sale
        </h1>
        {itemCount > 0 ? (
          <span style={{ color: COLORS.textMuted, fontSize: FONT_SIZE.sm }}>
            {itemCount} {itemCount === 1 ? 'item' : 'items'} in cart
          </span>
        ) : null}
      </header>

      <div
        style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
        }}
      >
        <Search
          size={18}
          aria-hidden
          style={{
            position: 'absolute',
            left: SPACING.md,
            color: COLORS.textMuted,
            pointerEvents: 'none',
          }}
        />
        <input
          type="search"
          placeholder="Search products by name or SKU..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search products"
          style={{
            width: '100%',
            padding: `${SPACING.sm}px ${SPACING.md}px ${SPACING.sm}px ${SPACING.xl + SPACING.xs}px`,
            background: COLORS.inputBg,
            border: `1px solid ${COLORS.inputBorder}`,
            borderRadius: BORDER_RADIUS.lg,
            fontSize: FONT_SIZE.md,
            color: COLORS.text,
            outline: 'none',
          }}
        />
        {search ? (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => setSearch('')}
            style={{
              position: 'absolute',
              right: SPACING.sm,
              background: 'transparent',
              border: 0,
              padding: SPACING.xs,
              color: COLORS.textMuted,
              display: 'flex',
            }}
          >
            <X size={18} aria-hidden />
          </button>
        ) : null}
      </div>

      {errorCode && errorMessage ? (
        <ErrorBanner
          message={errorMessage}
          tone={errorCode === 'NETWORK' || errorCode === 'TIMEOUT' ? 'warning' : 'error'}
        />
      ) : null}

      {stockNotice ? (
        <ErrorBanner
          message={stockNotice}
          tone="warning"
          onDismiss={() => {
            if (stockNoticeTimerRef.current) {
              clearTimeout(stockNoticeTimerRef.current);
              stockNoticeTimerRef.current = null;
            }
            setStockNotice(null);
          }}
        />
      ) : null}

      {loading && products.length === 0 ? (
        <Spinner label="Loading products..." />
      ) : isEmpty ? (
        <EmptyState
          title={debouncedSearch ? 'No matches' : 'No products'}
          description={
            debouncedSearch
              ? `Nothing matched "${debouncedSearch}".`
              : 'Your catalogue is empty. Add products in Aeris ERP and they will appear here.'
          }
        />
      ) : (
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            paddingBottom: itemCount > 0 ? 88 : 0,
          }}
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
              gap: SPACING.sm,
            }}
          >
            {products.map((p) => {
              const oos = isOutOfStock(p);
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => handleProductClick(p)}
                  className="aeris-card"
                  style={{
                    textAlign: 'left',
                    background: COLORS.surface,
                    border: `1px solid ${COLORS.surfaceBorder}`,
                    borderRadius: BORDER_RADIUS.lg,
                    padding: SPACING.md,
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: SPACING.xs,
                    opacity: oos ? 0.55 : 1,
                    transition: `transform ${TRANSITION.fast}, box-shadow ${TRANSITION.base}`,
                  }}
                  aria-label={`Add ${p.name} to cart`}
                  aria-disabled={oos}
                >
                  <span
                    style={{
                      color: COLORS.text,
                      fontWeight: 600,
                      fontSize: FONT_SIZE.md,
                      minHeight: 38,
                      lineHeight: 1.3,
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                    }}
                  >
                    {p.name}
                  </span>
                  <span
                    style={{
                      color: COLORS.crimson,
                      fontWeight: 700,
                      fontSize: FONT_SIZE.lg,
                    }}
                  >
                    {formatCents(p.price_cents)}
                  </span>
                  <span
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: SPACING.xs,
                    }}
                  >
                    <span
                      aria-hidden
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        background: stockTone(p.stock_on_hand),
                      }}
                    />
                    <span style={{ color: COLORS.textMuted, fontSize: FONT_SIZE.xs }}>
                      {p.stock_on_hand > 0 ? `${p.stock_on_hand} in stock` : 'Out of stock'}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {itemCount > 0 ? (
        <button
          type="button"
          onClick={() => navigate('/pos/cart')}
          aria-label="View cart"
          style={{
            position: 'sticky',
            bottom: 0,
            background: COLORS.crimson,
            color: COLORS.white,
            border: 0,
            borderRadius: BORDER_RADIUS.lg,
            padding: `${SPACING.md}px ${SPACING.lg}px`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            cursor: 'pointer',
            boxShadow: '0 6px 20px rgba(193, 18, 31, 0.32)',
            fontSize: FONT_SIZE.md,
            fontWeight: 700,
          }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: SPACING.sm }}>
            <ShoppingCart size={18} aria-hidden />
            {itemCount} {itemCount === 1 ? 'item' : 'items'} · {formatCents(totalCents)}
          </span>
          <span>View cart →</span>
        </button>
      ) : null}
    </section>
  );
}
