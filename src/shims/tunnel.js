/**
 * 代理隧道握手：SOCKS5 / SOCKS4(4a) / HTTP CONNECT。
 *
 * 设计上刻意与运行环境解耦——只依赖「一个已经连上代理服务器的 socket」，
 * 需要的接口仅 4 个（Node net.Socket 与 react-native-tcp-socket 都有）：
 *
 *   socket.on('data' | 'error' | 'close', fn)
 *   socket.write(buffer)
 *   socket.removeListener / off  （没有也兼容，见 SocketReader.detach）
 *   socket.destroy()
 *
 * 这样它就能：
 *   · 在 App 里被 src/shims/net.js 调用（socket 是 react-native-tcp-socket 实例）
 *   · 在 Node 里被 scripts/verify-transport.js 用真实 net.Socket 驱动做端到端验证
 *
 * 握手成功后返回「残留字节」buffer：如果代理在握手响应之后紧跟着又推了数据
 * （TLS 场景不会，但协议上允许），上层必须把它当成 socket 的第一段 data 处理。
 */
const { Buffer } = require('buffer');

const CMD_CONNECT = 0x01;
const ATYP_IPV4 = 0x01;
const ATYP_DOMAIN = 0x03;
const ATYP_IPV6 = 0x04;

const SOCKS5_ERRORS = {
  0x01: '代理内部错误',
  0x02: '代理规则禁止连接该地址',
  0x03: '网络不可达',
  0x04: '目标主机不可达',
  0x05: '目标拒绝连接',
  0x06: 'TTL 超时',
  0x07: '代理不支持 CONNECT 命令',
  0x08: '代理不支持该地址类型',
};

const SOCKS4_ERRORS = {
  0x5b: '请求被拒绝或失败',
  0x5c: '请求被拒绝：客户端未运行 identd',
  0x5d: '请求被拒绝：identd 无法确认用户 ID',
};

function toBuffer(chunk) {
  if (Buffer.isBuffer(chunk)) return chunk;
  if (chunk instanceof Uint8Array) return Buffer.from(chunk);
  if (chunk instanceof ArrayBuffer) return Buffer.from(new Uint8Array(chunk));
  return Buffer.from(String(chunk), 'binary');
}

function normalizeError(err) {
  if (err instanceof Error) return err;
  if (err && err.message) return new Error(String(err.message));
  return new Error(String(err));
}

function ipv4Bytes(host) {
  const matched = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!matched) return null;
  const parts = matched.slice(1).map(Number);
  if (parts.some((part) => part > 255)) return null;
  return parts;
}

function portBuffer(port) {
  const value = Number(port);
  if (!Number.isInteger(value) || value <= 0 || value > 65535) {
    throw new Error(`非法的端口号：${port}`);
  }
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16BE(value, 0);
  return buffer;
}

// ---------------------------------------------------------------------------
// 缓冲区读取器：把「按字节读」变成 Promise，兼容 TCP 粘包 / 拆包
// ---------------------------------------------------------------------------
class SocketReader {
  constructor(socket) {
    this.socket = socket;
    this.buffer = Buffer.alloc(0);
    this.waiters = [];
    this.failure = null;
    this.detached = false;

    this._onData = (chunk) => {
      if (this.detached) return;
      this.buffer = Buffer.concat([this.buffer, toBuffer(chunk)]);
      this._drain();
    };
    this._onError = (err) => this._fail(normalizeError(err));
    this._onClose = () => this._fail(new Error('代理服务器在握手完成前关闭了连接。'));

    socket.on('data', this._onData);
    socket.on('error', this._onError);
    socket.on('close', this._onClose);
  }

  _drain() {
    while (this.waiters.length) {
      const waiter = this.waiters[0];
      let outcome;
      try {
        outcome = waiter.probe(this.buffer);
      } catch (err) {
        // probe 内部抛错（比如响应头过大）必须转成 reject，
        // 否则会从 _onData 里逃逸成一个没人接的 uncaught exception
        this.waiters.shift();
        waiter.reject(normalizeError(err));
        continue;
      }
      if (!outcome) return;
      this.waiters.shift();
      this.buffer = outcome.rest;
      waiter.resolve(outcome.value);
    }
  }

  _fail(err) {
    if (this.detached) return;
    this.failure = err;
    const pending = this.waiters;
    this.waiters = [];
    pending.forEach((waiter) => waiter.reject(err));
  }

  _wait(probe) {
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => {
      const waiter = { probe, resolve, reject };
      this.waiters.push(waiter);
      // 加入队列后立刻试一次，处理「数据比 waiter 先到」的情况
      this._drain();
    });
  }

  readExactly(size) {
    return this._wait((buffer) => {
      if (buffer.length < size) return null;
      return { value: buffer.subarray(0, size), rest: buffer.subarray(size) };
    });
  }

  /** 读到 token 为止（含 token），用于解析 HTTP 响应头 */
  readUntil(token, maxBytes) {
    const limit = maxBytes || 64 * 1024;
    return this._wait((buffer) => {
      const index = buffer.indexOf(token);
      if (index < 0) {
        if (buffer.length > limit) {
          throw new Error('代理响应头过大，可能不是 HTTP 代理。');
        }
        return null;
      }
      const end = index + token.length;
      return { value: buffer.subarray(0, end), rest: buffer.subarray(end) };
    });
  }

  /** 拆掉所有监听，返回还没被消费掉的字节 */
  detach() {
    this.detached = true;
    const socket = this.socket;
    if (socket.removeListener) {
      socket.removeListener('data', this._onData);
      socket.removeListener('error', this._onError);
      socket.removeListener('close', this._onClose);
    } else if (socket.off) {
      socket.off('data', this._onData);
      socket.off('error', this._onError);
      socket.off('close', this._onClose);
    }
    const rest = this.buffer;
    this.buffer = Buffer.alloc(0);
    return rest;
  }
}

// ---------------------------------------------------------------------------
// SOCKS5（RFC 1928 + RFC 1929 用户名/密码认证）
// ---------------------------------------------------------------------------
function buildSocks5ConnectRequest(destination) {
  const port = portBuffer(destination.port);
  const host = String(destination.host || '');
  const v4 = ipv4Bytes(host);
  if (v4) {
    return Buffer.concat([Buffer.from([0x05, CMD_CONNECT, 0x00, ATYP_IPV4]), Buffer.from(v4), port]);
  }
  const domain = Buffer.from(host, 'utf8');
  if (!domain.length || domain.length > 255) {
    throw new Error(`无法把目标主机名交给 SOCKS5 代理：${host}`);
  }
  return Buffer.concat([
    Buffer.from([0x05, CMD_CONNECT, 0x00, ATYP_DOMAIN, domain.length]),
    domain,
    port,
  ]);
}

async function socks5Handshake(socket, options) {
  const reader = new SocketReader(socket);
  try {
    const wantAuth = Boolean(options.username || options.password);
    const methods = wantAuth ? [0x00, 0x02] : [0x00];
    socket.write(Buffer.from([0x05, methods.length, ...methods]));

    const greeting = await reader.readExactly(2);
    if (greeting[0] !== 0x05) {
      throw new Error(`SOCKS 代理返回了不认识的版本号 0x${greeting[0].toString(16)}，请确认代理类型。`);
    }

    const method = greeting[1];
    if (method === 0xff) {
      throw new Error('SOCKS5 代理拒绝了所有认证方式，请填写代理用户名与密码后重试。');
    }
    if (method === 0x02) {
      const user = Buffer.from(String(options.username || ''), 'utf8');
      const pass = Buffer.from(String(options.password || ''), 'utf8');
      if (user.length > 255 || pass.length > 255) {
        throw new Error('SOCKS5 用户名或密码过长（上限 255 字节）。');
      }
      socket.write(Buffer.concat([Buffer.from([0x01, user.length]), user, Buffer.from([pass.length]), pass]));
      const auth = await reader.readExactly(2);
      if (auth[1] !== 0x00) {
        throw new Error('SOCKS5 认证失败：用户名或密码错误。');
      }
    } else if (method !== 0x00) {
      throw new Error(`SOCKS5 代理要求不支持的认证方式 0x${method.toString(16)}。`);
    }

    socket.write(buildSocks5ConnectRequest(options.destination));

    const head = await reader.readExactly(4);
    if (head[0] !== 0x05) throw new Error('SOCKS5 代理返回了格式错误的响应。');
    if (head[1] !== 0x00) {
      const reason = SOCKS5_ERRORS[head[1]] || `未知错误码 0x${head[1].toString(16)}`;
      throw new Error(`SOCKS5 连接失败：${reason}。`);
    }

    // 消费掉 BND.ADDR + BND.PORT，长度取决于地址类型
    if (head[3] === ATYP_IPV4) {
      await reader.readExactly(4 + 2);
    } else if (head[3] === ATYP_IPV6) {
      await reader.readExactly(16 + 2);
    } else if (head[3] === ATYP_DOMAIN) {
      const length = (await reader.readExactly(1))[0];
      await reader.readExactly(length + 2);
    } else {
      throw new Error(`SOCKS5 代理返回了不支持的地址类型 0x${head[3].toString(16)}。`);
    }
  } catch (err) {
    const failure = normalizeError(err);
    reader.detach();
    throw failure;
  }
  return reader.detach();
}

// ---------------------------------------------------------------------------
// SOCKS4 / SOCKS4a
// ---------------------------------------------------------------------------
function buildSocks4Request(options) {
  const port = portBuffer(options.destination.port);
  const host = String(options.destination.host || '');
  const user = Buffer.from(String(options.username || ''), 'utf8');
  const v4 = ipv4Bytes(host);
  if (v4) {
    return Buffer.concat([Buffer.from([0x04, CMD_CONNECT]), port, Buffer.from(v4), user, Buffer.from([0x00])]);
  }
  // SOCKS4a：先把 IP 占位成 0.0.0.1，再在 user 后面附上域名
  return Buffer.concat([
    Buffer.from([0x04, CMD_CONNECT]),
    port,
    Buffer.from([0x00, 0x00, 0x00, 0x01]),
    user,
    Buffer.from([0x00]),
    Buffer.from(host, 'utf8'),
    Buffer.from([0x00]),
  ]);
}

async function socks4Handshake(socket, options) {
  const reader = new SocketReader(socket);
  try {
    socket.write(buildSocks4Request(options));
    const reply = await reader.readExactly(8);
    if (reply[0] !== 0x00) throw new Error('SOCKS4 代理返回了格式错误的响应。');
    if (reply[1] !== 0x5a) {
      const reason = SOCKS4_ERRORS[reply[1]] || `错误码 0x${reply[1].toString(16)}`;
      throw new Error(`SOCKS4 连接失败：${reason}。`);
    }
  } catch (err) {
    const failure = normalizeError(err);
    reader.detach();
    throw failure;
  }
  return reader.detach();
}

// ---------------------------------------------------------------------------
// HTTP CONNECT（RFC 7231 §4.3.6）
// ---------------------------------------------------------------------------
async function httpConnectHandshake(socket, options) {
  const reader = new SocketReader(socket);
  try {
    const target = `${options.destination.host}:${options.destination.port}`;
    const lines = [`CONNECT ${target} HTTP/1.1`, `Host: ${target}`, 'Proxy-Connection: keep-alive'];
    if (options.username || options.password) {
      const token = Buffer.from(`${options.username || ''}:${options.password || ''}`, 'utf8').toString('base64');
      lines.push(`Proxy-Authorization: Basic ${token}`);
    }
    socket.write(Buffer.from(`${lines.join('\r\n')}\r\n\r\n`, 'utf8'));

    const raw = await reader.readUntil(Buffer.from('\r\n\r\n', 'latin1'));
    const statusLine = raw.toString('latin1').split('\r\n')[0] || '';
    const matched = /^HTTP\/\d(?:\.\d)?\s+(\d{3})/.exec(statusLine);
    if (!matched) {
      throw new Error(`HTTP 代理返回了无法解析的响应：${statusLine.slice(0, 80) || '(空)'}`);
    }
    const status = Number(matched[1]);
    if (status === 407) {
      throw new Error('HTTP 代理要求身份认证（407），请填写代理用户名与密码。');
    }
    if (status !== 200) {
      throw new Error(`HTTP 代理拒绝建立隧道（${status}）。`);
    }
  } catch (err) {
    const failure = normalizeError(err);
    reader.detach();
    throw failure;
  }
  return reader.detach();
}

// ---------------------------------------------------------------------------
// 对外入口
// ---------------------------------------------------------------------------
/**
 * @param {object} socket 已经与代理服务器建立好连接的 socket
 * @param {{kind:string,host:string,port:number|string,username?:string,password?:string}} proxy
 * @param {{host:string,port:number}} destination 真正要访问的目标（Telegram DC）
 * @param {number} [timeoutMs] 握手超时，默认 10 秒
 * @returns {Promise<Buffer>} 残留字节，可能为空
 */
function establish(socket, proxy, destination, timeoutMs) {
  const kind = String((proxy && proxy.kind) || 'socks5').toLowerCase();
  const options = {
    username: proxy && proxy.username,
    password: proxy && proxy.password,
    destination,
  };

  let pending;
  if (kind === 'socks5' || kind === 'socks') {
    pending = socks5Handshake(socket, options);
  } else if (kind === 'socks4' || kind === 'socks4a') {
    pending = socks4Handshake(socket, options);
  } else if (kind === 'http' || kind === 'https' || kind === 'connect') {
    pending = httpConnectHandshake(socket, options);
  } else {
    return Promise.reject(new Error(`不支持的代理类型：${proxy && proxy.kind}`));
  }

  const limit = timeoutMs || 10000;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (typeof socket.destroy === 'function') socket.destroy();
      reject(new Error(`代理握手超时（${Math.round(limit / 1000)} 秒），请检查代理地址与端口。`));
    }, limit);

    pending.then(
      (rest) => {
        clearTimeout(timer);
        resolve(rest);
      },
      (err) => {
        clearTimeout(timer);
        reject(normalizeError(err));
      },
    );
  });
}

module.exports = {
  establish,
  buildSocks5ConnectRequest,
  buildSocks4Request,
  SOCKS5_ERRORS,
  SOCKS4_ERRORS,
  ATYP_IPV4,
  ATYP_DOMAIN,
  ATYP_IPV6,
  // 导出仅为便于测试
  SocketReader,
};
