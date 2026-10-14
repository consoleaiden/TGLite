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
 *
 * 代理支持：
 *   打开代理后，TCP 不再直连 Telegram DC，而是先连到代理服务器，
 *   再由 src/shims/tunnel.js 完成 SOCKS5 / SOCKS4 / HTTP CONNECT 握手。
 *   关键在于「'connect' 事件必须等隧道建好之后再 emit」——GramJS 收到 connect
 *   就会立刻写 MTProto 握手的第一个包，早一毫秒都会把明文写进代理的连接请求里。
 */
const TcpSocketModule = require('react-native-tcp-socket');
const { Buffer } = require('buffer');

const transportState = require('./transport-state');
const tunnel = require('./tunnel');

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
    /** 隧道握手期间要吞掉底层数据（那些字节属于代理协议，不是 MTProto） */
    this._handshaking = false;
    /** 强制指定本次连接使用的代理；由 connectViaProxy() 设置，绕过全局配置 */
    this._proxyOverride = undefined;
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

    const proxy = this._proxyOverride !== undefined ? this._proxyOverride : transportState.getProxy();
    const dialHost = proxy ? proxy.host : host;
    const dialPort = proxy ? proxy.port : port;

    this._socket = TcpSocket.createConnection(
      { port: dialPort, host: dialHost || '127.0.0.1' },
      () => {
        this._applySocketOptions();

        if (!proxy) {
          this._completeConnect(callback);
          return;
        }

        // 先连到代理，再做隧道握手；期间底层数据全部交给 tunnel 处理
        this._handshaking = true;
        tunnel
          .establish(this._socket, proxy, { host, port }, proxy.timeoutMs)
          .then((leftover) => {
            this._handshaking = false;
            this._completeConnect(callback);
            // 握手响应之后跟着的业务数据要补发出去，否则第一个 MTProto 包会丢
            if (leftover && leftover.length) this._emit('data', leftover);
          })
          .catch((err) => {
            this._handshaking = false;
            this._emit('error', err instanceof Error ? err : new Error(String(err)));
            this.destroy();
          });
      },
    );

    this._socket.on('data', (data) => {
      if (this._handshaking) return; // 交给 tunnel 的 SocketReader
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

  _applySocketOptions() {
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
  }

  _completeConnect(callback) {
    this.connecting = false;
    for (const chunk of this._pending) this._socket.write(chunk);
    this._pending = [];
    this._emit('connect');
    if (typeof callback === 'function') callback();
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

/**
 * 按指定代理解析出一个「已经连到 destination」的 Socket。
 * 语义与 socks 包的 SocksClient.createConnection 一致，
 * 供 src/shims/socks.js 复用（GramJS 只有在传 clientParams.proxy 时才会走那条路）。
 */
function connectViaProxy(proxy, destination, timeoutMs) {
  const socket = new Socket();
  socket._proxyOverride = {
    ...proxy,
    timeoutMs: timeoutMs || proxy.timeoutMs || 10000,
  };
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (err) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(err instanceof Error ? err : new Error(String(err)));
    };
    socket.once('error', fail);
    socket.connect(destination.port, destination.host, () => {
      if (settled) return;
      settled = true;
      socket.off('error', fail);
      resolve(socket);
    });
  });
}

module.exports = {
  Socket,
  createConnection: (options, callback) => new Socket().connect(options, callback),
  connect: (options, callback) => new Socket().connect(options, callback),
  connectViaProxy,
  isIP: (input) => (/^\d+\.\d+\.\d+\.\d+$/.test(input) ? 4 : input.includes(':') ? 6 : 0),
  isIPv4: (input) => /^\d+\.\d+\.\d+\.\d+$/.test(input),
  isIPv6: (input) => input.includes(':'),
};
