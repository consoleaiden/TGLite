export interface MinimalSocket {
  on(event: string, listener: (...args: any[]) => void): unknown;
  write(buffer: Uint8Array): unknown;
  destroy?(): unknown;
  removeListener?(event: string, listener: (...args: any[]) => void): unknown;
  off?(event: string, listener: (...args: any[]) => void): unknown;
}

export interface TunnelProxy {
  kind: string;
  host: string;
  port: number | string;
  username?: string;
  password?: string;
}

export interface TunnelDestination {
  host: string;
  port: number | string;
}

/**
 * 在一条已经连上代理服务器的 socket 上完成代理握手。
 * resolve 出来的 Buffer 是握手后残留的业务数据（可能为空）。
 */
export function establish(
  socket: MinimalSocket,
  proxy: TunnelProxy,
  destination: TunnelDestination,
  timeoutMs?: number,
): Promise<Uint8Array>;

export function buildSocks5ConnectRequest(destination: TunnelDestination): Uint8Array;
export function buildSocks4Request(options: {
  destination: TunnelDestination;
  username?: string;
}): Uint8Array;

export const SOCKS5_ERRORS: Record<number, string>;
export const SOCKS4_ERRORS: Record<number, string>;
