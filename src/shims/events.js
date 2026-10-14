/**
 * 极简 EventEmitter，替换 Node 的 `events` 模块。
 * 只覆盖 GramJS 及其依赖实际用到的接口。
 */
class EventEmitter {
  constructor() {
    this._events = Object.create(null);
  }

  on(event, listener) {
    (this._events[event] || (this._events[event] = [])).push(listener);
    return this;
  }

  addListener(event, listener) {
    return this.on(event, listener);
  }

  prependListener(event, listener) {
    (this._events[event] || (this._events[event] = [])).unshift(listener);
    return this;
  }

  once(event, listener) {
    const wrapper = (...args) => {
      this.removeListener(event, wrapper);
      listener.apply(this, args);
    };
    wrapper.listener = listener;
    return this.on(event, wrapper);
  }

  removeListener(event, listener) {
    const list = this._events[event];
    if (!list) return this;
    this._events[event] = list.filter((item) => item !== listener && item.listener !== listener);
    return this;
  }

  off(event, listener) {
    return this.removeListener(event, listener);
  }

  removeAllListeners(event) {
    if (event) delete this._events[event];
    else this._events = Object.create(null);
    return this;
  }

  emit(event, ...args) {
    const list = this._events[event];
    if (!list || !list.length) return false;
    for (const listener of list.slice()) {
      try {
        listener.apply(this, args);
      } catch (err) {
        reportError(err, `EventEmitter:${event}`);
      }
    }
    return true;
  }

  listeners(event) {
    return (this._events[event] || []).map((item) => item.listener || item);
  }

  listenerCount(event) {
    return (this._events[event] || []).length;
  }

  eventNames() {
    return Object.keys(this._events);
  }

  setMaxListeners() {
    return this;
  }

  getMaxListeners() {
    return 10;
  }
}

function reportError(err, scope) {
  if (typeof globalThis.reportError === 'function') {
    globalThis.reportError(err);
    return;
  }
  console.warn(`[tg-lite] 事件回调异常 (${scope})`, err);
}

EventEmitter.EventEmitter = EventEmitter;
EventEmitter.default = EventEmitter;
EventEmitter.once = (emitter, event) =>
  new Promise((resolve) => emitter.once(event, (...args) => resolve(args)));

module.exports = EventEmitter;
