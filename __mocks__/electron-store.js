// Mock electron-store for testing
class Store {
  constructor() {
    this.store = {};
  }

  get(key, defaultValue) {
    return this.store[key] !== undefined ? this.store[key] : defaultValue;
  }

  set(key, value) {
    this.store[key] = value;
  }

  has(key) {
    return this.store.hasOwnProperty(key);
  }

  delete(key) {
    delete this.store[key];
  }

  clear() {
    this.store = {};
  }

  // Helper for testing
  _reset() {
    this.store = {};
  }

  // Helper to get all data
  _getAll() {
    return { ...this.store };
  }
}

module.exports = Store;
