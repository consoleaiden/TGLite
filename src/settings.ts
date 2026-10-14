import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

export const SETTINGS_KEY = '@tglite/settings_v1';

/** 传输通道：TCP = obfuscated2 裸 TCP；wss = MTProto over WebSocket（备用通道） */
export type TransportKind = 'tcp' | 'wss';

export type ProxyKind = 'socks5' | 'socks4' | 'http';

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
  proxy: { enabled: false, kind: 'socks5', host: '', port: '', username: '', password: '' },
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

/** 把持久化数据补齐成完整结构（旧版本 / 手改过的 JSON 都能吃下） */
function normalize(raw: unknown): Settings {
  const parsed = (raw || {}) as Partial<Settings>;
  return {
    ad: { ...DEFAULT_SETTINGS.ad, ...(parsed.ad || {}) },
    minor: { ...DEFAULT_SETTINGS.minor, ...(parsed.minor || {}) },
    transport: parsed.transport === 'wss' ? 'wss' : 'tcp',
    proxy: { ...DEFAULT_SETTINGS.proxy, ...(parsed.proxy || {}) },
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
 */
export function proxySupportsTransport(proxy: ProxySetting, transport: TransportKind): boolean {
  if (!proxy.enabled) return true;
  return transport !== 'wss';
}

/** 校验代理配置，返回中文错误信息；通过则返回 null */
export function validateProxy(proxy: ProxySetting): string | null {
  if (!proxy.enabled) return null;
  const host = proxy.host.trim();
  if (!host) return '请填写代理服务器地址。';
  const port = Number(proxy.port);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return '代理端口必须是 1 - 65535 之间的整数。';
  if (proxy.kind === 'http' && !/^[A-Za-z0-9._\-:[\]@]+$/.test(host)) {
    return 'HTTP 代理地址含有非法字符。';
  }
  return null;
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
    message: `登录时会走 ${proxy.kind.toUpperCase()} ${proxy.host.trim()}:${proxy.port} 建连。`,
  };
}
