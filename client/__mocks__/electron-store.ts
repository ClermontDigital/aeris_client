// In-memory electron-store mock. One singleton per `name`, mirroring
// production behaviour so multiple stores can coexist in a test.

const buckets = new Map<string, Record<string, unknown>>();

interface Options<T> {
  name?: string;
  defaults?: T;
}

class StoreMock<T extends Record<string, unknown>> {
  private name: string;
  constructor(opts: Options<T> = {}) {
    this.name = opts.name ?? 'default';
    if (!buckets.has(this.name)) {
      buckets.set(this.name, { ...(opts.defaults ?? {}) });
    }
  }
  get(key: string): unknown {
    return buckets.get(this.name)?.[key];
  }
  set(key: string, value: unknown): void {
    let b = buckets.get(this.name);
    if (!b) {
      b = {};
      buckets.set(this.name, b);
    }
    b[key] = value;
  }
  clear(): void {
    buckets.set(this.name, {});
  }
  // Reset all stored values WITHOUT dropping bucket identity, so module-level
  // `new Store(...)` references created before reset still write/read correctly.
  static __resetAll(): void {
    for (const k of buckets.keys()) buckets.set(k, {});
  }
}

export default StoreMock;
