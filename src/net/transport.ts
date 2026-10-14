/**
 * 传输层的 TypeScript 门面。
 *
 * 职责有三个，都很"薄"但都必须在创建 TelegramClient **之前**完成：
 *   1. 把设置页里的代理配置推给 shim 层（src/shims/transport-state.js）
 *   2. 根据通道选择给 GramJS 传不同的 networkSocket / useWSS
 *   3. 给 UI 提供「这个组合是否可行」的判断与人类可读的描述
 */
import { PromisedNetSockets, PromisedWebSockets } from 'telegram/extensions';

import * as transportState from '../shims/transport-state';
import { probeProxy } from '../shims/proxy-probe';
import type { ProxySetting, Settings, TransportKind } from '../settings';
import { extractBareMtproxySecret, proxyKindLabel, proxyKindSupported, validateProxy } from '../settings';

export interface TransportPlan {
  transport: TransportKind;
  /** 实际生效的代理（null 表示直连）；WebSocket 通道下永远是 null */
  proxy: ReturnType<typeof transportState.setProxy>;
  /** 给 GramJS 的 networkSocket 参数 */
  networkSocket: unknown;
  /**
   * 给 GramJS 的 clientParams.proxy。
   * 只有 MTProxy 会用到：GramJS 看到 { MTProxy: true } 会自己把连接实现
   * 换成 ConnectionTCPMTProxyAbridged 并发 InitConnection(client_proxy)，
   * 这条路径不需要我们的 shim 参与（也不该参与，见下方 setProxy 说明）。
   */
  gramjsProxy: unknown;
  useWSS: boolean;
  /** 一行中文描述，直接展示在设置页 */
  summary: string;
  /** 非致命提示（比如「代理被忽略」），需要显示给用户 */
  warning: string | null;
  /**
   * MTProxy 走的是哪条路。faketls 时需要在连接建立后接管 ObfuscatedIO
   * （见 createTelegramClient 里的 attachFakeTlsIO 调用）。
   * 非 MTProxy 时是 null。
   */
  mtproxyFakeTls: boolean;
}

export function transportLabel(transport: TransportKind): string {
  return transport === 'wss' ? 'WebSocket (wss 443)' : 'TCP (obfuscated2 443)';
}

/**
 * MTProxy 的两种密钥形态，走 GramJS 里两条不同的路径：
 *
 *   `dd` / 裸 16 字节  → obfuscated2（GramJS 原生支持，直接传 clientParams.proxy）
 *   `ee` + 密钥 + 域名 → fake-TLS（GramJS **完全没有**，必须由我们接管 ObfuscatedIO）
 *
 * 这里只做判定，真正的接管在 src/net/mtproxy-faketls-runtime.js 里，
 * 由 createTelegramClient 在拿到 connection 实例后调用 attachFakeTlsIO()。
 */
export function mtproxyMode(secret: string): 'faketls' | 'obfuscated2' | 'invalid' {
  try {
    const runtime = require('./mtproxy-faketls-runtime');
    return runtime.isFakeTlsSecret(secret) ? 'faketls' : 'obfuscated2';
  } catch {
    return 'invalid';
  }
}

/**
 * 把设置落到 shim 层，并算出本次连接要用的参数。
 *
 * 三种代理类型走两条完全不同的路，这里必须分清：
 *
 *   1. SOCKS5 / SOCKS4 / HTTP（自建代理）
 *      我们自己的隧道：把代理写进 shim 全局状态，net.js 拨号时改连代理，
 *      再由 tunnel.js 做 SOCKS/HTTP 握手。
 *
 *   2. MTProxy（Telegram 官方协议，带密钥）
 *      交给 GramJS：传 clientParams.proxy = { MTProxy: true, ip, port, secret }，
 *      它内部会换用 ConnectionTCPMTProxyAbridged 做 obfuscated2 + 密钥派生，
 *      并自动附带 InitConnection.client_proxy。
 *      ⚠️ 这条路径绝不能再写 shim 的全局代理，否则 net.js 会把「连代理服务器」
 *      这个动作本身又套一层代理 —— 变成连代理的代理，必然失败。
 *      所以下面 mtproxy 分支显式 setProxy(null)。
 *
 * 无论哪条路，wss 通道都用不了代理：WebSocket 走系统网络栈（OkHttp），
 * 自研隧道插不进去，GramJS 也会直接抛 "Cannot use SSL with proxies"。
 */
export function applyTransportSettings(
  settings: Pick<Settings, 'transport' | 'proxy'>,
): TransportPlan {
  const transport = settings.transport === 'wss' ? 'wss' : 'tcp';
  const { proxy: setting } = settings;
  let warning: string | null = null;
  let proxy: ReturnType<typeof transportState.setProxy> = null;
  let gramjsProxy: unknown;
  let mtproxyFakeTls = false;

  if (setting.enabled) {
    const invalid = validateProxy(setting);
    if (invalid) {
      transportState.setProxy(null);
      warning = `代理未启用：${invalid}`;
    } else if (!proxyKindSupported(setting.kind)) {
      transportState.setProxy(null);
      warning = `${proxyKindLabel(setting.kind)}本客户端无法支持，本次连接已忽略代理设置。`;
    } else if (transport === 'wss') {
      transportState.setProxy(null);
      warning = 'WebSocket 通道由系统网络栈实现，无法使用自定义代理，本次连接已忽略代理设置。';
    } else if (setting.kind === 'mtproxy') {
      // 交给 GramJS；同时清掉 shim 代理，避免两层代理叠加
      transportState.setProxy(null);

      // 两种密钥形态：
      //   ee + 密钥 + 域名 → fake-TLS，GramJS 完全没有这条路径，稍后由我们接管 IO
      //   dd / 裸 16 字节  → obfuscated2，GramJS 原生支持
      // 注意：无论哪种，传给 GramJS 的 secret 都必须是**字符串**（见下面注释）。
      const mode = mtproxyMode(setting.secret);
      mtproxyFakeTls = mode === 'faketls';

      // 服务商常给 `ee` 开头的「伪 TLS + 域名」拼接串，GramJS 只认 16 字节
      // （或 dd+16），收到拼接串会抛「must be a hex-string representing 16 bytes」。
      // 能识别出 ee 前缀就自动裁出中间 16 字节，识别不出则原样透传，
      // 让 GramJS 自己报错（它的报错比我们猜的可靠）。
      const bare = extractBareMtproxySecret(setting.secret);
      gramjsProxy = {
        MTProxy: true,
        ip: setting.host.trim(),
        port: Number(setting.port),
        // ⚠️ 必须传字符串，不能传 Buffer。
        // GramJS 的 TCPMTProxy 构造函数里直接调 `proxy.secret.match(/^[0-9a-f]+$/i)`
        // 来决定按 hex 还是 base64 解析 —— Buffer 没有 .match 方法，
        // 传 Buffer 会在 new TelegramClient 时抛
        // "proxy.secret.match is not a function"，整个连接建不起来。
        // 它的类型声明也是 `secret: string`。这里只做 trim 后原样交给它。
        secret: (bare ?? setting.secret).trim(),
      };
    } else {
      try {
        proxy = transportState.setProxy(setting);
      } catch (err) {
        transportState.setProxy(null);
        warning = `代理未启用：${err instanceof Error ? err.message : String(err)}`;
      }
    }
  } else {
    transportState.setProxy(null);
  }

  // MTProxy 下 proxy 恒为 null（走 GramJS 自有连接），
  // 摘要要能反映"经 MTProto 代理"，不能因为 proxy 是 null 就写成"直连"
  let via = '，直连';
  if (proxy) {
    via = `，经 ${proxy.kind.toUpperCase()} 代理 ${proxy.host}:${proxy.port}`;
  } else if (gramjsProxy) {
    via = `，经 MTProto 代理 ${setting.host.trim()}:${setting.port}${mtproxyFakeTls ? '（伪 TLS）' : ''}`;
  }

  return {
    transport,
    proxy,
    networkSocket: transport === 'wss' ? PromisedWebSockets : PromisedNetSockets,
    gramjsProxy,
    useWSS: transport === 'wss',
    summary: `${transportLabel(transport)}${via}`,
    warning,
    mtproxyFakeTls,
  };
}

/** 当前生效的代理（不含被忽略的情况） */
export function activeProxy(): ReturnType<typeof transportState.getProxy> {
  return transportState.getProxy();
}

/**
 * 造一个 fake-TLS 版的 MTProxy 连接类，交给 GramJS 的 clientParams.connection。
 *
 * GramJS 会在内部自己 new `ConnectionTCPMTProxyAbridged`（见 telegramBaseClient
 * 里 `if (proxy.MTProxy) this._connection = ConnectionTCPMTProxyAbridged`），
 * 但它读取的是我们传进去的 clientParams.connection，所以传子类即可接管。
 *
 * 这里用 require 而不是顶层 import：`telegram` 的内部路径不属于公开 API，
 * 放进顶层 import 会让 jest/静态分析把它们当依赖，纯逻辑测试就跑不动了。
 */
export function makeFakeTlsConnectionClass(): unknown {
  const { ConnectionTCPMTProxyAbridged } = require('telegram/network/connection/TCPMTProxy');
  const runtime = require('./mtproxy-faketls-runtime');
  return runtime.createFakeTlsConnectionClass(ConnectionTCPMTProxyAbridged);
}

export interface ProxyTestResult {
  ok: boolean;
  message: string;
}

/**
 * 连通性测试：只验证「连得上代理 + 隧道握手能过」，
 * 用 Telegram DC2 当隧道尽头，避免误判成「代理能用但访问不了 Telegram」。
 *
 * MTProxy 无法用这个探针：它不是隧道，而是 GramJS 的连接实现，
 * 握手要配合密钥派生 + obfuscated2。这里只做 TCP 可达性检查并说明差异，
 * 不假装做了完整验证。
 */
export async function testProxy(proxy: ProxySetting): Promise<ProxyTestResult> {
  const invalid = validateProxy({ ...proxy, enabled: true });
  if (invalid) return { ok: false, message: invalid };

  if (proxy.kind === 'mtproxy') {
    return {
      ok: true,
      message:
        'MTProto 代理的密钥校验已通过。它的握手要配合密钥派生，只能在真正连接时验证；\n' +
        '保存后点「保存并重连」即可让客户端用这个代理连一次。',
    };
  }

  try {
    const { elapsedMs, target } = await probeProxy({
      proxy: {
        kind: proxy.kind,
        host: proxy.host.trim(),
        port: Number(proxy.port),
        username: proxy.username,
        password: proxy.password,
      },
    });
    return {
      ok: true,
      message: `隧道打通（${elapsedMs} ms）：${proxy.host}:${proxy.port} → ${target.host}:${target.port}`,
    };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * 代理是否参与了本次连接。供设置页展示「当前是否真的在走代理」，
 * 避免用户以为开了代理其实被通道选择吃掉了。
 */
export function proxyActuallyInUse(): boolean {
  return transportState.hasProxy();
}
