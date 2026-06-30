import {useCloudReachabilityStore} from '../cloudReachabilityStore';

// M3-A hysteresis / anti-flap: the auto endpoint-swap is gated (via the routing
// cascade) on cloudReachable===false. cloudReachable must NOT flip false on a
// single transport blip — only after UNREACHABLE_AFTER_FAILURES (=3)
// consecutive transport failures — otherwise a momentary 4G hiccup would
// thrash the till into on-prem mode. These tests pin that hysteresis.
describe('cloudReachabilityStore — hysteresis (no flap)', () => {
  beforeEach(() => {
    useCloudReachabilityStore.getState().reset();
  });

  it('starts unknown (null) — a cold start with no signal is NOT an outage', () => {
    expect(useCloudReachabilityStore.getState().cloudReachable).toBeNull();
  });

  it('a SINGLE transport failure does NOT declare the cloud unreachable', () => {
    useCloudReachabilityStore.getState().reportFailure(true);
    expect(useCloudReachabilityStore.getState().cloudReachable).not.toBe(false);
    expect(useCloudReachabilityStore.getState().consecutiveFailures).toBe(1);
  });

  it('TWO consecutive failures still hold (below the threshold)', () => {
    useCloudReachabilityStore.getState().reportFailure(true);
    useCloudReachabilityStore.getState().reportFailure(true);
    expect(useCloudReachabilityStore.getState().cloudReachable).not.toBe(false);
  });

  it('THREE consecutive transport failures flip cloudReachable false', () => {
    const s = useCloudReachabilityStore.getState();
    s.reportFailure(true);
    s.reportFailure(true);
    s.reportFailure(true);
    expect(useCloudReachabilityStore.getState().cloudReachable).toBe(false);
  });

  it('an application (4xx) failure does NOT count toward unreachable — server answered', () => {
    const s = useCloudReachabilityStore.getState();
    s.reportFailure(false);
    s.reportFailure(false);
    s.reportFailure(false);
    expect(useCloudReachabilityStore.getState().consecutiveFailures).toBe(0);
    expect(useCloudReachabilityStore.getState().cloudReachable).not.toBe(false);
  });

  it('a success resets the consecutive-failure counter (no flap from intermittent misses)', () => {
    const s = useCloudReachabilityStore.getState();
    s.reportFailure(true);
    s.reportFailure(true); // 2 — still below threshold
    s.reportSuccess(); // resets
    s.reportFailure(true); // back to 1, not 3
    expect(useCloudReachabilityStore.getState().cloudReachable).not.toBe(false);
    expect(useCloudReachabilityStore.getState().consecutiveFailures).toBe(1);
  });

  it('success after an outage flips back to reachable and starts the failback clock', () => {
    const s = useCloudReachabilityStore.getState();
    s.reportFailure(true);
    s.reportFailure(true);
    s.reportFailure(true);
    expect(useCloudReachabilityStore.getState().cloudReachable).toBe(false);
    s.reportSuccess();
    const after = useCloudReachabilityStore.getState();
    expect(after.cloudReachable).toBe(true);
    expect(after.reachableSinceMs).not.toBeNull();
    // sustained ms is ~0 immediately after recovery → failback hysteresis holds.
    expect(after.reachableSustainedMs()).toBeLessThan(FAILBACK_WINDOW);
  });
});

// A loose upper bound just to assert "freshly back" reads as not-yet-sustained.
const FAILBACK_WINDOW = 45_000;
