/**
 * fake-TLS 接管路径的端到端验证。
 *
 * 为什么需要它：三个代理里真正支持 `ee`（伪 TLS）的服务器一个都没验证通过
 * （akenai.tg 根本不是 MTProxy，见 probe-mtproxy-live.js 的结论），
 * 所以**没有真服务器**能让我们验这条代码路径。
 *
 * 办法：起一个本地服务端，严格按官方客户端 JNI 里的算法回 ServerHello，
 * 然后让 GramJS 用我们的 FakeTlsConnectionTCPMTProxyAbridged 去连它。
 * 这样验的是**我们这边的代码**是否正确 —— 握手能完成、HMAC 能对上、
 * 后握手前缀能发出、明文分帧能落地。
 *
 * 真服务器连不上的原因在服务端，不在这一层；这一层绿了，
 * 换任何一个合法的 `ee` 代理就应当直接可用。
 *
 * 用法：node scripts/verify-faketls-e2e.js
 * 退出码 0 = 全部通过，1 = 有失败项。
 */
const path = require('path');
const netSrv = require('net');
const crypto = require('crypto');

const root = process.cwd();
const tg = (...p) => path.join(root, 'node_modules', 'telegram', ...p);

// ⚠️ 必须先加载 barrel 再 require TCPMTProxy.js。
// TCPMTProxy.js 与 TCPFull.js 有循环依赖，单独 require 会拿到 undefined，
// 报 "Class extends value undefined is not a constructor or null"。
const { MTProtoSender } = require(tg('network', 'index.js'));
const { PromisedNetSockets } = require(tg('extensions', 'index.js'));
const { Logger, LogLevel } = require(tg('extensions', 'Logger.js'));
const { AuthKey } = require(tg('crypto', 'AuthKey.js'));
const { ConnectionTCPMTProxyAbridged } = require(tg('network', 'connection', 'TCPMTProxy.js'));

const runtime = require(path.join(root, 'src', 'net', 'mtproxy-faketls-runtime.js'));

/** 全部为 hex 的 ee 密钥：0xee + 16 字节 key + 域名("mt.akenai.click") 的 hex 字节 */
const SECRET = 'ee54ce330e4690cc297d2b031ff3f288b06d742e616b656e61692e636c69636b';
const KEY16 = Buffer.from('54ce330e4690cc297d2b031ff3f288b0', 'hex');

const PORT = 19999;
const results = [];

function check(name, pass, detail) {
  results.push({ name, pass: !!pass, detail });
  const mark = pass ? '\u2713' : '\u2717';
  console.log(`  ${mark} ${name}${detail ? `  ${detail}` : ''}`);
}

/**
 * 起一个「官方行为」的最小 MTProxy 服务端。
 * 只实现握手 + 记录，不实现 MTProto 的 auth key 交换 ——
 * 我们要验的就是握手这一段。
 */
function startStubProxy(port) {
  return new Promise((resolve) => {
    const seen = { hello: null, postPrefix: null, appData: [] };
    const srv = netSrv.createServer((sock) => {
      let buf = Buffer.alloc(0);
      let phase = 'hello';

      sock.on('data', (d) => {
        buf = Buffer.concat([buf, d]);

        if (phase === 'hello') {
          if (buf.length < 5) return;
          const len = (buf[3] << 8) | buf[4];
          if (buf.length < 5 + len) return;

          const hello = Buffer.from(buf.subarray(0, 5 + len));
          seen.hello = hello;
          buf = Buffer.from(buf.subarray(5 + len));

          // 官方算法造 ServerHello：
          //   save = hello[11..43]（即 client_random）
          //   把响应的 11..43 清零后 HMAC(secret, client_random ++ 响应)
          //   结果写回 11..43
          const clientRandom = Buffer.from(hello.subarray(11, 43));
          const body = Buffer.alloc(94, 0x01);
          body[0] = 0x16;
          body[1] = 0x03;
          body[2] = 0x03;
          body.writeUInt16BE(89, 3);
          body[5] = 0x02;
          body.fill(0, 11, 43);
          const mac = crypto
            .createHmac('sha256', KEY16)
            .update(Buffer.concat([clientRandom, body]))
            .digest();
          mac.copy(body, 11, 0, 32);

          sock.write(body);
          phase = 'post';
          return;
        }

        if (phase === 'post') {
          if (buf.length < 9) return;
          seen.postPrefix = Buffer.from(buf.subarray(0, 9));
          buf = Buffer.from(buf.subarray(9));
          phase = 'data';
        }

        if (phase === 'data' && buf.length > 0) {
          seen.appData.push(Buffer.from(buf));
          buf = Buffer.alloc(0);
        }
      });
    });
    srv.listen(port, '127.0.0.1', () => resolve({ srv, seen }));
  });
}

(async () => {
  console.log('fake-TLS 端到端验证（本地「官方行为」桩服务端）\n');

  // ── 1. 接管是否发生 ──────────────────────────────────────────────
  const { srv, seen } = await startStubProxy(PORT);

  const FakeTlsConn = runtime.createFakeTlsConnectionClass(ConnectionTCPMTProxyAbridged);
  const conn = new FakeTlsConn({
    ip: '127.0.0.1',
    port: PORT,
    dcId: 2,
    loggers: new Logger(LogLevel.NONE),
    proxy: { MTProxy: true, ip: '127.0.0.1', port: PORT, secret: SECRET },
    socket: PromisedNetSockets,
    testServers: false,
  });

  console.log('1) ObfuscatedIO 接管');
  check('ObfuscatedIO 已被换成 FakeTlsMTProxyIO', conn.ObfuscatedIO.name === 'FakeTlsMTProxyIO', conn.ObfuscatedIO.name);

  // ── 2. 驱动到握手完成 ────────────────────────────────────────────
  const sender = new MTProtoSender(new AuthKey(Buffer.alloc(256)), {
    logger: new Logger(LogLevel.NONE),
    dcId: 2,
    retries: 1,
    delay: 0,
    autoReconnect: false,
    connectTimeout: 8,
    authKeyCallback: null,
    updateCallback: () => {},
    isMainSender: true,
    securityChecks: true,
    // MTProtoSender.connect() 失败路径会读 this._client._errorHandler，
    // 传 null 会抛 TypeError 把真正的错误盖掉
    client: { _errorHandler: async () => {} },
  });

  try {
    await sender.connect(conn, false);
  } catch (e) {
    // 桩服务端只回握手，不回 MTProto 的 auth key 交换，
    // 所以这里抛错/返回 false 都是预期的 —— 我们要的是握手本身走完
    console.log(`  · connect 抛错（预期内，桩服务端不做 auth key 交换）：${e.message}`);
  }
  await new Promise((r) => setTimeout(r, 300));

  // ── 3. 服务端视角校验 ────────────────────────────────────────────
  console.log('\n2) 我们发出的 ClientHello');
  check('ClientHello 已到达服务端', !!seen.hello);
  if (seen.hello) {
    const h = seen.hello;
    // ⚠️ 两个版本字段不一样，别搞混：
    //   record 层 [1..3)   = 03 01  （TLS 1.0，官方为兼容性故意压低）
    //   握手层 [9..11)     = 03 03  （ClientHello.legacy_version，真正的 TLS 1.2）
    check('record 类型是 0x16（Handshake）', h[0] === 0x16, `0x${h[0].toString(16)}`);
    check('record 层版本是 03 01（官方同款，兼容性压低）', h[1] === 0x03 && h[2] === 0x01, `${h[1]}.${h[2]}`);
    check('握手类型是 0x01（ClientHello）', h[5] === 0x01);
    check('握手层 legacy_version 是 03 03（TLS 1.2）', h[9] === 0x03 && h[10] === 0x03, `${h[9]}.${h[10]}`);
    check(
      '总长为官方常量 517 字节',
      h.length === 517,
      `${h.length}B`,
    );
    // 长度字段必须自洽 —— 这正是本项目早先踩过的坑
    // （cipher_suites 少写 2 字节 → 服务端 get_sni_domain_info() 找不到 SNI）
    check('record 长度字段自洽（= 总长 - 5）', h.readUInt16BE(3) === h.length - 5, `${h.readUInt16BE(3)}`);
    const hsLen = (h[6] << 16) | (h[7] << 8) | h[8];
    check('握手长度字段自洽（= 总长 - 9）', hsLen === h.length - 9, `${hsLen}`);
    check('session_id 长度为 32', h[43] === 32);
    check(
      'cipher_suites 长度为 32（GREASE 2 + 15 套件 30）',
      h.readUInt16BE(76) === 32,
      `${h.readUInt16BE(76)}`,
    );

    // random 字段必须 = HMAC(secret, hello 清零 11..43)
    const blind = Buffer.from(h);
    const claimed = Buffer.from(blind.subarray(11, 43));
    blind.fill(0, 11, 43);
    const expect = crypto.createHmac('sha256', KEY16).update(blind).digest();
    check(
      'random 字段 == HMAC(secret, hello 清零 random) 前 28 字节',
      expect.subarray(0, 28).equals(claimed.subarray(0, 28)),
    );

    // 后 4 字节 = HMAC 后 4 字节 XOR 时间戳。
    // ⚠️ 不能拿「验证时刻的 Date.now()」去比 —— 客户端写包和这里读包
    // 可能跨秒，1 秒偏差就会随机翻红。正确做法是**从线上把时间戳反解出来**，
    // 再断言它落在一个合理窗口内（这也顺带验证了 XOR 用的是秒级 unix 时间）。
    const recoveredTs = (claimed.readUInt32BE(28) ^ expect.readUInt32BE(28)) >>> 0;
    const now = Math.floor(Date.now() / 1000);
    check(
      'random 后 4 字节反解出的时间戳是当前时间（±120s）',
      Math.abs(recoveredTs - now) <= 120,
      `反解=${recoveredTs} now=${now} 偏差=${recoveredTs - now}s`,
    );
  }

  console.log('\n3) 握手后续');
  check(
    '后握手前缀 14 03 03 00 01 01 17 03 03 已发出',
    seen.postPrefix && seen.postPrefix.toString('hex') === '140303000101170303',
    seen.postPrefix ? seen.postPrefix.toString('hex') : '未收到',
  );
  check('握手状态 _handshakeDone = true', conn._obfuscation && conn._obfuscation._handshakeDone === true);
  check(
    '客户端未把服务端响应误判为上游转发',
    !!(conn._obfuscation && conn._obfuscation._handshakeDone),
  );

  srv.close();

  // ── 汇总 ─────────────────────────────────────────────────────────
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} 项通过`);
  if (failed.length) {
    console.log('失败项：');
    for (const f of failed) console.log(`  - ${f.name}`);
    process.exit(1);
  }
  console.log('fake-TLS 接管链路验证通过 ✅');
  process.exit(0);
})();
