import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type {
  Customer,
  CustomerCreateInput,
  CustomerUpdateInput,
} from '@aeris/shared';
import { useRelayQuery } from '../hooks/useRelayQuery';
import { relayCall } from '../services/relay';
import { Spinner } from '../components/Spinner';
import { ErrorBanner } from '../components/ErrorBanner';
import { Button } from '../components/Button';
import { TextField } from '../components/TextField';
import { COLORS, BORDER_RADIUS, FONT_SIZE, SPACING } from '../theme/tokens';
import { formatCents } from '../utils/format';

interface FormState {
  first_name: string;
  last_name: string;
  company: string;
  email: string;
  phone: string;
  mobile: string;
  address: string;
  address_line_2: string;
  city: string;
  state: string;
  postcode: string;
  country: string;
  notes: string;
}

const EMPTY_FORM: FormState = {
  first_name: '',
  last_name: '',
  company: '',
  email: '',
  phone: '',
  mobile: '',
  address: '',
  address_line_2: '',
  city: '',
  state: '',
  postcode: '',
  country: 'Australia',
  notes: '',
};

function pickFirstAddress(c: Customer | null | undefined): {
  address: string;
  address_line_2: string;
  city: string;
  state: string;
  postcode: string;
  country: string;
} {
  const a = c?.default_address ?? c?.addresses?.[0] ?? null;
  return {
    address: a?.line_1 ?? '',
    address_line_2: a?.line_2 ?? '',
    city: a?.city ?? '',
    state: a?.state ?? '',
    postcode: a?.postcode ?? '',
    country: a?.country ?? 'Australia',
  };
}

function customerToForm(c: Customer): FormState {
  const addr = pickFirstAddress(c);
  return {
    first_name: c.first_name ?? '',
    last_name: c.last_name ?? '',
    company: c.company ?? '',
    email: c.email ?? '',
    phone: c.phone ?? '',
    mobile: c.mobile ?? '',
    notes: c.notes ?? '',
    ...addr,
  };
}

// first_name OR company is required (mirrors StoreCustomerRequest validation).
function buildPayload(form: FormState): CustomerCreateInput {
  const out: CustomerCreateInput = {};
  const trim = (s: string): string | null => {
    const t = s.trim();
    return t.length > 0 ? t : null;
  };
  out.first_name = trim(form.first_name);
  out.last_name = trim(form.last_name);
  out.company = trim(form.company);
  out.email = trim(form.email);
  out.phone = trim(form.phone);
  out.mobile = trim(form.mobile);
  out.notes = trim(form.notes);
  out.address = trim(form.address);
  out.address_line_2 = trim(form.address_line_2);
  out.city = trim(form.city);
  out.state = trim(form.state);
  out.postcode = trim(form.postcode);
  out.country = trim(form.country);
  return out;
}

export function CustomerEditScreen(): React.ReactElement {
  const params = useParams<{ id: string }>();
  const navigate = useNavigate();
  const editingId = params.id ? Number(params.id) : null;
  const isEdit = editingId !== null && Number.isFinite(editingId);

  const detail = useRelayQuery<Customer | null>(
    'customers.detail',
    isEdit ? { customer_id: editingId, id: editingId } : {},
    { refetchOnFocus: false },
  );

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [hydrated, setHydrated] = useState(!isEdit);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!isEdit || hydrated) return;
    if (detail.data) {
      setForm(customerToForm(detail.data));
      setHydrated(true);
    }
  }, [isEdit, hydrated, detail.data]);

  // For create mode, skip the detail query entirely by suppressing it.
  // useRelayQuery still fires once with empty params; harmless because
  // `customers.detail` with no id resolves to null (the screen would
  // ignore it anyway). The check above gates form hydration.
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!form.first_name.trim() && !form.company.trim()) {
      setErrorMessage('Either first name or company is required.');
      return;
    }
    // StoreCustomerRequest requires at least one contact channel; surface the
    // 422 inline before the round-trip.
    if (!form.email.trim() && !form.phone.trim() && !form.mobile.trim()) {
      setErrorMessage('Provide at least one contact method: email, phone, or mobile.');
      return;
    }

    setSaving(true);
    try {
      if (isEdit && editingId !== null) {
        const patch = buildPayload(form) as CustomerUpdateInput;
        const result = await relayCall<Customer>('customers.update', {
          id: editingId,
          ...patch,
        });
        if (!result.ok) {
          setErrorMessage(result.message);
          return;
        }
        navigate(`/customers/${editingId}`);
      } else {
        const payload = buildPayload(form);
        const result = await relayCall<Customer>('customers.create', payload);
        if (!result.ok) {
          setErrorMessage(result.message);
          return;
        }
        navigate(`/customers/${result.data.id}`);
      }
    } finally {
      setSaving(false);
    }
  };

  if (isEdit && !hydrated && detail.loading) {
    return <Spinner label="Loading customer…" />;
  }

  return (
    <section
      className="aeris-fade-in"
      style={{ display: 'flex', flexDirection: 'column', gap: SPACING.md }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div>
          <Button
            variant="ghost"
            onClick={() =>
              navigate(isEdit && editingId !== null ? `/customers/${editingId}` : '/customers')
            }
          >
            ← Back
          </Button>
        </div>
        <h1 style={{ margin: 0, color: COLORS.text, fontSize: FONT_SIZE.xxl }}>
          {isEdit ? 'Edit customer' : 'New customer'}
        </h1>
      </header>

      {errorMessage ? <ErrorBanner message={errorMessage} /> : null}

      <form
        onSubmit={onSubmit}
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: SPACING.md,
        }}
      >
        <Card title="Customer">
          <TwoCol>
            <TextField
              label="First name"
              value={form.first_name}
              onChange={(e) => set('first_name', e.target.value)}
              required={!form.company.trim()}
            />
            <TextField
              label="Last name"
              value={form.last_name}
              onChange={(e) => set('last_name', e.target.value)}
            />
          </TwoCol>
          <TextField
            label="Company"
            value={form.company}
            onChange={(e) => set('company', e.target.value)}
            helperText="Either a first name or company is required."
          />
        </Card>

        <Card title="Contact">
          <TextField
            label="Email"
            type="email"
            value={form.email}
            onChange={(e) => set('email', e.target.value)}
          />
          <TwoCol>
            <TextField
              label="Phone"
              value={form.phone}
              onChange={(e) => set('phone', e.target.value)}
            />
            <TextField
              label="Mobile"
              value={form.mobile}
              onChange={(e) => set('mobile', e.target.value)}
            />
          </TwoCol>
        </Card>

        <Card title="Address">
          <TextField
            label="Street"
            value={form.address}
            onChange={(e) => set('address', e.target.value)}
          />
          <TextField
            label="Address line 2"
            value={form.address_line_2}
            onChange={(e) => set('address_line_2', e.target.value)}
          />
          <TwoCol>
            <TextField
              label="City"
              value={form.city}
              onChange={(e) => set('city', e.target.value)}
            />
            <TextField
              label="State"
              value={form.state}
              onChange={(e) => set('state', e.target.value)}
            />
          </TwoCol>
          <TwoCol>
            <TextField
              label="Postcode"
              value={form.postcode}
              onChange={(e) => set('postcode', e.target.value)}
            />
            <TextField
              label="Country"
              value={form.country}
              onChange={(e) => set('country', e.target.value)}
            />
          </TwoCol>
        </Card>

        <Card title="Notes">
          <label
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: SPACING.xs,
              fontSize: FONT_SIZE.sm,
              color: COLORS.text,
              fontWeight: 600,
            }}
          >
            <span>Notes</span>
            <textarea
              value={form.notes}
              onChange={(e) => set('notes', e.target.value)}
              rows={4}
              style={{
                padding: `${SPACING.sm}px ${SPACING.md}px`,
                background: COLORS.inputBg,
                border: `1px solid ${COLORS.inputBorder}`,
                borderRadius: BORDER_RADIUS.md,
                color: COLORS.text,
                fontSize: FONT_SIZE.md,
                resize: 'vertical',
                fontFamily: 'inherit',
              }}
            />
          </label>
        </Card>

        {isEdit && detail.data ? (
          <Card title="Account">
            <Row
              label="Account balance"
              value={
                detail.data.account_balance_cents != null
                  ? formatCents(detail.data.account_balance_cents)
                  : '—'
              }
            />
          </Card>
        ) : null}

        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: SPACING.sm,
          }}
        >
          <Button
            variant="secondary"
            onClick={() =>
              navigate(isEdit && editingId !== null ? `/customers/${editingId}` : '/customers')
            }
            disabled={saving}
          >
            Cancel
          </Button>
          <Button type="submit" loading={saving}>
            {isEdit ? 'Save changes' : 'Create customer'}
          </Button>
        </div>
      </form>
    </section>
  );
}

function Card({
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

function TwoCol({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: SPACING.md,
      }}
    >
      {children}
    </div>
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
