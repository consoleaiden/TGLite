#!/usr/bin/env node
/**
 * polyfill 层自检脚本（无需 Android SDK / 模拟器，2 秒跑完）。
 *
 * 这里验证的是本项目最容易出错、也最难在真机上排查的三件事：
 *   1. src/shims/crypto.js 的 SHA / HMAC / PBKDF2 是否与 Node 原生实现逐字节一致
 *   2. GramJS 的 AES-CTR（MTProto 加密的底座）能否正常加解密
 *   3. src/shims/net.js 的 TCP 适配层能否被 GramJS 的 PromisedNetSockets 正常驱动
 *
 * CI 里在 Gradle 之前跑一遍，能在几十秒内拦住 polyfill 回归，
 * 而不是等到打出一个装上去就崩的 APK。
 *
 * 用法：node scripts/verify-shims.js
 */
const Module = require('module');
const path = require('path');
const nodeCrypto = require('crypto');
const assert = require('assert');

const projectRoot = path.resolve(__dirname, '..');
const shimPath = (name) => path.join(projectRoot, 'src', 'shims', name);

// ---------------------------------------------------------------------------
// 1. 让 Node 也用我们的 shim 取代 Node 内置模块，从而复用同一套实现做对照
// ---------------------------------------------------------------------------
const fakeTcp = {
  connections: [],
  createConnection(options, onConnect) {
    const socket = {
      options,
      written: [],
      destroyed: false,
      listeners: {},
      on(event, listener) {
        (this.listeners[event] || (this.listeners[event] = [])).push(listener);
        return this;
      },
      once(event, listener) {
        const wrapper = (...args) => {
          this.listeners[event] = (this.listeners[event] || []).filter((l) => l !== wrapper);
          listener(...args);
        };
        return this.on(event, wrapper);
      },
      emit(event, ...args) {
        (this.listeners[event] || []).slice().forEach((listener) => listener(...args));
      },
      write(data) {
        this.written.push(Buffer.from(data));
      },
      end() {
        this.destroyed = true;
      },
      destroy() {
        this.destroyed = true;
        this.emit('close', false);
      },
      setNoDelay() {},
      setKeepAlive() {},
    };
    fakeTcp.connections.push(socket);
    // 模拟异步建连
    setTimeout(() => onConnect && onConnect(), 0);
    return socket;
  },
};

const overrides = {
  net: shimPath('net.js'),
  crypto: shimPath('crypto.js'),
  fs: shimPath('fs.js'),
  os: shimPath('os.js'),
  util: shimPath('util.js'),
  events: shimPath('events.js'),
  store2: shimPath('store2.js'),
  'node-localstorage': shimPath('node-localstorage.js'),
  websocket: shimPath('websocket.js'),
  socks: shimPath('socks.js'),
  'react-native-tcp-socket': null, // 用 fakeTcp 顶替
};

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'react-native-tcp-socket') return fakeTcp;
  if (Object.prototype.hasOwnProperty.call(overrides, request)) {
    return originalLoad.call(this, overrides[request], parent, isMain);
  }
  return originalLoad.call(this, request, parent, isMain);
};

// 安装 WebCrypto（与 src/polyfills.js 中的做法一致）
const cryptoShim = require(shimPath('crypto.js'));
const nativeRandomFill = (array) => nodeCrypto.randomFillSync(array);
Object.defineProperty(global, 'crypto', {
  configurable: true,
  writable: true,
  value: {
    getRandomValues: nativeRandomFill,
    randomBytes: cryptoShim.randomBytes,
    subtle: cryptoShim.subtle,
  },
});
global.self = global;

const results = [];
function check(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (err) {
    results.push({ name, ok: false, error: err });
  }
}

async function checkAsync(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
  } catch (err) {
    results.push({ name, ok: false, error: err });
  }
}

// ---------------------------------------------------------------------------
// 2. 哈希 / PBKDF2 与 Node 原生实现对照
// ---------------------------------------------------------------------------
const gramCrypto = require(path.join(projectRoot, 'node_modules', 'telegram', 'crypto', 'crypto.js'));

async function main() {
  await checkAsync('SHA-256 与 Node 原生一致', async () => {
    const payload = Buffer.from('tg-lite mtproto 校验'.repeat(8), 'utf8');
    const hash = gramCrypto.createHash('sha256');
    hash.update(payload);
    const actual = Buffer.from(await hash.digest());
    const expected = nodeCrypto.createHash('sha256').update(payload).digest();
    assert.deepStrictEqual(actual, expected, 'SHA-256 结果不一致');
  });

  await checkAsync('SHA-1 与 Node 原生一致', async () => {
    const payload = Buffer.from('0102030405060708', 'hex');
    const hash = gramCrypto.createHash('sha1');
    hash.update(payload);
    const actual = Buffer.from(await hash.digest());
    const expected = nodeCrypto.createHash('sha1').update(payload).digest();
    assert.deepStrictEqual(actual, expected, 'SHA-1 结果不一致');
  });

  await checkAsync('PBKDF2-HMAC-SHA512 与 Node 原生一致（两步验证密码靠它）', async () => {
    const password = Buffer.from('correct horse battery staple', 'utf8');
    const salt = Buffer.from('tglite-salt');
    const actual = Buffer.from(await gramCrypto.pbkdf2Sync(password, salt, 1000));
    const expected = nodeCrypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512');
    assert.strictEqual(actual.length, 64, 'PBKDF2 输出长度应为 64 字节');
    assert.deepStrictEqual(actual, expected, 'PBKDF2 结果不一致');
  });

  check('randomBytes 返回指定长度的随机字节', () => {
    // 注意：GramJS 自己的 randomBytes 返回的是 Uint8Array，不是 Buffer
    const bytes = Buffer.from(gramCrypto.randomBytes(64));
    assert.strictEqual(bytes.length, 64);
    assert.ok(!bytes.equals(Buffer.alloc(64)), '不应该返回全零');
  });

  // ---------------------------------------------------------------------------
  // 3. AES-CTR（MTProto 的 obfuscated2 与消息加密底座）
  // ---------------------------------------------------------------------------
  check('AES-CTR 加密 -> 解密可还原', () => {
    const key = cryptoShim.randomBytes(32);
    const iv = cryptoShim.randomBytes(16);
    const plain = Buffer.from('MTProto payload for tg-lite integration check', 'utf8');

    const encrypted = Buffer.from(gramCrypto.createCipheriv('aes-256-ctr', key, iv).encrypt(plain));
    assert.ok(!encrypted.equals(plain), '密文不应等于明文');

    const decrypted = Buffer.from(gramCrypto.createDecipheriv('aes-256-ctr', key, iv).encrypt(encrypted));
    assert.deepStrictEqual(decrypted, plain, '解密结果与原文不一致');
  });

  // ---------------------------------------------------------------------------
  // 4. TCP 适配层：用 GramJS 自己的 PromisedNetSockets 驱动我们的 net shim
  // ---------------------------------------------------------------------------
  const { PromisedNetSockets } = require(
    path.join(projectRoot, 'node_modules', 'telegram', 'extensions', 'PromisedNetSockets.js'),
  );

  await checkAsync('PromisedNetSockets + net shim 可以完成一次收发', async () => {
    const socket = new PromisedNetSockets();
    await socket.connect(443, '149.154.167.51');

    const fake = fakeTcp.connections[fakeTcp.connections.length - 1];
    assert.ok(fake, '未创建底层 socket');
    assert.strictEqual(fake.options.port, 443);
    assert.strictEqual(fake.options.host, '149.154.167.51');

    // 服务端分两片推送，readExactly 应该能凑齐
    const reading = socket.readExactly(6);
    fake.emit('data', Buffer.from([1, 2, 3]));
    fake.emit('data', Buffer.from([4, 5, 6]));
    const received = await reading;
    assert.deepStrictEqual([...received], [1, 2, 3, 4, 5, 6], 'readExactly 拼包结果不对');

    // 客户端写入应该原样透传到底层 socket
    socket.write(Buffer.from([0xaa, 0xbb]));
    assert.deepStrictEqual([...fake.written[0]], [0xaa, 0xbb], '写入内容未透传');

    await socket.close();
    assert.strictEqual(fake.destroyed, true, 'close 未销毁底层 socket');
  });

  await checkAsync('底层连接报错时 connect 会 reject', async () => {
    const socket = new PromisedNetSockets();
    const pending = socket.connect(443, '127.0.0.1');
    const fake = fakeTcp.connections[fakeTcp.connections.length - 1];
    fake.destroy(); // 触发 close
    fake.emit('error', new Error('boom'));
    await assert.rejects(pending, /boom/);
  });

  // ---------------------------------------------------------------------------
  // 5. 其余 shim 至少要做到「可加载 + 关键成员存在」
  // ---------------------------------------------------------------------------
  check('util shim 提供 inspect.custom（GramJS 的 inspect 依赖它）', () => {
    const utilShim = require(shimPath('util.js'));
    assert.strictEqual(typeof utilShim.inspect, 'function');
    assert.ok(utilShim.inspect.custom, '缺少 inspect.custom');
  });

  check('os shim 提供 GramJS 需要的 platform()/release()/type()', () => {
    const osShim = require(shimPath('os.js'));
    assert.strictEqual(typeof osShim.platform(), 'string');
    assert.strictEqual(typeof osShim.release(), 'string');
    assert.strictEqual(typeof osShim.type(), 'string');
  });

  check('events shim 实现基本的 on/emit/off', () => {
    const EventEmitter = require(shimPath('events.js'));
    const emitter = new EventEmitter();
    const seen = [];
    const listener = (value) => seen.push(value);
    emitter.on('x', listener);
    emitter.emit('x', 1);
    emitter.off('x', listener);
    emitter.emit('x', 2);
    assert.deepStrictEqual(seen, [1]);
  });

  // ---------------------------------------------------------------------------
  // 输出
  // ---------------------------------------------------------------------------
  const failed = results.filter((item) => !item.ok);
  for (const item of results) {
    console.log(`${item.ok ? '  ok  ' : ' FAIL '} ${item.name}`);
    if (!item.ok) console.log(`       ${item.error && item.error.message}`);
  }
  console.log('');
  console.log(failed.length ? `✗ ${failed.length}/${results.length} 项失败` : `✓ ${results.length} 项全部通过`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
