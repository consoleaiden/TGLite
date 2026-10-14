/**
 * `socks` 包的替代实现。
 *
 * GramJS 只有在 clientParams.proxy 存在时才会调用 SocksClient.createConnection。
 * 我们的做法是把代理配置交给 src/shims/net.js 在拨号时处理（这样 WebSocket 之外的
 * 所有通道都能统一走代理，也不受 GramJS「useWSS + proxy 直接抛错」的限制）。
 *
 * 但为了让这个模块不是个假实现，这里复用同一套 tunnel 逻辑：
 * 只要有人传了 proxy，它也能真的建出一条 SOCKS 隧道。
 */
const netShim = require('./net.js');

class SocksClientError extends Error {}

const SocksProxyType = { Socks4: 4, Socks5: 5 };

function kindOf(type) {
  if (type === SocksProxyType.Socks4 || type === 4 || String(type).toLowerCase().includes('4')) {
    return 'socks4';
  }
  return 'socks5';
}

class SocksClient {
  /**
   * @param {{proxy:{host:string,port:number,type:number,userId?:string,password?:string},
   *          destination:{host:string,port:number}, command?:string, timeout?:number}} options
   * @returns {Promise<{socket: import('./net.js').Socket}>}
   */
  static async createConnection(options) {
    const { proxy, destination, timeout } = options || {};
    if (!proxy || !destination) {
      throw new SocksClientError('SocksClient.createConnection 需要 proxy 与 destination。');
    }
    if (options.command && String(options.command).toLowerCase() !== 'connect') {
      throw new SocksClientError(`只支持 connect 命令，收到：${options.command}`);
    }
    try {
      const socket = await netShim.connectViaProxy(
        {
          kind: kindOf(proxy.type),
          host: proxy.host,
          port: proxy.port,
          username: proxy.userId,
          password: proxy.password,
        },
        { host: destination.host, port: destination.port },
        timeout,
      );
      return { socket };
    } catch (err) {
      throw new SocksClientError(err instanceof Error ? err.message : String(err));
    }
  }
}

module.exports = { SocksClient, SocksClientError, SocksProxyType };
