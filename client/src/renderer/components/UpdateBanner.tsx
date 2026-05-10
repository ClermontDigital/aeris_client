import React, { useEffect, useRef, useState } from 'react';
import type { UpdateStatus } from '../../shared-types/ipc';
import { Button } from './Button';
import { COLORS, BORDER_RADIUS, SPACING, FONT_SIZE } from '../theme/tokens';

type View =
  | { kind: 'available'; version?: string }
  | { kind: 'downloaded'; version?: string }
  | { kind: 'manual-fallback'; version?: string; htmlUrl?: string }
  | null;

function statusToView(s: UpdateStatus): View {
  switch (s.kind) {
    case 'available':
    case 'downloading':
      return { kind: 'available', version: s.version };
    case 'downloaded':
      return { kind: 'downloaded', version: s.version };
    case 'manual-fallback':
      return { kind: 'manual-fallback', version: s.version, htmlUrl: s.htmlUrl };
    default:
      return null;
  }
}

export function UpdateBanner(): React.ReactElement | null {
  const [view, setView] = useState<View>(null);
  const [dismissed, setDismissed] = useState(false);
  // Track the kind that was last surfaced so we only un-dismiss when the
  // banner transitions to a meaningfully different state — otherwise
  // every progress event during downloading would un-dismiss the banner.
  type Kind = 'available' | 'downloaded' | 'manual-fallback';
  const lastKindRef = useRef<Kind | null>(null);

  useEffect(() => {
    const off1 = window.aeris.update.onStatusChanged((status) => {
      const next = statusToView(status);
      if (next) {
        setView(next);
        if (lastKindRef.current !== next.kind) {
          setDismissed(false);
          lastKindRef.current = next.kind;
        }
      }
    });
    const off2 = window.aeris.update.onManualFallback((status) => {
      setView({
        kind: 'manual-fallback',
        version: status.version,
        htmlUrl: status.htmlUrl,
      });
      if (lastKindRef.current !== 'manual-fallback') {
        setDismissed(false);
        lastKindRef.current = 'manual-fallback';
      }
    });
    return () => {
      off1();
      off2();
    };
  }, []);

  if (!view || dismissed) return null;

  let message: string;
  let action: React.ReactElement | null = null;
  switch (view.kind) {
    case 'available':
      message = view.version
        ? `Aeris ${view.version} available — downloading…`
        : 'A new Aeris version is available — downloading…';
      break;
    case 'downloaded':
      message = view.version
        ? `Aeris ${view.version} ready — Restart to install`
        : 'Update ready — Restart to install';
      action = (
        <Button onClick={() => void window.aeris.update.installNow()}>Restart now</Button>
      );
      break;
    case 'manual-fallback':
      message = view.version
        ? `Aeris ${view.version} is available — Download`
        : 'A new Aeris version is available — Download';
      action = view.htmlUrl ? (
        <Button onClick={() => void window.aeris.update.openDownload(view.htmlUrl!)}>
          Download
        </Button>
      ) : null;
      break;
  }

  return (
    <div
      role="status"
      style={{
        background: COLORS.primary,
        color: COLORS.textOnDark,
        borderBottom: `1px solid ${COLORS.surfaceBorder}`,
        padding: `${SPACING.sm}px ${SPACING.md}px`,
        display: 'flex',
        alignItems: 'center',
        gap: SPACING.md,
        fontSize: FONT_SIZE.sm,
      }}
    >
      <span style={{ flex: 1 }}>{message}</span>
      {action}
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
        style={{
          background: 'transparent',
          border: 0,
          color: COLORS.textOnDark,
          fontSize: 18,
          lineHeight: 1,
          padding: 0,
          borderRadius: BORDER_RADIUS.sm,
          cursor: 'pointer',
        }}
      >
        ×
      </button>
    </div>
  );
}
