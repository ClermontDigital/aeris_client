import React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { Customer } from '@aeris/shared';
import { useRelayQuery } from '../hooks/useRelayQuery';
import { Spinner } from '../components/Spinner';
import { EmptyState } from '../components/EmptyState';
import { ErrorBanner } from '../components/ErrorBanner';
import { Button } from '../components/Button';
import { COLORS, SPACING, FONT_SIZE, BORDER_RADIUS } from '../theme/tokens';
import { formatCents, formatDate } from '../utils/format';

function Field({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: `${SPACING.xs}px 0` }}>
      <span style={{ color: COLORS.textMuted }}>{label}</span>
      <span style={{ color: COLORS.text }}>{value}</span>
    </div>
  );
}

export function CustomerDetailScreen(): React.ReactElement {
  const params = useParams<{ id: string }>();
  const navigate = useNavigate();
  const customerId = Number(params.id);

  const { data, loading, errorCode, errorMessage } = useRelayQuery<Customer | null>(
    'customers.detail',
    { customer_id: customerId, id: customerId },
  );

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: SPACING.md }}>
      <header>
        <Button variant="ghost" onClick={() => navigate('/customers')}>
          ← Back to customers
        </Button>
      </header>

      {errorCode && errorMessage ? (
        <ErrorBanner
          message={errorMessage}
          tone={errorCode === 'NETWORK' || errorCode === 'TIMEOUT' ? 'warning' : 'error'}
        />
      ) : null}

      {loading && !data ? (
        <Spinner label="Loading customer…" />
      ) : !loading && !data ? (
        <EmptyState
          title="Customer not found"
          description="That customer may have been removed."
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
              flexDirection: 'column',
              gap: SPACING.xs,
            }}
          >
            <h1 style={{ margin: 0, color: COLORS.text, fontSize: FONT_SIZE.xxl }}>{data.name}</h1>
            {data.company ? (
              <div style={{ color: COLORS.textMuted }}>{data.company}</div>
            ) : null}
            {data.customer_number ? (
              <div style={{ color: COLORS.textMuted, fontSize: FONT_SIZE.sm }}>
                Customer #{data.customer_number}
              </div>
            ) : null}
          </div>

          <section
            style={{
              background: COLORS.surface,
              borderRadius: BORDER_RADIUS.lg,
              border: `1px solid ${COLORS.surfaceBorder}`,
              padding: SPACING.lg,
            }}
          >
            <h2 style={{ margin: 0, marginBottom: SPACING.sm, fontSize: FONT_SIZE.lg, color: COLORS.text }}>
              Contact
            </h2>
            <Field label="Email" value={data.email ?? '—'} />
            <Field label="Phone" value={data.phone ?? '—'} />
            <Field label="Mobile" value={data.mobile ?? '—'} />
          </section>

          {data.addresses && data.addresses.length > 0 ? (
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
              <h2 style={{ margin: 0, fontSize: FONT_SIZE.lg, color: COLORS.text }}>Addresses</h2>
              {data.addresses.map((a, i) => (
                <div
                  key={a.id ?? i}
                  style={{
                    paddingTop: i === 0 ? 0 : SPACING.sm,
                    borderTop: i === 0 ? 'none' : `1px solid ${COLORS.surfaceBorder}`,
                    color: COLORS.text,
                  }}
                >
                  {a.label ? (
                    <div style={{ color: COLORS.textMuted, fontSize: FONT_SIZE.sm, marginBottom: SPACING.xs }}>
                      {a.label}
                    </div>
                  ) : null}
                  <div>{a.line_1}</div>
                  {a.line_2 ? <div>{a.line_2}</div> : null}
                  <div>
                    {[a.city, a.state, a.postcode].filter(Boolean).join(' ')}
                  </div>
                  {a.country ? <div>{a.country}</div> : null}
                </div>
              ))}
            </section>
          ) : null}

          <section
            style={{
              background: COLORS.surface,
              borderRadius: BORDER_RADIUS.lg,
              border: `1px solid ${COLORS.surfaceBorder}`,
              padding: SPACING.lg,
            }}
          >
            <h2 style={{ margin: 0, marginBottom: SPACING.sm, fontSize: FONT_SIZE.lg, color: COLORS.text }}>
              Account
            </h2>
            <Field
              label="Total spent"
              value={data.total_spent_cents != null ? formatCents(data.total_spent_cents) : '—'}
            />
            <Field
              label="Total orders"
              value={data.total_orders != null ? String(data.total_orders) : '—'}
            />
            <Field
              label="Loyalty points"
              value={data.loyalty_points != null ? String(data.loyalty_points) : '—'}
            />
            <Field
              label="Account balance"
              value={
                data.account_balance_cents != null
                  ? formatCents(data.account_balance_cents)
                  : '—'
              }
            />
            <Field
              label="Last purchase"
              value={data.last_purchase_date ? formatDate(data.last_purchase_date) : '—'}
            />
          </section>

          {data.recent_sales && data.recent_sales.length > 0 ? (
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
              <h2 style={{ margin: 0, fontSize: FONT_SIZE.lg, color: COLORS.text }}>Recent sales</h2>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ color: COLORS.textMuted }}>
                    <th style={{ textAlign: 'left', padding: SPACING.xs, fontSize: FONT_SIZE.sm }}>Sale #</th>
                    <th style={{ textAlign: 'left', padding: SPACING.xs, fontSize: FONT_SIZE.sm }}>Date</th>
                    <th style={{ textAlign: 'right', padding: SPACING.xs, fontSize: FONT_SIZE.sm }}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recent_sales.map((s) => (
                    <tr
                      key={s.id}
                      onClick={() => navigate(`/transactions/${s.id}`)}
                      style={{ cursor: 'pointer', borderTop: `1px solid ${COLORS.surfaceBorder}` }}
                    >
                      <td style={{ padding: SPACING.xs, color: COLORS.text }}>{s.sale_number}</td>
                      <td style={{ padding: SPACING.xs, color: COLORS.textMuted, fontSize: FONT_SIZE.sm }}>
                        {formatDate(s.created_at)}
                      </td>
                      <td style={{ padding: SPACING.xs, color: COLORS.text, textAlign: 'right' }}>
                        {formatCents(s.total_cents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ) : null}

          {data.notes ? (
            <section
              style={{
                background: COLORS.surface,
                borderRadius: BORDER_RADIUS.lg,
                border: `1px solid ${COLORS.surfaceBorder}`,
                padding: SPACING.lg,
              }}
            >
              <h2 style={{ margin: 0, marginBottom: SPACING.sm, fontSize: FONT_SIZE.lg, color: COLORS.text }}>
                Notes
              </h2>
              <p style={{ margin: 0, color: COLORS.text, lineHeight: 1.6 }}>{data.notes}</p>
            </section>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
