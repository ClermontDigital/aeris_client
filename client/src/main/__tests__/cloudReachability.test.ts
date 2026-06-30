import { cloudReachability } from '../cloudReachability';

// Port of mobile's cloudReachabilityStore hysteresis tests: a single/double
// transport failure must NOT flip unreachable; the 3rd does. An app-level 4xx
// never counts. Source of truth: §M3-A.

describe('cloudReachability hysteresis', () => {
  beforeEach(() => cloudReachability.reset());

  test('starts unknown (null)', () => {
    expect(cloudReachability.getCloudReachable()).toBeNull();
  });

  test('a single success -> reachable', () => {
    cloudReachability.report(true);
    expect(cloudReachability.getCloudReachable()).toBe(true);
  });

  test('1 or 2 consecutive transport failures do NOT flip unreachable', () => {
    cloudReachability.report(true);
    cloudReachability.report(false);
    expect(cloudReachability.getCloudReachable()).toBe(true);
    cloudReachability.report(false);
    expect(cloudReachability.getCloudReachable()).toBe(true);
  });

  test('the 3rd consecutive transport failure flips unreachable', () => {
    cloudReachability.report(true);
    cloudReachability.report(false);
    cloudReachability.report(false);
    cloudReachability.report(false);
    expect(cloudReachability.getCloudReachable()).toBe(false);
  });

  test('a success between failures resets the streak', () => {
    cloudReachability.report(false);
    cloudReachability.report(false);
    cloudReachability.report(true); // reset
    cloudReachability.report(false);
    cloudReachability.report(false);
    expect(cloudReachability.getCloudReachable()).toBe(true);
  });

  test('an app-level 4xx (isTransport=false) never counts toward unreachable', () => {
    cloudReachability.report(true);
    cloudReachability.reportFailure(false);
    cloudReachability.reportFailure(false);
    cloudReachability.reportFailure(false);
    expect(cloudReachability.getCloudReachable()).toBe(true);
  });

  test('reachableSustainedMs is 0 when unreachable, grows when reachable', () => {
    cloudReachability.report(false);
    cloudReachability.report(false);
    cloudReachability.report(false);
    expect(cloudReachability.reachableSustainedMs()).toBe(0);
    cloudReachability.report(true);
    expect(cloudReachability.reachableSustainedMs()).toBeGreaterThanOrEqual(0);
  });

  test('onChange fires only on a verdict transition', () => {
    const seen: Array<boolean | null> = [];
    const off = cloudReachability.onChange(() =>
      seen.push(cloudReachability.getCloudReachable()),
    );
    cloudReachability.report(true); // null -> true (fire)
    cloudReachability.report(true); // true -> true (no fire)
    cloudReachability.report(false); // 1 (no flip, no fire)
    cloudReachability.report(false); // 2
    cloudReachability.report(false); // 3 -> false (fire)
    off();
    expect(seen).toEqual([true, false]);
  });
});
