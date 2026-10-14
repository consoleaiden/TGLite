/**
 * MTProxy 真实可用性判定（端到端）。
 *
 * 为什么需要它：`MTProxyIO.initHeader()` 不做任何网络 IO，拿它当"握手成功"会得到
 * 假绿灯；而 fake-TLS 的 ClientHello 正确性也无法靠本地断言证明。
 * 唯一可靠的判据是：**让 GramJS 用这个代理连上 Telegram DC 并完成 MTProto
 * 握手（auth key 交换）**。
 *
 * GramJS 在这条路径上的日志会打印
 *     Connection to <host>:<port>/TCPMTProxyAbridged complete!
 * 出现这行 + 之后能收到 Telegram 的错误码（说明请求真的抵达了 DC）
 * → 代理确实在转发 MTProto。
 *
 * 用法：node scripts/probe-mtproxy-live.js
 *   需要外网可达 Telegram DC（443）。CI 里不能跑，只做人工验证。
 */
const path = require('path');
const root = process.cwd();
const M = (p) => require(path.join(root, 'node_modules', 'telegram', p));
const netNs = M('network/index.js');
const exNs = M('extensions/index.js');
const { MTProtoSender, ConnectionTCPObfuscated } = netNs;
const { PromisedNetSockets } = exNs;
const { Logger, LogLevel } = M('extensions/Logger.js');
const { Api } = M('tl/api.js');
const { LAYER } = M('tl/AllTLObjects.js');
const { AuthKey } = M('crypto/AuthKey.js');
// MTProxy 连接类未从 barrel 导出；先加载 barrel 避免循环引用
const { ConnectionTCPMTProxyAbridged } = require(
  path.join(root, 'node_modules', 'telegram', 'network', 'connection', 'TCPMTProxy.js'),
);

const DC4 = '149.154.167.91';

async function probe(tag, { proxy, ip = DC4, port = 443, timeoutMs = 18000 }) {
  const conn = proxy
    ? new ConnectionTCPMTProxyAbridged({ ip, port, dcId: 4, loggers: new Logger(LogLevel.NONE), proxy, socket: PromisedNetSockets })
    : new ConnectionTCPObfuscated({ ip, port, dcId: 4, loggers: new Logger(LogLevel.NONE), socket: PromisedNetSockets });

  const sender = new MTProtoSender(new AuthKey(Buffer.alloc(256)), {
    logger: new Logger(LogLevel.NONE),
    dcId: 4, retries: 1, delay: 0, autoReconnect: false,
    connectTimeout: 12, authKeyCallback: null, updateCallback: () => {},
    isMainSender: true, securityChecks: true,
    // client 传一个最小桩：MTProtoSender.connect 在握手失败时会读
    // this._client._errorHandler，传 null 会抛 TypeError 把真实错误盖掉
    client: { _errorHandler: async () => {} },
  });

  const t0 = Date.now();
  try {
    const ok = await Promise.race([
      sender.connect(conn, false),
      new Promise((_, r) => setTimeout(() => r(new Error('__T__')), timeoutMs)),
    ]);
    if (!ok) throw new Error('连接未完成（MTProto 握手失败）');
    const rtt = Date.now() - t0;
    // 走到这里说明 obfuscated2/MTProxy 隧道的 auth key 交换已经完成，
    // 且我们发出的 InvokeWithLayer 拿到了 Telegram 的应答
    const m = new Api.InvokeWithLayer({ layer: LAYER, query: new Api.ReqPqMulti({}) });
    await Promise.race([
      sender.send(m),
      new Promise((_, r) => setTimeout(() => r(new Error('__T__')), timeoutMs)),
    ]);
    console.log(`✓ 可用   ${tag.padEnd(22)} MTProto 握手完成 ${rtt}ms，服务端已应答`);
    return 'ok';
  } catch (e) {
    let msg = String(e && e.message || e);
    if (msg === '__T__') msg = '超时，无任何响应';
    // Telegram 服务器返回的错误码 = 请求真的抵达了 DC
    const fromServer = /^\d{3}:/.test(msg);
    if (fromServer) {
      console.log(`✓ 可用   ${tag.padEnd(22)} 收到 Telegram 应答「${msg.split(' ')[0]}」${Date.now() - t0}ms —— 代理在转发`);
      return 'ok';
    }
    console.log(`✗ 不可用 ${tag.padEnd(22)} ${msg}  ${Date.now() - t0}ms`);
    return 'dead';
  } finally {
    try { await sender.disconnect(); } catch (_) {}
  }
}

(async () => {
  const mt = (host, secret) => ({ MTProxy: true, ip: host, port: 0, secret });
  const cases = [
    ['基线 直连 DC4',        {}],
    // A：ee + 16 字节密钥 + 域名 的拼接串，密钥是 54ce…88b0，域名 mt.akenai.click
    ['A akenai.tg:853',     { ip: 'akenai.tg', port: 853, proxy: mt('akenai.tg', '54ce330e4690cc297d2b031ff3f288b0') }],
    ['A akenai.tg:443',     { ip: 'akenai.tg', port: 443, proxy: mt('akenai.tg', '54ce330e4690cc297d2b031ff3f288b0') }],
    // B：22 字符 base64 = 16 字节裸密钥（开头 ee 是巧合，不是 ee 格式）
    ['B honar:8443',        { ip: 'honar.saheledarya.co.uk', port: 8443, proxy: mt('honar.saheledarya.co.uk', 'eeNEgYdJvXrFGRMCIMJdCQ') }],
    ['C a03.lovely.lat:443',{ ip: 'a03.lovely.lat', port: 443, proxy: mt('a03.lovely.lat', '68d6a83140657a1c7bf8e64d98ce9432') }],
  ];
  for (const [, opts] of cases) {
    if (opts.proxy) opts.proxy.port = opts.port;
  }

  console.log(`=== MTProxy 端到端可用性判定（DC4 = ${DC4}）===\n`);
  const results = [];
  for (const [tag, opts] of cases) results.push([tag, await probe(tag, opts)]);
  console.log('\n结论：');
  for (const [tag, r] of results) {
    console.log(`  ${r === 'ok' ? '✓ 可用  ' : '✗ 不可用'}  ${tag}`);
  }
  process.exit(0);
})();
