/**
 * Node `net` 模块的 React Native 兼容实现，底层使用 react-native-tcp-socket。
 *
 * GramJS 的 extensions/PromisedNetSockets 只用到以下 API，这里按需实现：
 *   new Socket()
 *   socket.connect(port, host, cb) / socket.on('data'|'error'|'close') /
 *   socket.write(buf) / socket.destroy() / socket.unref() / socket.destroyed
 *
 * 说明：react-native-tcp-socket 在未调用 setEncoding 时，'data' 事件回调收到的是 Buffer，
 * 正好满足 MTProto 的二进制协议要求。
 */
const TcpSocketModule = require('react-native-tcp-socket');
const { Buffer } = require('buffer');

const TcpSocket = TcpSocketModule.default || TcpSocketModule;

class Socket {
  constructor(options) {
    const opts = options || {};
    this.destroyed = false;
    this.connecting = false;
    this.readable = true;
    this.writable = true;
    this.noDelay = opts.noDelay !== false;
    this.keepAlive = !!opts.keepAlive;
    this.remoteAddress = undefined;
    this.remotePort = undefined;
    this.bytesWritten = 0;
    this._socket = null;
    this._listeners = Object.create(null);
    this._pending = [];
  }

  // ---- 事件 -----------------------------------------------------------------
  on(event, listener) {
    (this._listeners[event] || (this._listeners[event] = [])).push(listener);
    return this;
  }

  addListener(event, listener) {
    return this.on(event, listener);
  }

  once(event, listener) {
    const wrapper = (...args) => {
      this.off(event, wrapper);
      listener.apply(this, args);
    };
    return this.on(event, wrapper);
  }

  off(event, listener) {
    const list = this._listeners[event];
    if (list) this._listeners[event] = list.filter((item) => item !== listener);
    return this;
  }

  removeListener(event, listener) {
    return this.off(event, listener);
  }

  removeAllListeners(event) {
    if (event) delete this._listeners[event];
    else this._listeners = Object.create(null);
    return this;
  }

  _emit(event, ...args) {
    const list = this._listeners[event];
    if (!list || !list.length) return false;
    for (const listener of list.slice()) listener.apply(this, args);
    return true;
  }

  // ---- 连接 -----------------------------------------------------------------
  connect(port, host, callback) {
    // GramJS 用的是 connect(port, host, cb) 三段式
    if (typeof port === 'object' && port !== null) {
      const opts = port;
      callback = typeof host === 'function' ? host : callback;
      host = opts.host || opts.hostname;
      port = opts.port;
    }
    if (typeof host === 'function') {
      callback = host;
      host = undefined;
    }

    this.connecting = true;
    this.remotePort = port;
    this.remoteAddress = host;

    this._socket = TcpSocket.createConnection(
      { port, host: host || '127.0.0.1' },
      () => {
        this.connecting = false;
        if (this.noDelay && typeof this._socket.setNoDelay === 'function') {
          try {
            this._socket.setNoDelay(true);
          } catch (e) {
            /* 忽略：部分平台不支持 */
          }
        }
        if (this.keepAlive && typeof this._socket.setKeepAlive === 'function') {
          try {
            this._socket.setKeepAlive(true, 30000);
          } catch (e) {
            /* 忽略 */
          }
        }
        for (const chunk of this._pending) this._socket.write(chunk);
        this._pending = [];
        this._emit('connect');
        if (typeof callback === 'function') callback();
      },
    );

    this._socket.on('data', (data) => {
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
      this._emit('data', buf);
    });

    this._socket.on('error', (err) => {
      this._emit('error', err instanceof Error ? err : new Error(String(err && err.message ? err.message : err)));
    });

    this._socket.on('close', (hadError) => {
      this.destroyed = true;
      this.readable = false;
      this.writable = false;
      this._emit('close', !!hadError);
    });

    this._socket.on('timeout', () => this._emit('timeout'));

    return this;
  }

  // ---- 读写 -----------------------------------------------------------------
  write(data, _encoding, cb) {
    if (this.destroyed) {
      const err = new Error('Socket is closed');
      if (typeof cb === 'function') cb(err);
      this._emit('error', err);
      return false;
    }
    const buf = Buffer.isBuffer(data) || data instanceof Uint8Array ? data : Buffer.from(String(data), 'utf8');
    if (!this._socket) {
      this._pending.push(buf);
    } else {
      this._socket.write(buf);
      this.bytesWritten += buf.length;
    }
    if (typeof cb === 'function') cb();
    return true;
  }

  end(data, _encoding, cb) {
    if (data) this.write(data);
    if (this._socket && typeof this._socket.end === 'function') this._socket.end();
    if (typeof cb === 'function') cb();
    return this;
  }

  destroy() {
    if (this.destroyed) return this;
    this.destroyed = true;
    this.readable = false;
    this.writable = false;
    if (this._socket && typeof this._socket.destroy === 'function') {
      try {
        this._socket.destroy();
      } catch (e) {
        /* 忽略重复销毁 */
      }
    }
    return this;
  }

  pause() {
    return this;
  }

  resume() {
    return this;
  }

  setEncoding() {
    // 我们永远要二进制，忽略字符串编码请求
    return this;
  }

  setNoDelay(noDelay = true) {
    this.noDelay = !!noDelay;
    if (this._socket && typeof this._socket.setNoDelay === 'function') {
      try {
        this._socket.setNoDelay(!!noDelay);
      } catch (e) {
        /* 忽略 */
      }
    }
    return this;
  }

  setKeepAlive(enable = false, initialDelay = 0) {
    this.keepAlive = !!enable;
    if (this._socket && typeof this._socket.setKeepAlive === 'function') {
      try {
        this._socket.setKeepAlive(!!enable, initialDelay);
      } catch (e) {
        /* 忽略 */
      }
    }
    return this;
  }

  setTimeout() {
    return this;
  }

  ref() {
    return this;
  }

  unref() {
    // Node 的 unref 会让事件循环不再等待该 socket，RN 里不需要也不支持，空实现即可
    return this;
  }

  address() {
    return { address: this.remoteAddress, port: this.remotePort, family: 'IPv4' };
  }
}

module.exports = {
  Socket,
  createConnection: (options, callback) => new Socket().connect(options, callback),
  connect: (options, callback) => new Socket().connect(options, callback),
  isIP: (input) => (/^\d+\.\d+\.\d+\.\d+$/.test(input) ? 4 : input.includes(':') ? 6 : 0),
  isIPv4: (input) => /^\d+\.\d+\.\d+\.\d+$/.test(input),
  isIPv6: (input) => input.includes(':'),
};
