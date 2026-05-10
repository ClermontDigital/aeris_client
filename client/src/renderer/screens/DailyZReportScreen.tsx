import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { DailyZReport } from '@aeris/shared';
import { useRelayQuery } from '../hooks/useRelayQuery';
import { Spinner } from '../components/Spinner';
import { EmptyState } from '../components/EmptyState';
import { ErrorBanner } from '../components/ErrorBanner';
import { Button } from '../components/Button';
import { StatCard } from '../components/StatCard';
import { COLORS, BORDER_RADIUS, FONT_SIZE, SPACING } from '../theme/tokens';
import { formatCents, formatNumber, formatDate } from '../utils/format';

interface PrintToast {
  kind: 'success' | 'error';
  text: string;
}

function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function isEmptyZ(z: DailyZReport): boolean {
  return (
    (z.total_sales ?? 0) === 0 &&
    (z.total_revenue_cents ?? 0) === 0 &&
    (z.total_items_sold ?? 0) === 0
  );
}

export function DailyZReportScreen(): React.ReactElement {
  const [date, setDate] = useState<string>(todayIso());
  const [printing, setPrinting] = useState(false);
  const [printToast, setPrintToast] = useState<PrintToast | null>(null);
  const printToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear any pending toast timer on unmount so we don't setState after the
  // component is gone (mirrors CheckoutScreen).
  useEffect(() => {
    return () => {
      if (printToastTimerRef.current) {
        clearTimeout(printToastTimerRef.current);
        printToastTimerRef.current = null;
      }
    };
  }, []);

  const { data, loading, errorCode, errorMessage, refetch } = useRelayQuery<DailyZReport>(
    'sales.daily-summary',
    { date },
  );

  const hourlyMax = useMemo(() => {
    if (!data?.hourly_breakdown) return 0;
    return Math.max(0, ...Object.values(data.hourly_breakdown));
  }, [data?.hourly_breakdown]);

  const handlePrint = async () => {
    setPrinting(true);
    try {
      const res = await window.aeris.print.zReport(date);
      setPrintToast(
        res.ok
          ? { kind: 'success', text: 'Z-report sent to the printer.' }
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
  };

  return (
    <section
      className="aeris-fade-in"
      style={{ display: 'flex', flexDirection: 'column', gap: SPACING.lg }}
    >
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: SPACING.md }}>
        <div>
          <h1 style={{ margin: 0, color: COLORS.text, fontSize: FONT_SIZE.xxl }}>Day end</h1>
          <div style={{ color: COLORS.textMuted, fontSize: FONT_SIZE.sm }}>
            {formatDate(date)}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: SPACING.sm }}>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value || todayIso())}
            style={{
              padding: `${SPACING.sm}px ${SPACING.md}px`,
              background: COLORS.inputBg,
              border: `1px solid ${COLORS.inputBorder}`,
              borderRadius: BORDER_RADIUS.md,
              fontSize: FONT_SIZE.md,
              color: COLORS.text,
            }}
            aria-label="Report date"
          />
          <Button variant="secondary" onClick={() => void refetch()} disabled={loading}>
            Refresh
          </Button>
          <Button
            onClick={() => void handlePrint()}
            loading={printing}
            disabled={!data || loading || printing}
          >
            Print Z-report
          </Button>
        </div>
      </header>

      {printToast ? (
        <div
          role="status"
          style={{
            color: printToast.kind === 'success' ? COLORS.success : COLORS.danger,
            fontSize: FONT_SIZE.sm,
          }}
        >
          {printToast.text}
        </div>
      ) : null}

      {errorCode && errorMessage ? (
        <ErrorBanner
          message={errorMessage}
          tone={errorCode === 'NETWORK' || errorCode === 'TIMEOUT' ? 'warning' : 'error'}
        />
      ) : null}

      {loading && !data ? (
        <Spinner label="Loading Z-report…" />
      ) : data && isEmptyZ(data) ? (
        <EmptyState
          title="No sales for this day"
          description="Try a different date or come back once trading begins."
        />
      ) : data ? (
        <>
          <div className="aeris-stat-strip">
            <StatCard
              label="Sales"
              value={formatNumber(data.total_sales)}
              sublabel={`${formatNumber(data.completed_sales)} completed`}
            />
            <StatCard label="Revenue" value={formatCents(data.total_revenue_cents)} />
            <StatCard label="Avg sale" value={formatCents(data.average_sale_cents)} />
            <StatCard
              label="Items sold"
              value={formatNumber(data.total_items_sold)}
              sublabel={`${formatNumber(data.unique_customers)} unique customers`}
            />
          </div>

          <Section title="Payment methods">
            {Object.keys(data.payment_method_breakdown ?? {}).length === 0 ? (
              <div style={{ color: COLORS.textMuted }}>No payments recorded.</div>
            ) : (
              <table className="aeris-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: COLORS.creamLight, color: COLORS.text }}>
                    <th style={{ textAlign: 'left', fontSize: FONT_SIZE.sm }}>Method</th>
                    <th style={{ textAlign: 'right', fontSize: FONT_SIZE.sm }}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {/* payment_method_breakdown values are CENTS (money), not counts. */}
                  {Object.entries(data.payment_method_breakdown).map(([method, cents]) => (
                    <tr key={method} style={{ borderTop: `1px solid ${COLORS.surfaceBorder}` }}>
                      <td style={{ color: COLORS.text }}>{method}</td>
                      <td style={{ color: COLORS.text, textAlign: 'right' }}>
                        {formatCents(cents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>

          {Object.keys(data.hourly_breakdown ?? {}).length > 0 ? (
            <Section title="Hourly sales">
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: SPACING.xs, height: 140 }}>
                {Object.entries(data.hourly_breakdown)
                  .sort(([a], [b]) => Number(a) - Number(b))
                  .map(([hour, count]) => {
                    const h = hourlyMax > 0 ? (count / hourlyMax) * 100 : 0;
                    return (
                      <div
                        key={hour}
                        title={`${hour}:00 — ${formatNumber(count)} sales`}
                        style={{
                          flex: 1,
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          gap: SPACING.xs,
                        }}
                      >
                        <div
                          aria-label={`${hour}:00 ${formatNumber(count)} sales`}
                          style={{
                            width: '100%',
                            height: `${Math.max(2, h)}%`,
                            background: COLORS.crimson,
                            borderRadius: BORDER_RADIUS.sm,
                          }}
                        />
                        <div style={{ color: COLORS.textMuted, fontSize: FONT_SIZE.xs }}>
                          {hour}
                        </div>
                      </div>
                    );
                  })}
              </div>
            </Section>
          ) : null}

          {Object.keys(data.sales_by_staff ?? {}).length > 0 ? (
            <Section title="Sales by staff">
              <table className="aeris-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: COLORS.creamLight, color: COLORS.text }}>
                    <th style={{ textAlign: 'left', fontSize: FONT_SIZE.sm }}>Staff</th>
                    <th style={{ textAlign: 'right', fontSize: FONT_SIZE.sm }}>Sales</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(data.sales_by_staff).map(([staff, count]) => (
                    <tr key={staff} style={{ borderTop: `1px solid ${COLORS.surfaceBorder}` }}>
                      <td style={{ color: COLORS.text }}>{staff}</td>
                      <td style={{ color: COLORS.text, textAlign: 'right' }}>
                        {formatNumber(count)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>
          ) : null}

          {Object.keys(data.sales_by_status ?? {}).length > 0 ? (
            <Section title="Sales by status">
              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {Object.entries(data.sales_by_status).map(([status, count]) => (
                  <li
                    key={status}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      padding: `${SPACING.xs}px 0`,
                      borderBottom: `1px solid ${COLORS.surfaceBorder}`,
                    }}
                  >
                    <span style={{ color: COLORS.text }}>{status}</span>
                    <span style={{ color: COLORS.textMuted }}>{formatNumber(count)}</span>
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}

          <Section title="Totals">
            <Row label="GST collected" value={formatCents(data.total_gst_cents)} />
            <Row label="Discounts" value={formatCents(data.total_discount_cents)} />
            <Row label="Pending sales" value={formatNumber(data.pending_sales)} />
          </Section>
        </>
      ) : null}
    </section>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <section
      className="aeris-card"
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
      <h2 style={{ margin: 0, fontSize: FONT_SIZE.lg, color: COLORS.text }}>{title}</h2>
      {children}
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: `${SPACING.xs}px 0` }}>
      <span style={{ color: COLORS.textMuted }}>{label}</span>
      <span style={{ color: COLORS.text }}>{value}</span>
    </div>
  );
}
