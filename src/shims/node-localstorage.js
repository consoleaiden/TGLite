/**
 * `node-localstorage` 模块占位。
 * GramJS 的 sessions/localStorage 只在 Node 环境下使用，这里提供最小可用的内存实现。
 */
class LocalStorage {
  constructor(/* location, quota */) {
    this._data = Object.create(null);
    this.length = 0;
  }

  getItem(key) {
    return key in this._data ? this._data[key] : null;
  }

  setItem(key, value) {
    if (!(key in this._data)) this.length += 1;
    this._data[key] = String(value);
  }

  removeItem(key) {
    if (key in this._data) {
      delete this._data[key];
      this.length -= 1;
    }
  }

  clear() {
    this._data = Object.create(null);
    this.length = 0;
  }

  key(index) {
    return Object.keys(this._data)[index] || null;
  }
}

module.exports = { LocalStorage };
