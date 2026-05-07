import React, { useEffect } from 'react';
import { COLORS, BORDER_RADIUS, SPACING, FONT_SIZE } from '../theme/tokens';

interface Props {
  open: boolean;
  onClose?: () => void;
  title?: string;
  children: React.ReactNode;
  width?: number;
}

export function Modal({ open, onClose, title, children, width = 480 }: Props): React.ReactElement | null {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && onClose) onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: COLORS.modalBg,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: SPACING.lg,
        zIndex: 1000,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: COLORS.surface,
          borderRadius: BORDER_RADIUS.lg,
          padding: SPACING.lg,
          width: '100%',
          maxWidth: width,
          color: COLORS.text,
          boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
        }}
      >
        {title ? (
          <h2 style={{ marginTop: 0, marginBottom: SPACING.md, fontSize: FONT_SIZE.xl }}>{title}</h2>
        ) : null}
        {children}
      </div>
    </div>
  );
}
