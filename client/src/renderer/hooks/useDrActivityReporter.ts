import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useCartStore } from '../stores/cartStore';
import { useDrStore } from '../stores/drStore';

// useDrActivityReporter (Electron renderer) — M3-E. Reports the renderer-owned
// mid-transaction signals (cart item count + current screen) up to main so the
// failover orchestrator's Rule 1 never auto-switches mid-sale. The in-flight
// sale/refund half of Rule 1 is tracked in main directly (relayBridge).
//
// 'Checkout' is the load-bearing screen name the cascade matches on, so we map
// the checkout route to exactly that. Other routes pass their path through.

function screenName(pathname: string): string {
  if (pathname.startsWith('/pos/checkout')) return 'Checkout';
  return pathname;
}

export function useDrActivityReporter(): void {
  const location = useLocation();
  const itemCount = useCartStore((s) => s.getItemCount());
  const reportActivity = useDrStore((s) => s.reportActivity);

  useEffect(() => {
    reportActivity({
      cartItemCount: itemCount,
      activeScreen: screenName(location.pathname),
    });
  }, [itemCount, location.pathname, reportActivity]);
}
