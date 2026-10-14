// 便于 src/net/transport.ts 以类型安全的方式引用 shim
export interface ProbeProxyOptions {
  proxy: {
    kind: string;
    host: string;
    port: number | string;
    username?: string;
    password?: string;
  };
  target?: { host: string; port: number };
  timeoutMs?: number;
  dial?: (opts: { host: string; port: number }, cb: () => void) => unknown;
}

export interface ProbeProxyResult {
  elapsedMs: number;
  target: { host: string; port: number };
}

export function probeProxy(options: ProbeProxyOptions): Promise<ProbeProxyResult>;
export const DEFAULT_TARGET: { host: string; port: number };
