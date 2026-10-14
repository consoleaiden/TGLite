export interface ResolvedProxy {
  kind: 'socks5' | 'socks4' | 'http';
  host: string;
  port: number;
  username: string;
  password: string;
  timeoutMs: number;
}

export interface ProxyInput {
  enabled: boolean;
  kind: string;
  host: string;
  port: string | number;
  username?: string;
  password?: string;
}

/** 写入代理配置；proxy 传 null 或 enabled:false 表示关闭代理。返回归一化后的配置。 */
export function setProxy(proxy: ProxyInput | null): ResolvedProxy | null;
export function getProxy(): ResolvedProxy | null;
export function hasProxy(): boolean;
export function getRevision(): number;
export function reset(): void;
