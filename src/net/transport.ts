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
import { validateProxy } from '../settings';

export interface TransportPlan {
  transport: TransportKind;
  /** 实际生效的代理（null 表示直连）；WebSocket 通道下永远是 null */
  proxy: ReturnType<typeof transportState.setProxy>;
  /** 给 GramJS 的 networkSocket 参数 */
  networkSocket: unknown;
  useWSS: boolean;
  /** 一行中文描述，直接展示在设置页 */
  summary: string;
  /** 非致命提示（比如「代理被忽略」），需要显示给用户 */
  warning: string | null;
}

export function transportLabel(transport: TransportKind): string {
  return transport === 'wss' ? 'WebSocket (wss 443)' : 'TCP (obfuscated2 443)';
}

/**
 * 把设置落到 shim 层，并算出本次连接要用的参数。
 * 注意：WebSocket 走的是系统网络栈（OkHttp / NSURLSession），
 * 自研的 SOCKS/HTTP 隧道插不进去，所以这个组合下代理会被忽略并给出警告。
 */
export function applyTransportSettings(
  settings: Pick<Settings, 'transport' | 'proxy'>,
): TransportPlan {
  const transport = settings.transport === 'wss' ? 'wss' : 'tcp';
  let warning: string | null = null;
  let proxy: ReturnType<typeof transportState.setProxy> = null;

  if (settings.proxy.enabled) {
    const invalid = validateProxy(settings.proxy);
    if (invalid) {
      transportState.setProxy(null);
      warning = `代理未启用：${invalid}`;
    } else if (transport === 'wss') {
      transportState.setProxy(null);
      warning = 'WebSocket 通道由系统网络栈实现，无法使用自定义代理，本次连接已忽略代理设置。';
    } else {
      try {
        proxy = transportState.setProxy(settings.proxy);
      } catch (err) {
        transportState.setProxy(null);
        warning = `代理未启用：${err instanceof Error ? err.message : String(err)}`;
      }
    }
  } else {
    transportState.setProxy(null);
  }

  const via = proxy ? `，经 ${proxy.kind.toUpperCase()} 代理 ${proxy.host}:${proxy.port}` : '，直连';
  return {
    transport,
    proxy,
    networkSocket: transport === 'wss' ? PromisedWebSockets : PromisedNetSockets,
    useWSS: transport === 'wss',
    summary: `${transportLabel(transport)}${via}`,
    warning,
  };
}

/** 当前生效的代理（不含被忽略的情况） */
export function activeProxy(): ReturnType<typeof transportState.getProxy> {
  return transportState.getProxy();
}

export interface ProxyTestResult {
  ok: boolean;
  message: string;
}

/**
 * 连通性测试：只验证「连得上代理 + 隧道握手能过」，
 * 用 Telegram DC2 当隧道尽头，避免误判成「代理能用但访问不了 Telegram」。
 */
export async function testProxy(proxy: ProxySetting): Promise<ProxyTestResult> {
  const invalid = validateProxy({ ...proxy, enabled: true });
  if (invalid) return { ok: false, message: invalid };

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
