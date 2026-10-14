/** AsyncStorage 的测试替身（CommonJS，避免被 babel 当 TS/Flow 解析） */
const store = new Map();

const AsyncStorageMock = {
  getItem: async (key) => (store.has(key) ? store.get(key) : null),
  setItem: async (key, value) => { store.set(key, String(value)); },
  removeItem: async (key) => { store.delete(key); },
  clear: async () => { store.clear(); },
  getAllKeys: async () => Array.from(store.keys()),
  multiGet: async (keys) => keys.map((k) => [k, store.has(k) ? store.get(k) : null]),
  multiSet: async (pairs) => { for (const [k, v] of pairs) store.set(k, String(v)); },
  multiRemove: async (keys) => { for (const k of keys) store.delete(k); },
  mergeItem: async (key, value) => {
    const current = store.get(key);
    if (!current) { store.set(key, String(value)); return; }
    try { store.set(key, JSON.stringify({ ...JSON.parse(current), ...JSON.parse(value) })); }
    catch { store.set(key, String(value)); }
  },
  __reset: () => { store.clear(); },
};

module.exports = AsyncStorageMock;
module.exports.default = AsyncStorageMock;
