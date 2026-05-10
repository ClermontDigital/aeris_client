import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type {
  Category,
  Product,
  ProductCreateInput,
  ProductDetail,
  ProductUpdateInput,
} from '@aeris/shared';
import { useRelayQuery } from '../hooks/useRelayQuery';
import { relayCall } from '../services/relay';
import { Spinner } from '../components/Spinner';
import { ErrorBanner } from '../components/ErrorBanner';
import { Button } from '../components/Button';
import { TextField } from '../components/TextField';
import { COLORS, BORDER_RADIUS, FONT_SIZE, SPACING } from '../theme/tokens';

interface FormState {
  name: string;
  sku: string;
  barcode: string;
  base_price_dollars: string;
  cost_price_dollars: string;
  category_id: string;
  description: string;
  image_url: string;
  gst_applicable: boolean;
  track_stock: boolean;
  stock_quantity: string;
}

const EMPTY_FORM: FormState = {
  name: '',
  sku: '',
  barcode: '',
  base_price_dollars: '',
  cost_price_dollars: '',
  category_id: '',
  description: '',
  image_url: '',
  gst_applicable: true,
  track_stock: true,
  stock_quantity: '0',
};

function productToForm(p: ProductDetail): FormState {
  // ProductDetail's typed surface lacks track_stock; the wire shape carries it.
  // Treat undefined as true for backward compat with older detail payloads.
  const trackStockRaw = (p as ProductDetail & { track_stock?: boolean }).track_stock;
  return {
    name: p.name,
    sku: p.sku,
    barcode: p.barcode ?? '',
    base_price_dollars: (p.price_cents / 100).toFixed(2),
    cost_price_dollars: p.cost_cents != null ? (p.cost_cents / 100).toFixed(2) : '',
    category_id: p.category_id != null ? String(p.category_id) : '',
    description: p.description ?? '',
    image_url: p.image_url ?? '',
    gst_applicable: (p.tax_rate ?? 0) > 0,
    track_stock: trackStockRaw ?? true,
    stock_quantity: String(p.stock_on_hand ?? 0),
  };
}

function dollarsToCents(s: string): number | null {
  const n = Number.parseFloat(s);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

export function ItemEditScreen(): React.ReactElement {
  const params = useParams<{ id: string }>();
  const navigate = useNavigate();
  const editingId = params.id ? Number(params.id) : null;
  const isEdit = editingId !== null && Number.isFinite(editingId);

  const detail = useRelayQuery<ProductDetail | null>(
    'products.detail',
    isEdit ? { product_id: editingId, id: editingId } : {},
    { refetchOnFocus: false },
  );

  const categories = useRelayQuery<Category[]>('products.categories', {}, {
    refetchOnFocus: false,
  });

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [hydrated, setHydrated] = useState(!isEdit);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!isEdit || hydrated) return;
    if (detail.data) {
      setForm(productToForm(detail.data));
      setHydrated(true);
    }
  }, [isEdit, hydrated, detail.data]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!form.name.trim()) {
      setErrorMessage('Name is required.');
      return;
    }
    if (!form.sku.trim()) {
      setErrorMessage('SKU is required.');
      return;
    }
    const basePriceCents = dollarsToCents(form.base_price_dollars);
    if (basePriceCents === null) {
      setErrorMessage('Price must be a non-negative number.');
      return;
    }
    if (!form.category_id) {
      setErrorMessage('Category is required.');
      return;
    }

    const costPriceCents =
      form.cost_price_dollars.trim().length > 0
        ? dollarsToCents(form.cost_price_dollars)
        : null;
    if (form.cost_price_dollars.trim().length > 0 && costPriceCents === null) {
      setErrorMessage('Cost price must be a non-negative number.');
      return;
    }

    const base = {
      name: form.name.trim(),
      sku: form.sku.trim(),
      barcode: form.barcode.trim() || null,
      base_price_cents: basePriceCents,
      cost_price_cents: costPriceCents,
      category_id: Number(form.category_id),
      description: form.description.trim() || null,
      image_url: form.image_url.trim() || null,
      gst_applicable: form.gst_applicable,
      // Server defaults tax_rate to 10 when omitted, so disabling GST without
      // sending tax_rate: 0 is a no-op. Mirror the toggle explicitly.
      tax_rate: form.gst_applicable ? 10 : 0,
      track_stock: form.track_stock,
    };

    setSaving(true);
    try {
      if (isEdit && editingId !== null) {
        const patch = base as ProductUpdateInput;
        const result = await relayCall<Product>('products.update', {
          id: editingId,
          ...patch,
        });
        if (!result.ok) {
          setErrorMessage(result.message);
          return;
        }
        navigate(`/items/${editingId}`);
      } else {
        const stockQty = Number.parseInt(form.stock_quantity, 10);
        const payload: ProductCreateInput = {
          ...base,
          stock_quantity: Number.isFinite(stockQty) && stockQty > 0 ? stockQty : 0,
        };
        const result = await relayCall<Product>('products.create', payload);
        if (!result.ok) {
          setErrorMessage(result.message);
          return;
        }
        navigate(`/items/${result.data.id}`);
      }
    } finally {
      setSaving(false);
    }
  };

  if (isEdit && !hydrated && detail.loading) {
    return <Spinner label="Loading item…" />;
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
              navigate(isEdit && editingId !== null ? `/items/${editingId}` : '/items')
            }
          >
            ← Back
          </Button>
        </div>
        <h1 style={{ margin: 0, color: COLORS.text, fontSize: FONT_SIZE.xxl }}>
          {isEdit ? 'Edit item' : 'New item'}
        </h1>
      </header>

      {errorMessage ? <ErrorBanner message={errorMessage} /> : null}

      <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: SPACING.md }}>
        <Card title="Item">
          <TextField
            label="Name"
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            required
          />
          <TwoCol>
            <TextField
              label="SKU"
              value={form.sku}
              onChange={(e) => set('sku', e.target.value)}
              required
            />
            <TextField
              label="Barcode"
              value={form.barcode}
              onChange={(e) => set('barcode', e.target.value)}
            />
          </TwoCol>
          <Select
            label="Category"
            value={form.category_id}
            onChange={(v) => set('category_id', v)}
            options={[
              { value: '', label: '— Select category —' },
              ...((categories.data ?? []).map((c) => ({
                value: String(c.id),
                label: c.name,
              }))),
            ]}
          />
        </Card>

        <Card title="Pricing">
          <TwoCol>
            <TextField
              label="Price (AUD)"
              type="number"
              inputMode="decimal"
              step="0.01"
              min={0}
              value={form.base_price_dollars}
              onChange={(e) => set('base_price_dollars', e.target.value)}
              required
            />
            <TextField
              label="Cost price (AUD)"
              type="number"
              inputMode="decimal"
              step="0.01"
              min={0}
              value={form.cost_price_dollars}
              onChange={(e) => set('cost_price_dollars', e.target.value)}
            />
          </TwoCol>
          <CheckboxRow
            checked={form.gst_applicable}
            onChange={(v) => set('gst_applicable', v)}
            label="GST applicable (10%)"
          />
        </Card>

        <Card title="Inventory">
          <CheckboxRow
            checked={form.track_stock}
            onChange={(v) => set('track_stock', v)}
            label="Track inventory"
          />
          {!isEdit ? (
            <TextField
              label="Initial stock on hand"
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              value={form.stock_quantity}
              onChange={(e) => set('stock_quantity', e.target.value)}
              helperText="Use the Adjust stock action after creation for further changes."
            />
          ) : (
            <div style={{ color: COLORS.textMuted, fontSize: FONT_SIZE.sm }}>
              Adjust stock from the item detail screen.
            </div>
          )}
        </Card>

        <Card title="Description">
          <TextField
            label="Image URL"
            value={form.image_url}
            onChange={(e) => set('image_url', e.target.value)}
          />
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
            <span>Description</span>
            <textarea
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
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

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: SPACING.sm }}>
          <Button
            variant="secondary"
            onClick={() =>
              navigate(isEdit && editingId !== null ? `/items/${editingId}` : '/items')
            }
            disabled={saving}
          >
            Cancel
          </Button>
          <Button type="submit" loading={saving}>
            {isEdit ? 'Save changes' : 'Create item'}
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
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: SPACING.md }}>
      {children}
    </div>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}): React.ReactElement {
  return (
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
      <span>{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          padding: `${SPACING.sm}px ${SPACING.md}px`,
          background: COLORS.inputBg,
          border: `1px solid ${COLORS.inputBorder}`,
          borderRadius: BORDER_RADIUS.md,
          fontSize: FONT_SIZE.md,
          color: COLORS.text,
          fontFamily: 'inherit',
        }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function CheckboxRow({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}): React.ReactElement {
  return (
    <label
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: SPACING.sm,
        fontSize: FONT_SIZE.md,
        color: COLORS.text,
        cursor: 'pointer',
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{ width: 16, height: 16, accentColor: COLORS.crimson }}
      />
      <span>{label}</span>
    </label>
  );
}
