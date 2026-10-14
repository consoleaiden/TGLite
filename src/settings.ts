import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

export const SETTINGS_KEY = '@tglite/settings_v1';

/** 传输通道：TCP = obfuscated2 裸 TCP；wss = MTProto over WebSocket（备用通道） */
export type TransportKind = 'tcp' | 'wss';

/**
 * 代理类型。对齐官方 App「代理信息」页的三选一：
 *   socks5 / socks4 / http —— 通用自建代理，我们自己在传输层做隧道
 *   mtproxy                —— Telegram 官方的 MTProxy 协议（带 secret），
 *                             由 GramJS 的 ConnectionTCPMTProxyAbridged 实现
 *   web                    —— 官方那种「私有 WebView 跑 HTTPS 页面」的代理，
 *                             需要 16 字节 MTPROXY 密钥 + 系统 WebView，RN 里做不到
 */
export type ProxyKind = 'socks5' | 'socks4' | 'http' | 'mtproxy' | 'web';

export interface KeywordSetting {
  enabled: boolean;
  /** 输入框里的原始文本，保存时原样存下来，方便用户回来继续改 */
  raw: string;
}

export interface ProxySetting {
  enabled: boolean;
  kind: ProxyKind;
  host: string;
  /** 用字符串保存，方便直接双向绑定 TextInput */
  port: string;
  username: string;
  password: string;
  /** MTProxy / WEB 代理的密钥（hex 或 base64），官方界面上叫「密钥」 */
  secret: string;
}

export interface Settings {
  ad: KeywordSetting;
  minor: KeywordSetting;
  transport: TransportKind;
  proxy: ProxySetting;
}

export const DEFAULT_SETTINGS: Settings = {
  ad: { enabled: false, raw: '' },
  minor: { enabled: false, raw: '' },
  transport: 'tcp',
  proxy: {
    enabled: false,
    kind: 'socks5',
    host: '',
    port: '',
    username: '',
    password: '',
    secret: '',
  },
};

interface SettingsState extends Settings {
  hydrated: boolean;

  hydrate: () => Promise<void>;
  setAd: (patch: Partial<KeywordSetting>) => void;
  setMinor: (patch: Partial<KeywordSetting>) => void;
  setTransport: (transport: TransportKind) => void;
  setProxy: (patch: Partial<ProxySetting>) => void;
  resetNetwork: () => void;
}

/** 已知的代理类型；旧数据或手改 JSON 里的未知值一律回落到 socks5 */
const PROXY_KINDS: ProxyKind[] = ['socks5', 'socks4', 'http', 'mtproxy', 'web'];

function normalizeProxyKind(value: unknown): ProxyKind {
  const text = typeof value === 'string' ? value.toLowerCase() : '';
  return (PROXY_KINDS as string[]).includes(text) ? (text as ProxyKind) : 'socks5';
}

/** 把持久化数据补齐成完整结构（旧版本 / 手改过的 JSON 都能吃下） */
function normalize(raw: unknown): Settings {
  const parsed = (raw || {}) as Partial<Settings>;
  const rawProxy = (parsed.proxy || {}) as Partial<ProxySetting>;
  return {
    ad: { ...DEFAULT_SETTINGS.ad, ...(parsed.ad || {}) },
    minor: { ...DEFAULT_SETTINGS.minor, ...(parsed.minor || {}) },
    transport: parsed.transport === 'wss' ? 'wss' : 'tcp',
    proxy: {
      ...DEFAULT_SETTINGS.proxy,
      ...rawProxy,
      // 单独兜一下：旧版本没有 secret 字段，未知 kind 也要收敛到合法值，
      // 否则界面会根据 kind 渲染出奇怪的组合
      kind: normalizeProxyKind(rawProxy.kind),
      secret: typeof rawProxy.secret === 'string' ? rawProxy.secret : '',
    },
  };
}

function persist(settings: Settings): void {
  // 设置改动不需要阻塞 UI，失败也不影响本次会话使用
  AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)).catch(() => {});
}

let hydratedOnce = false;

export const useSettingsStore = create<SettingsState>((set, get) => {
  /** 任何 setter 都走这里：更新内存 -> 落盘 */
  const commit = (patch: Partial<Settings>) => {
    set(patch);
    const next = get();
    persist({
      ad: next.ad,
      minor: next.minor,
      transport: next.transport,
      proxy: next.proxy,
    });
  };

  return {
    ...DEFAULT_SETTINGS,
    hydrated: false,

    hydrate: async () => {
      if (hydratedOnce) {
        set({ hydrated: true });
        return;
      }
      hydratedOnce = true;
      try {
        const stored = await AsyncStorage.getItem(SETTINGS_KEY);
        const settings = normalize(stored ? JSON.parse(stored) : null);
        set({ ...settings, hydrated: true });
      } catch {
        set({ hydrated: true });
      }
    },

    setAd: (patch) => commit({ ad: { ...get().ad, ...patch } }),
    setMinor: (patch) => commit({ minor: { ...get().minor, ...patch } }),
    setTransport: (transport) => commit({ transport }),
    setProxy: (patch) => commit({ proxy: { ...get().proxy, ...patch } }),

    resetNetwork: () =>
      commit({
        transport: DEFAULT_SETTINGS.transport,
        proxy: { ...DEFAULT_SETTINGS.proxy },
      }),
  };
});

/** 非 React 环境（比如 telegram.ts / boot.ts）读取当前设置 */
export function currentSettings(): Settings {
  const state = useSettingsStore.getState();
  return {
    ad: state.ad,
    minor: state.minor,
    transport: state.transport,
    proxy: state.proxy,
  };
}

/**
 * WebSocket 通道走的是系统网络栈（OkHttp），没法套我们自研的代理隧道。
 * 这个组合必须提前拦下，否则用户会以为代理生效了其实没生效。
 *
 * 例外：MTProxy 不是「隧道」而是 GramJS 自带的一种连接实现
 * （ConnectionTCPMTProxyAbridged），所以 wss + mtproxy 同样不行，
 * 判定逻辑与自建代理一致 —— 都要 TCP 通道。
 */
export function proxySupportsTransport(proxy: ProxySetting, transport: TransportKind): boolean {
  if (!proxy.enabled) return true;
  return transport !== 'wss';
}

/** 哪些代理类型需要「密钥」而不是用户名/密码 */
export function proxyNeedsSecret(kind: ProxyKind): boolean {
  return kind === 'mtproxy' || kind === 'web';
}

/**
 * WEB 代理在 RN 里做不到。原因写在界面上，不要假装能用。
 *
 * 官方那种 WEB 代理的原理是：用一个私有的 WebView 去加载代理服务器上的
 * HTTPS 页面，再由该页面用 16 字节 MTPROXY 密钥把流量转发出去。
 * 我们这边：
 *   · 没有那个私有 WebView 环境（RN 的 WebView 无法承载这种流量转发）
 *   · 即便有，也要实现页面侧那套密钥协商，等于重写一遍官方客户端
 * 所以这里直接标为不支持，避免用户配了半天发现根本连不上。
 */
export function proxyKindSupported(kind: ProxyKind): boolean {
  return kind !== 'web';
}

/**
 * 校验代理配置，返回中文错误信息；通过则返回 null。
 * 按类型分支：MTProxy 要求密钥，SOCKS5/HTTP 只看地址端口。
 */
export function validateProxy(proxy: ProxySetting): string | null {
  if (!proxy.enabled) return null;

  if (!proxyKindSupported(proxy.kind)) {
    return 'WEB 代理需要私有 WebView 环境，本客户端无法支持，请改用 SOCKS5 或 MTProto 代理。';
  }

  const host = proxy.host.trim();
  if (!host) return '请填写代理服务器地址。';

  // WEB 代理在官方界面里没有端口字段；其余类型都必须有
  if (proxy.kind !== 'web') {
    const port = Number(proxy.port);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      return '代理端口必须是 1 - 65535 之间的整数。';
    }
  }

  if (proxyNeedsSecret(proxy.kind)) {
    const secretError = validateProxySecret(proxy.secret, proxy.kind);
    if (secretError) return secretError;
  }

  if (proxy.kind === 'http' && !/^[A-Za-z0-9._\-:[\]@]+$/.test(host)) {
    return 'HTTP 代理地址含有非法字符。';
  }
  return null;
}

/**
 * MTProxy 密钥校验。
 *
 * 官方文档里密钥有两种写法，都要接受：
 *   · 32 位十六进制（16 字节），可选带 `dd` 前缀表示「需要伪造 TLS」
 *     —— 也就是 34 位 hex，GramJS 的 initHeader 专门判了
 *     `length == 17 && [0] == 0xdd` 这种 17 字节形式
 *   · base64 编码的 16 字节
 * 所以这里不做「必须是 32 位」的死校验，只要求长度合理且是合法 hex/base64，
 * 真正的格式问题交给 GramJS 在连接时报错（它自己会判 byte 长度）。
 */
/**
 * 把 `ee` 开头的「伪 TLS + 域名」密钥拆出可用的 16 字节裸密钥。
 *
 * 现实里很多机场/代理服务商给的是这种拼接串（实测多个样本都是）：
 *   ee | <16 字节密钥> | [后面跟若干字节的域名/填充]
 * GramJS 只认 16 字节或 `dd`+16 字节，收到这种串会直接抛
 * 「MTProxy secret must be a hex-string representing 16 bytes」。
 *
 * 这里做**保守**处理：只在能明确识别出 `ee` 前缀、且总长度 ≥ 17 字节时才裁，
 * 返回中间的 16 字节 hex。识别不出来就返回 null，交给校验逻辑去报错，
 * 绝不猜——猜错会得到一个"格式合法但连不上"的假成功。
 *
 * 注意：裁出来的裸密钥**没有 SNI 伪装**，抗阻断能力弱于 `dd` 形式。
 * 所以这只是让用户在只拿到拼接串时有个能用起来的办法，
 * 更推荐向服务商索取 32 位十六进制的原始密钥。
 */
export function extractBareMtproxySecret(secret: string): string | null {
  const trimmed = (secret || '').trim();
  if (!/^[0-9a-fA-F]+$/.test(trimmed)) {
    // base64 形式：解出来看首字节是不是 ee
    try {
      const bytes = Buffer.from(trimmed, 'base64');
      if (bytes.length >= 17 && bytes[0] === 0xee) {
        // 注意：Buffer.slice()/subarray() 的返回类型被声明成 Uint8Array，
        // 会丢掉 Buffer.toString(encoding) 那个重载，tsc 报 "Expected 0 arguments"。
        // 所以这里用 Buffer.from(子区间) 显式拿回 Buffer 类型。
        return Buffer.from(bytes.subarray(1, 17)).toString('hex');
      }
    } catch {
      /* 不是合法 base64，交给调用方报错 */
    }
    return null;
  }
  // hex 形式：必须偶数长度才能解
  if (trimmed.length % 2 !== 0 || trimmed.length < 34) return null;
  const bytes = Buffer.from(trimmed, 'hex');
  if (bytes.length >= 17 && bytes[0] === 0xee) {
    return Buffer.from(bytes.subarray(1, 17)).toString('hex');
  }
  return null;
}

export function validateProxySecret(secret: string, kind: ProxyKind = 'mtproxy'): string | null {
  const trimmed = (secret || '').trim();
  const label = kind === 'web' ? '密钥' : '密钥';
  if (!trimmed) {
    return kind === 'mtproxy'
      ? '请在代理服务器提供的链接里找到密钥（dd 开头或 32 位十六进制），填到「密钥」里。'
      : `请填写${label}。`;
  }
  const isHex = /^[0-9a-fA-F]+$/.test(trimmed);
  if (isHex) {
    // dd + 32 位 = 34；纯 32 位 = 32。允许两者。
    if (trimmed.length === 32 || trimmed.length === 34) return null;

    // `ee` 开头的「伪 TLS + 域名」拼接串。实测多个服务商都发这种格式，
    // 连接时会由 extractBareMtproxySecret 自动裁出 16 字节裸密钥，
    // 所以这里放行，不拦用户。
    if (extractBareMtproxySecret(trimmed)) return null;

    return '密钥格式不对：十六进制密钥应为 32 位（或 dd 开头的 34 位、ee 开头的拼接串）。';
  }
  // 非 hex 就按 base64 看：16 字节 base64 通常是 24 字符（含 1 个 '='）
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(trimmed)) {
    return '密钥格式不对：应为十六进制或 base64 字符串。';
  }
  try {
    const bytes = Buffer.from(trimmed, 'base64');
    if (bytes.length !== 16 && bytes.length !== 17) {
      // ee 开头的 base64 拼接串也放行（同样走自动裁剪）
      if (extractBareMtproxySecret(trimmed)) return null;
      return '密钥长度不对：解码后应为 16 字节。';
    }
  } catch {
    return '密钥不是合法的 base64 字符串。';
  }
  return null;
}

/** 人类可读的代理类型名，界面与提示共用一处，避免各写一份 */
export function proxyKindLabel(kind: ProxyKind): string {
  switch (kind) {
    case 'mtproxy':
      return 'MTProto 代理';
    case 'web':
      return 'WEB 代理';
    case 'socks4':
      return 'SOCKS4';
    case 'http':
      return 'HTTP';
    default:
      return 'SOCKS5';
  }
}

/** 一串「地址:端口」，MTProxy 下官方也是 host:port 的写法 */
export function describeProxyTarget(proxy: ProxySetting): string {
  const host = (proxy.host || '').trim();
  if (!host) return '(未填写)';
  // WEB 代理在官方界面里没有端口，别拼出一个 ":undefined"
  if (proxy.kind === 'web') return host;
  return `${host}:${(proxy.port || '').trim()}`;
}

/**
 * 给「登录前」的网络状态算一句话描述。
 *
 * 为什么需要它：登录页不能用 proxyActuallyInUse()——
 * 那个读的是传输层 shim 的实时状态，而 shim 只在 createClient() 里被写入，
 * 登录前永远是 false，会让人以为配了代理也没生效。
 * 登录页真正要回答的是「这份配置在建连时会不会走代理」，
 * 那就应该只看设置本身。
 *
 * 纯函数且不依赖 RN / GramJS，方便单测。
 */
export interface PreLoginNetworkHint {
  /** 建连时是否会真的走代理 */
  willUseProxy: boolean;
  /** 需要提醒用户的问题（比如通道和代理冲突），没有则为 null */
  warning: string | null;
  /** 一句话说明，直接显示在登录页 */
  message: string;
}

export function describePreLoginNetwork(
  transport: TransportKind,
  proxy: ProxySetting,
): PreLoginNetworkHint {
  const invalid = proxy.enabled ? validateProxy(proxy) : null;

  if (!proxy.enabled) {
    return {
      willUseProxy: false,
      warning: null,
      message: '未启用代理，将直连 Telegram。若所在网络无法直连，请先点「去配置」。',
    };
  }

  if (invalid) {
    return {
      willUseProxy: false,
      warning: invalid,
      message: `代理配置有误（${invalid}），登录时会退回直连。`,
    };
  }

  if (!proxySupportsTransport(proxy, transport)) {
    return {
      willUseProxy: false,
      warning: 'WebSocket 通道下代理不会生效。',
      message: '当前是 WebSocket 通道，代理不会生效。要代理请把通道切成 TCP。',
    };
  }

  return {
    willUseProxy: true,
    warning: null,
    message: `登录时会走 ${proxyKindLabel(proxy.kind)} ${describeProxyTarget(proxy)} 建连。`,
  };
}
