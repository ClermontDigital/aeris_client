import React from 'react';
import { COLORS, FONT_SIZE, SPACING } from '../theme/tokens';

interface Props {
  title: string;
  description?: string;
  action?: React.ReactNode;
  icon?: React.ReactNode;
}

export function EmptyState({ title, description, action, icon }: Props): React.ReactElement {
  return (
    <div
      role="status"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: SPACING.xl,
        textAlign: 'center',
        gap: SPACING.sm,
        color: COLORS.textMuted,
      }}
    >
      {icon ? <div aria-hidden>{icon}</div> : null}
      <div
        style={{
          color: COLORS.text,
          fontSize: FONT_SIZE.xl,
          fontWeight: 600,
        }}
      >
        {title}
      </div>
      {description ? (
        <div style={{ maxWidth: 480, lineHeight: 1.5 }}>{description}</div>
      ) : null}
      {action ? <div style={{ marginTop: SPACING.md }}>{action}</div> : null}
    </div>
  );
}
