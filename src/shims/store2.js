/**
 * `store2` 模块的内存实现。
 * GramJS 的 sessions/StoreSession 用它做同步 localStorage 读写。
 * 本客户端使用 StringSession + AsyncStorage，不会走 StoreSession，
 * 但仍需保证模块可解析（sessions/index 会导出它）。
 */
const memory = Object.create(null);

function createStore() {
  const store = (key, value) => {
    if (arguments.length === 2) {
      memory[key] = value;
      return value;
    }
    return memory[key];
  };
  store.set = (key, value) => {
    memory[key] = value;
    return value;
  };
  store.get = (key, fallback) => (key in memory ? memory[key] : fallback);
  store.has = (key) => key in memory;
  store.remove = (key) => {
    delete memory[key];
  };
  store.clearAll = () => {
    Object.keys(memory).forEach((key) => delete memory[key]);
  };
  store.getAll = () => ({ ...memory });
  store.transact = () => store;
  return store;
}

const store = createStore();
store.session = createStore();
store.local = createStore();
store.page = createStore();

module.exports = store;
module.exports.default = store;
