#!/usr/bin/env node
/**
 * 传输层端到端验证（无需 Android SDK / 模拟器）。
 *
 * 这一层是本次改动里最容易「看起来对、其实连不上」的部分，所以不靠人眼审查，
 * 而是当场起真实的 SOCKS5 / SOCKS4 / HTTP CONNECT 代理服务器，把流量真的穿过去。
 *
 * 验证链路（每一层都是真代码）：
 *
 *   GramJS PromisedNetSockets
 *        -> src/shims/net.js            （我们写的 Node net 兼容层）
 *        -> src/shims/tunnel.js         （我们写的代理握手）
 *        -> 真实 SOCKS5 / SOCKS4 / HTTP 代理服务器
 *        -> 真实 upstream echo 服务器
 *
 * 关键点：用真实 Node net.Socket 顶替 react-native-tcp-socket。
 * 两者的接口子集一致（on/write/destroy/end/setNoDelay/setKeepAlive），
 * 所以能把整个 shim 栈原封不动地搬到 Node 里跑。
 *
 * 用法：node scripts/verify-transport.js
 */
const Module = require('module');
const net = require('net');
const path = require('path');
const assert = require('assert');
const { Buffer } = require('buffer');

const projectRoot = path.resolve(__dirname, '..');
const shimPath = (name) => path.join(projectRoot, 'src', 'shims', name);

// ---------------------------------------------------------------------------
// 用真实 Node socket 冒充 react-native-tcp-socket，并把 `net` 换成我们的 shim
//
// ⚠️ 只替换 react-native-tcp-socket 是不够的：GramJS 的 extensions/net.js
//    本质上是 `export * from "net"`，如果不同时把 `net` 也重定向到 shim，
//    PromisedNetSockets 会直接用 Node 内置 socket 直连目标，
//    测试就会「通过」但完全没经过代理——这是最危险的一种假绿灯。
// ---------------------------------------------------------------------------
const nodeTcpAdapter = {
  createConnection(options, callback) {
    return net.createConnection({ host: options.host, port: options.port }, () => {
      if (callback) callback();
    });
  },
};

const overrides = {
  net: shimPath('net.js'),
};

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'react-native-tcp-socket') return nodeTcpAdapter;
  if (Object.prototype.hasOwnProperty.call(overrides, request)) {
    return originalLoad.call(this, overrides[request], parent, isMain);
  }
  return originalLoad.call(this, request, parent, isMain);
};

const tunnel = require(shimPath('tunnel.js'));
const transportState = require(shimPath('transport-state.js'));
const netShim = require(shimPath('net.js'));
const { PromisedNetSockets } = require(
  path.join(projectRoot, 'node_modules', 'telegram', 'extensions', 'PromisedNetSockets.js'),
);

// 自证：此刻 GramJS 看到的 `net` 必须是我们写的 shim。
// 少了这一步，代理测试可能整条链路都在直连却依然绿灯。
{
  const netSeenByGramJS = require('net');
  if (netSeenByGramJS !== netShim || typeof netShim.connectViaProxy !== 'function') {
    throw new Error('net 未被重定向到 shim，代理相关测试结果不可信');
  }
}

// ---------------------------------------------------------------------------
// 测试用的小工具
// ---------------------------------------------------------------------------
/** 增量读取器：把「按字节读」变成 Promise */
function makeReader(socket) {
  let buffer = Buffer.alloc(0);
  const waiters = [];
  const tryDrain = () => {
    while (waiters.length) {
      const waiter = waiters[0];
      const outcome = waiter.probe(buffer);
      if (!outcome) return;
      waiters.shift();
      buffer = outcome.rest;
      waiter.resolve(outcome.value);
    }
  };
  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    tryDrain();
  });
  return {
    read(size) {
      return new Promise((resolve, reject) => {
        waiters.push({
          probe: (current) => {
            if (current.length < size) return null;
            return { value: current.subarray(0, size), rest: current.subarray(size) };
          },
          resolve,
          reject,
        });
        tryDrain();
      });
    },
    readUntil(token) {
      return new Promise((resolve, reject) => {
        waiters.push({
          probe: (current) => {
            const index = current.indexOf(token);
            if (index < 0) return null;
            const end = index + token.length;
            return { value: current.subarray(0, end), rest: current.subarray(end) };
          },
          resolve,
          reject,
        });
        tryDrain();
      });
    },
  };
}

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

/**
 * upstream：收到 PING 回 PONG。
 * 只有真正穿过代理到达这里，「PONG」才可能出现，所以它就是隧道的证据。
 */
function startEchoServer() {
  const hits = [];
  const server = net.createServer((socket) => {
    socket.on('data', (chunk) => {
      const text = chunk.toString('utf8');
      hits.push(text);
      if (text.includes('PING')) socket.write('PONG');
    });
    socket.on('error', () => {});
  });
  return { server, hits };
}

/** SOCKS5 服务器（可选用户名密码认证，RFC 1929） */
function startSocks5Server(options = {}) {
  const { requireAuth = false, username = 'user', password = 'pass' } = options;
  // 统计有多少条连接真的被代理转发了；测试靠它区分「走代理」与「偷偷直连」
  const stats = { requests: 0, authorized: 0 };
  const server = net.createServer(async (socket) => {
    socket.on('error', () => {});
    try {
      const reader = makeReader(socket);

      const greeting = await reader.read(2);
      if (greeting[0] !== 0x05) throw new Error('bad version');
      const methods = await reader.read(greeting[1]);
      const wantsAuth = methods.includes(0x02);
      const wantsNone = methods.includes(0x00);

      if (requireAuth) {
        if (!wantsAuth) {
          socket.end(Buffer.from([0x05, 0xff]));
          return;
        }
        socket.write(Buffer.from([0x05, 0x02]));
        const authHead = await reader.read(2);
        const user = (await reader.read(authHead[1])).toString('utf8');
        const passLength = (await reader.read(1))[0];
        const pass = (await reader.read(passLength)).toString('utf8');
        if (user !== username || pass !== password) {
          socket.end(Buffer.from([0x01, 0x01]));
          return;
        }
        socket.write(Buffer.from([0x01, 0x00]));
        stats.authorized += 1;
      } else {
        if (!wantsNone) {
          socket.end(Buffer.from([0x05, 0xff]));
          return;
        }
        socket.write(Buffer.from([0x05, 0x00]));
      }

      const request = await reader.read(4);
      stats.requests += 1;
      if (request[1] !== 0x01) {
        socket.end(Buffer.from([0x05, 0x07, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
        return;
      }
      let host;
      if (request[3] === 0x01) {
        host = Array.from(await reader.read(4)).join('.');
      } else if (request[3] === 0x03) {
        const length = (await reader.read(1))[0];
        host = (await reader.read(length)).toString('utf8');
      } else {
        socket.end(Buffer.from([0x05, 0x08, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
        return;
      }
      const port = (await reader.read(2)).readUInt16BE(0);

      const upstream = net.createConnection({ host, port }, () => {
        socket.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
        socket.pipe(upstream);
        upstream.pipe(socket);
      });
      upstream.on('error', () => {
        try {
          socket.end(Buffer.from([0x05, 0x05, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
        } catch (e) {
          /* 忽略 */
        }
      });
    } catch (err) {
      socket.destroy();
    }
  });
  return { server, stats };
}

/** SOCKS4 / SOCKS4a 服务器 */
function startSocks4Server() {
  const resolvedHosts = [];
  const server = net.createServer(async (socket) => {
    socket.on('error', () => {});
    try {
      const reader = makeReader(socket);
      const head = await reader.read(8);
      if (head[0] !== 0x04 || head[1] !== 0x01) {
        socket.end(Buffer.from([0x00, 0x5b, 0, 0, 0, 0, 0, 0]));
        return;
      }
      const port = head.readUInt16BE(2);
      const rawIp = Array.from(head.subarray(4, 8)).join('.');

      // 读完 USERID（以 0x00 结尾）
      let userId = '';
      for (;;) {
        const byte = (await reader.read(1))[0];
        if (byte === 0x00) break;
        userId += String.fromCharCode(byte);
      }

      let host = rawIp;
      // SOCKS4a：IP 占位 0.0.0.x 时后面跟域名
      if (rawIp.startsWith('0.0.0.')) {
        host = '';
        for (;;) {
          const byte = (await reader.read(1))[0];
          if (byte === 0x00) break;
          host += String.fromCharCode(byte);
        }
      }
      resolvedHosts.push({ host, port, userId });

      const upstream = net.createConnection({ host, port }, () => {
        socket.write(Buffer.from([0x00, 0x5a, 0, 0, 0, 0, 0, 0]));
        socket.pipe(upstream);
        upstream.pipe(socket);
      });
      upstream.on('error', () => {
        try {
          socket.end(Buffer.from([0x00, 0x5b, 0, 0, 0, 0, 0, 0]));
        } catch (e) {
          /* 忽略 */
        }
      });
    } catch (err) {
      socket.destroy();
    }
  });
  return { server, resolvedHosts };
}

/** HTTP CONNECT 代理（可选 Basic 认证） */
function startHttpProxy(options = {}) {
  const { requireAuth = false, username = 'user', password = 'pass' } = options;
  const stats = { requests: 0, unauthorized: 0 };
  const server = net.createServer((socket) => {
    socket.on('error', () => {});
    let buffer = Buffer.alloc(0);
    const onData = (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      const end = buffer.indexOf('\r\n\r\n');
      if (end < 0) return;

      socket.removeListener('data', onData);
      // 摘掉 data 监听后流仍在 flowing 状态，必须显式暂停，
      // 否则握手期间到达的数据会被静默丢弃（这是 Node 的经典坑）
      socket.pause();

      const head = buffer.subarray(0, end).toString('latin1');
      const rest = buffer.subarray(end + 4);
      const lines = head.split('\r\n');
      const matched = /^CONNECT ([^:]+):(\d+) HTTP\/1\.1$/i.exec(lines[0] || '');
      if (!matched) {
        socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
        return;
      }

      stats.requests += 1;

      if (requireAuth) {
        const header = lines.find((line) => /^proxy-authorization:/i.test(line));
        const expected = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
        const provided = header ? header.slice(header.indexOf(':') + 1).trim() : '';
        if (provided !== expected) {
          stats.unauthorized += 1;
          socket.end(
            'HTTP/1.1 407 Proxy Authentication Required\r\n' +
              'Proxy-Authenticate: Basic realm="tg-lite"\r\n\r\n',
          );
          return;
        }
      }

      const upstream = net.createConnection({ host: matched[1], port: Number(matched[2]) }, () => {
        socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (rest.length) upstream.write(rest);
        socket.pipe(upstream);
        upstream.pipe(socket);
      });
      upstream.on('error', () => socket.destroy());
    };
    socket.on('data', onData);
  });
  return { server, stats };
}

// ---------------------------------------------------------------------------
// 断言工具
// ---------------------------------------------------------------------------
const results = [];
async function check(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
  } catch (err) {
    results.push({ name, ok: false, error: err });
  }
}

function connectTo(host, port) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port }, () => resolve(socket));
    socket.on('error', reject);
  });
}

/** 直接验证 tunnel.establish：握手 -> 收发自证 */
async function assertTunnelWorks({ proxy, destination }) {
  const socket = await connectTo(proxy.host, proxy.port);
  const leftover = await tunnel.establish(socket, proxy, destination, 5000);
  assert.ok(leftover.length === 0, `握手后不应有残留字节，实际 ${leftover.length} 字节`);

  const reader = makeReader(socket);
  socket.write(Buffer.from('PING', 'utf8'));
  const echo = await reader.read(4);
  assert.strictEqual(echo.toString('utf8'), 'PONG', '隧道尽头没有把 PING 变成 PONG');
  socket.destroy();
}

async function main() {
  const echo = startEchoServer();
  const echoPort = await listen(echo.server);

  const socks5 = startSocks5Server();
  const socks5Port = await listen(socks5.server);

  const socks5Auth = startSocks5Server({ requireAuth: true, username: 'alice', password: 's3cret' });
  const socks5AuthPort = await listen(socks5Auth.server);

  const socks4 = startSocks4Server();
  const socks4Port = await listen(socks4.server);

  const httpProxy = startHttpProxy();
  const httpPort = await listen(httpProxy.server);

  const httpAuth = startHttpProxy({ requireAuth: true, username: 'bob', password: 'hunter2' });
  const httpAuthPort = await listen(httpAuth.server);

  // ---------------------------------------------------------------------
  // 1. 协议构造函数的字节级正确性
  // ---------------------------------------------------------------------
  await check('SOCKS5 CONNECT 请求对 IPv4 走 ATYP=1', () => {
    const request = Buffer.from(tunnel.buildSocks5ConnectRequest({ host: '149.154.167.51', port: 443 }));
    assert.deepStrictEqual(
      [...request],
      [0x05, 0x01, 0x00, 0x01, 149, 154, 167, 51, 0x01, 0xbb],
      'SOCKS5 请求字节不对',
    );
  });

  await check('SOCKS5 CONNECT 请求对域名走 ATYP=3', () => {
    const host = 'pluto.web.telegram.org';
    const request = Buffer.from(tunnel.buildSocks5ConnectRequest({ host, port: 443 }));
    assert.strictEqual(request[3], 0x03, '域名应使用 ATYP=3');
    assert.strictEqual(request[4], host.length, '域名长度字节不对');
    assert.strictEqual(request.subarray(5, 5 + host.length).toString('utf8'), host);
    assert.deepStrictEqual([...request.subarray(-2)], [0x01, 0xbb]);
    assert.strictEqual(request.length, 5 + host.length + 2);
  });

  await check('SOCKS4a 请求把域名放在 USERID 之后', () => {
    const request = Buffer.from(
      tunnel.buildSocks4Request({ destination: { host: 'example.com', port: 80 }, username: 'u' }),
    );
    assert.deepStrictEqual([...request.subarray(0, 4)], [0x04, 0x01, 0x00, 0x50]);
    assert.deepStrictEqual([...request.subarray(4, 8)], [0x00, 0x00, 0x00, 0x01], 'SOCKS4a 占位 IP 不对');
    assert.strictEqual(request.subarray(8, 9).toString('utf8'), 'u');
    assert.strictEqual(request.subarray(10).toString('utf8'), 'example.com\x00');
  });

  // ---------------------------------------------------------------------
  // 2. 真实隧道：SOCKS5 无认证
  // ---------------------------------------------------------------------
  await check('SOCKS5（无认证）隧道可收发', async () => {
    await assertTunnelWorks({
      proxy: { kind: 'socks5', host: '127.0.0.1', port: socks5Port },
      destination: { host: '127.0.0.1', port: echoPort },
    });
  });

  await check('SOCKS5（用户名密码）隧道可收发', async () => {
    await assertTunnelWorks({
      proxy: {
        kind: 'socks5',
        host: '127.0.0.1',
        port: socks5AuthPort,
        username: 'alice',
        password: 's3cret',
      },
      destination: { host: '127.0.0.1', port: echoPort },
    });
  });

  await check('SOCKS5 密码错误时报出可读错误', async () => {
    const socket = await connectTo('127.0.0.1', socks5AuthPort);
    await assert.rejects(
      tunnel.establish(
        socket,
        { kind: 'socks5', host: '127.0.0.1', port: socks5AuthPort, username: 'alice', password: 'wrong' },
        { host: '127.0.0.1', port: echoPort },
        5000,
      ),
      /用户名或密码错误/,
    );
    socket.destroy();
  });

  await check('SOCKS5 用域名连接（ATYP=DOMAIN）', async () => {
    await assertTunnelWorks({
      proxy: { kind: 'socks5', host: '127.0.0.1', port: socks5Port },
      destination: { host: 'localhost', port: echoPort },
    });
  });

  await check('SOCKS5 目标端口无服务时给出明确失败原因', async () => {
    const socket = await connectTo('127.0.0.1', socks5Port);
    await assert.rejects(
      tunnel.establish(
        socket,
        { kind: 'socks5', host: '127.0.0.1', port: socks5Port },
        { host: '127.0.0.1', port: 1 },
        5000,
      ),
      /SOCKS5 连接失败/,
    );
    socket.destroy();
  });

  // ---------------------------------------------------------------------
  // 3. 真实隧道：SOCKS4 / SOCKS4a
  // ---------------------------------------------------------------------
  await check('SOCKS4a 隧道可收发（域名形式）', async () => {
    await assertTunnelWorks({
      proxy: { kind: 'socks4', host: '127.0.0.1', port: socks4Port, username: 'tglite' },
      destination: { host: 'localhost', port: echoPort },
    });
    assert.ok(socks4.resolvedHosts.length > 0, '代理端没有收到解析请求');
    assert.strictEqual(socks4.resolvedHosts[0].userId, 'tglite', 'USERID 没传对');
  });

  // ---------------------------------------------------------------------
  // 4. 真实隧道：HTTP CONNECT
  // ---------------------------------------------------------------------
  await check('HTTP CONNECT（无认证）隧道可收发', async () => {
    await assertTunnelWorks({
      proxy: { kind: 'http', host: '127.0.0.1', port: httpPort },
      destination: { host: '127.0.0.1', port: echoPort },
    });
  });

  await check('HTTP CONNECT（Basic 认证）隧道可收发', async () => {
    await assertTunnelWorks({
      proxy: { kind: 'http', host: '127.0.0.1', port: httpAuthPort, username: 'bob', password: 'hunter2' },
      destination: { host: '127.0.0.1', port: echoPort },
    });
  });

  await check('HTTP 代理返回 407 时提示要填用户名密码', async () => {
    const socket = await connectTo('127.0.0.1', httpAuthPort);
    await assert.rejects(
      tunnel.establish(
        socket,
        { kind: 'http', host: '127.0.0.1', port: httpAuthPort },
        { host: '127.0.0.1', port: echoPort },
        5000,
      ),
      /407/,
    );
    socket.destroy();
  });

  await check('代理只接受连接却不响应时，会按超时中断而不是一直挂住', async () => {
    // 黑洞代理：接受 TCP 连接但永不回应任何协议数据
    const blackhole = net.createServer(() => {});
    const blackholePort = await listen(blackhole);
    const socket = await connectTo('127.0.0.1', blackholePort);
    await assert.rejects(
      tunnel.establish(
        socket,
        { kind: 'socks5', host: '127.0.0.1', port: blackholePort },
        { host: '127.0.0.1', port: echoPort },
        300,
      ),
      /握手超时/,
    );
    blackhole.close();
  });

  // ---------------------------------------------------------------------
  // 5. 全链路：GramJS 的 PromisedNetSockets 穿过 net shim 与代理
  // ---------------------------------------------------------------------
  await check('PromisedNetSockets + net shim + SOCKS5 代理全链路收发', async () => {
    const before = socks5.stats.requests;
    transportState.setProxy({
      enabled: true,
      kind: 'socks5',
      host: '127.0.0.1',
      port: socks5Port,
    });
    try {
      const socket = new PromisedNetSockets();
      await socket.connect(echoPort, '127.0.0.1');
      socket.write(Buffer.from('PING', 'utf8'));
      const received = await socket.readExactly(4);
      assert.strictEqual(received.toString('utf8'), 'PONG', '全链路收发失败');
      await socket.close();
    } finally {
      transportState.setProxy(null);
    }
    // 这一步才是关键：证明流量确实经过代理，而不是绕过去直连了
    assert.strictEqual(socks5.stats.requests, before + 1, 'SOCKS5 代理没有收到 CONNECT 请求，说明实际是直连');
  });

  await check('PromisedNetSockets + net shim + HTTP 代理全链路收发（含认证）', async () => {
    const before = httpAuth.stats.requests;
    const beforeUnauthorized = httpAuth.stats.unauthorized;
    transportState.setProxy({
      enabled: true,
      kind: 'http',
      host: '127.0.0.1',
      port: httpAuthPort,
      username: 'bob',
      password: 'hunter2',
    });
    try {
      const socket = new PromisedNetSockets();
      await socket.connect(echoPort, 'localhost');
      socket.write(Buffer.from('PING', 'utf8'));
      const received = await socket.readExactly(4);
      assert.strictEqual(received.toString('utf8'), 'PONG', '全链路收发失败');
      await socket.close();
    } finally {
      transportState.setProxy(null);
    }
    assert.strictEqual(httpAuth.stats.requests, before + 1, 'HTTP 代理没有收到 CONNECT 请求，说明实际是直连');
    assert.strictEqual(
      httpAuth.stats.unauthorized,
      beforeUnauthorized,
      '认证没有被正确携带（代理返回了 407）',
    );
  });

  await check('关闭代理时 net shim 直连，不经过隧道', async () => {
    transportState.setProxy(null);
    assert.strictEqual(transportState.hasProxy(), false);
    const socket = new PromisedNetSockets();
    await socket.connect(echoPort, '127.0.0.1');
    socket.write(Buffer.from('PING', 'utf8'));
    const received = await socket.readExactly(4);
    assert.strictEqual(received.toString('utf8'), 'PONG');
    await socket.close();
  });

  await check('代理不可达时 PromisedNetSockets.connect 会 reject', async () => {
    transportState.setProxy({ enabled: true, kind: 'socks5', host: '127.0.0.1', port: 1 });
    try {
      const socket = new PromisedNetSockets();
      await assert.rejects(socket.connect(echoPort, '127.0.0.1'));
    } finally {
      transportState.setProxy(null);
    }
  });

  // ---------------------------------------------------------------------
  // 6. 配置归一化
  // ---------------------------------------------------------------------
  await check('代理配置归一化：端口字符串转数字、类型校验', () => {
    const resolved = transportState.setProxy({
      enabled: true,
      kind: 'SOCKS5',
      host: ' 10.0.0.1 ',
      port: '1080',
      username: 'u',
    });
    assert.deepStrictEqual(resolved, {
      kind: 'socks5',
      host: '10.0.0.1',
      port: 1080,
      username: 'u',
      password: '',
      timeoutMs: 10000,
    });
    transportState.setProxy(null);
  });

  await check('代理配置非法时抛错（端口越界 / 空地址 / 未知类型）', () => {
    assert.throws(() => transportState.setProxy({ enabled: true, kind: 'socks5', host: '', port: 1080 }));
    assert.throws(() => transportState.setProxy({ enabled: true, kind: 'socks5', host: 'a', port: 70000 }));
    assert.throws(() => transportState.setProxy({ enabled: true, kind: 'quic', host: 'a', port: 1080 }));
    assert.strictEqual(transportState.hasProxy(), false);
  });

  await check('enabled:false 等同关闭代理', () => {
    const resolved = transportState.setProxy({ enabled: false, kind: 'socks5', host: 'a', port: 1 });
    assert.strictEqual(resolved, null);
    assert.strictEqual(transportState.hasProxy(), false);
  });

  // ---------------------------------------------------------------------
  // MTProxy：GramJS 自带实现，绝不能混进自研隧道。
  // 这里守住两条容易悄悄坏掉的约定：
  //   1. mtproxy 写进 tunnel 状态会变成「连代理的代理」，必须明确报错
  //   2. GramJS 的 TCPMTProxy 构造函数里直接调 secret.match()，
  //      所以密钥必须传字符串；传 Buffer 会抛
  //      "proxy.secret.match is not a function"（已实测复现过）
  // ---------------------------------------------------------------------
  await check('MTProxy 不允许写进 tunnel 状态（会变成连代理的代理）', () => {
    assert.throws(
      () => transportState.setProxy({ enabled: true, kind: 'mtproxy', host: 'a', port: 443, secret: 'x' }),
      /MTProxy/,
    );
    assert.strictEqual(transportState.hasProxy(), false);
  });

  await check('WEB 代理不允许写进 tunnel 状态，且报错可读', () => {
    assert.throws(
      () => transportState.setProxy({ enabled: true, kind: 'web', host: 'a', port: 443, secret: 'x' }),
      /WebView/,
    );
    assert.strictEqual(transportState.hasProxy(), false);
  });

  await check('MTProxy 密钥必须传字符串（传 Buffer 会让 GramJS 直接抛错）', () => {
    // 复刻 GramJS TCPMTProxy 构造函数里的判定，验证两种输入的行为差异
    const viaString = (secret) => secret.match(/^[0-9a-f]+$/i) !== null;
    const hex = '0e45caf3bbce0d8d995cfb919fa9d61a';
    assert.strictEqual(viaString(hex), true, '字符串密钥应能被 GramJS 的 .match 处理');

    // 反证：Buffer 没有 .match，这正是我们必须传字符串的原因
    const buf = Buffer.from(hex, 'hex');
    assert.strictEqual(typeof buf.match, 'undefined', 'Buffer 不应有 match 方法');
    let threw = false;
    try {
      buf.match(/^[0-9a-f]+$/i);
    } catch (e) {
      threw = e instanceof TypeError;
    }
    assert.strictEqual(threw, true, '传 Buffer 应触发 TypeError（作为必须传字符串的反证）');
  });

  await check('MTProxy 密钥按 hex / dd 前缀 / base64 解码后都是 16 或 17 字节', () => {
    const hex = '0e45caf3bbce0d8d995cfb919fa9d61a';
    // 与 GramJS 的 initHeader 判定保持一致
    // 注意：别把这个局部函数叫 check，会遮蔽上面的 check 辅助函数
    const decodeSecret = (secret) => {
      let s = Buffer.from(secret, /^[0-9a-f]+$/i.test(secret) ? 'hex' : 'base64');
      const isDD = s.length === 17 && s[0] === 0xdd;
      if (isDD) s = s.slice(1);
      assert.strictEqual(s.length, 16, `密钥解码后应为 16 字节：${secret}`);
      return isDD;
    };
    assert.strictEqual(decodeSecret(hex), false, '32 位 hex 不应被判为 dd 形式');
    assert.strictEqual(decodeSecret(`dd${hex}`), true, 'dd 前缀应被判为 dd 形式');
    const b64 = Buffer.from(new Uint8Array(16).fill(0x7f)).toString('base64');
    assert.strictEqual(decodeSecret(b64), false, 'base64 16 字节应通过');
  });

  await check('ee 拼接串能裁出 16 字节裸密钥（实测可用的那串）', () => {
    // 这是端到端实测过、能从 Telegram DC2 拿回 ResPQ 的真实样本
    const EE = 'ee68d6a83140657a1c7bf8e64d98ce9432786170692e6f7a6f6e2e7275';
    const EXPECTED = '68d6a83140657a1c7bf8e64d98ce9432';

    // 与 src/settings.ts 的 extractBareMtproxySecret 保持同一套判据
    const extract = (secret) => {
      const trimmed = (secret || '').trim();
      const isHex = /^[0-9a-fA-F]+$/.test(trimmed);
      if (!isHex) {
        try {
          const b = Buffer.from(trimmed, 'base64');
          if (b.length >= 17 && b[0] === 0xee) return Buffer.from(b.subarray(1, 17)).toString('hex');
        } catch { /* 非 base64 */ }
        return null;
      }
      if (trimmed.length % 2 !== 0 || trimmed.length < 34) return null;
      const b = Buffer.from(trimmed, 'hex');
      if (b.length >= 17 && b[0] === 0xee) return Buffer.from(b.subarray(1, 17)).toString('hex');
      return null;
    };

    assert.strictEqual(extract(EE), EXPECTED, 'ee 拼接串应裁出中间 16 字节');
    // 裁出来的必须是 GramJS 肯接受的 16 字节形式
    assert.strictEqual(Buffer.from(EXPECTED, 'hex').length, 16, '裁出的密钥应为 16 字节');
    // 反证：原始拼接串解出来是 29 字节，GramJS 必然拒绝
    assert.strictEqual(Buffer.from(EE, 'hex').length, 29, '原始拼接串应为 29 字节（GramJS 不接受）');
    // 合法密钥不该被乱裁
    assert.strictEqual(extract('0e45caf3bbce0d8d995cfb919fa9d61a'), null, '32 位裸密钥不应被裁');
    assert.strictEqual(extract('ddee54ce330e4690cc297d2b031ff3f288'), null, 'dd 形式不应被裁');
  });

  // ---------------------------------------------------------------------
  // 收尾
  // ---------------------------------------------------------------------
  transportState.setProxy(null);
  [echo.server, socks5.server, socks5Auth.server, socks4.server, httpProxy.server, httpAuth.server].forEach((server) => {
    try {
      server.close();
    } catch (e) {
      /* 忽略 */
    }
  });

  const failed = results.filter((item) => !item.ok);
  for (const item of results) {
    console.log(`${item.ok ? '  ok  ' : ' FAIL '} ${item.name}`);
    if (!item.ok) console.log(`       ${item.error && item.error.message}`);
  }
  console.log('');
  console.log(failed.length ? `✗ ${failed.length}/${results.length} 项失败` : `✓ 传输层 ${results.length} 项全部通过`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
