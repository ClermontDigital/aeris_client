import React, { useEffect, useState } from 'react';
import type {
  StockAdjustment,
  StockAdjustmentInput,
  StockAdjustmentReason,
} from '@aeris/shared';
import { Modal } from './Modal';
import { Button } from './Button';
import { TextField } from './TextField';
import { ErrorBanner } from './ErrorBanner';
import { relayCall } from '../services/relay';
import { COLORS, FONT_SIZE, SPACING, BORDER_RADIUS } from '../theme/tokens';

const REASONS: Array<{ value: StockAdjustmentReason; label: string }> = [
  { value: 'count_correction', label: 'Count correction' },
  { value: 'damaged_goods', label: 'Damaged goods' },
  { value: 'expired_goods', label: 'Expired goods' },
  { value: 'theft_loss', label: 'Theft / loss' },
  { value: 'found_stock', label: 'Found stock' },
  { value: 'supplier_error', label: 'Supplier error' },
  { value: 'manual_adjustment', label: 'Manual adjustment' },
  { value: 'return_to_stock', label: 'Return to stock' },
  { value: 'other', label: 'Other' },
];

interface Props {
  open: boolean;
  onClose: () => void;
  productId: number;
  currentStock: number;
  onComplete: () => void;
}

export function StockAdjustmentModal({
  open,
  onClose,
  productId,
  currentStock,
  onComplete,
}: Props): React.ReactElement {
  const [reason, setReason] = useState<StockAdjustmentReason>('count_correction');
  const [deltaText, setDeltaText] = useState('0');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setReason('count_correction');
      setDeltaText('0');
      setNotes('');
      setErrorMessage(null);
      setSubmitting(false);
    }
  }, [open]);

  const delta = Number.parseInt(deltaText, 10);
  const deltaValid = Number.isFinite(delta) && delta !== 0;
  const projected = (currentStock ?? 0) + (Number.isFinite(delta) ? delta : 0);

  const handleSubmit = async () => {
    setErrorMessage(null);
    if (!deltaValid) {
      setErrorMessage('Enter a non-zero adjustment.');
      return;
    }
    if (projected < 0) {
      setErrorMessage('Adjustment would drive stock below zero.');
      return;
    }

    const payload: StockAdjustmentInput = {
      product_id: productId,
      adjustment: delta,
      reason,
      notes: notes.trim() || null,
    };

    setSubmitting(true);
    try {
      const result = await relayCall<StockAdjustment>('inventory.adjust-stock', payload);
      if (!result.ok) {
        setErrorMessage(result.message);
        return;
      }
      onComplete();
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={submitting ? undefined : onClose}
      title="Adjust stock"
      width={520}
      actions={
        <>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} loading={submitting}>
            Save adjustment
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: SPACING.md }}>
        {errorMessage ? <ErrorBanner message={errorMessage} /> : null}

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
          <span>Reason</span>
          <select
            value={reason}
            onChange={(e) => setReason(e.target.value as StockAdjustmentReason)}
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
            {REASONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </label>

        <TextField
          label="Adjustment (positive adds stock, negative removes)"
          type="number"
          inputMode="numeric"
          step={1}
          value={deltaText}
          onChange={(e) => setDeltaText(e.target.value)}
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
          <span>Notes (optional)</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
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

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            padding: SPACING.md,
            background: COLORS.creamLight,
            borderRadius: BORDER_RADIUS.md,
            border: `1px solid ${COLORS.surfaceBorder}`,
          }}
        >
          <div>
            <div style={{ color: COLORS.textMuted, fontSize: FONT_SIZE.sm }}>Current stock</div>
            <div style={{ color: COLORS.text, fontSize: FONT_SIZE.xl, fontWeight: 700 }}>
              {currentStock}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ color: COLORS.textMuted, fontSize: FONT_SIZE.sm }}>New stock</div>
            <div
              style={{
                color: projected < 0 ? COLORS.crimson : COLORS.text,
                fontSize: FONT_SIZE.xl,
                fontWeight: 700,
              }}
            >
              {projected}
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}
