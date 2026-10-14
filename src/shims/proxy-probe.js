/**
 * 代理连通性探测：连上代理 -> 完成隧道握手 -> 立刻断开。
 *
 * 只做「握手能不能过」这一件事，不做任何 MTProto 交互，
 * 所以它能在设置页被用户随手点一下，也能在 CI 里被 Node 直接驱动。
 */
const TcpSocketModule = require('react-native-tcp-socket');
const tunnel = require('./tunnel');

const DEFAULT_TARGET = { host: '149.154.167.51', port: 443 };

/**
 * @param {object} options
 * @param {{kind:string,host:string,port:number|string,username?:string,password?:string}} options.proxy
 * @param {{host:string,port:number}} [options.target] 隧道尽头（默认 Telegram DC2）
 * @param {number} [options.timeoutMs]
 * @param {(opts:{host:string,port:number}, cb:()=>void) => any} [options.dial] 便于测试时注入
 * @returns {Promise<{elapsedMs:number,target:{host:string,port:number}}>}
 */
function probeProxy(options) {
  const { proxy, target, timeoutMs = 10000, dial } = options || {};
  if (!proxy || !proxy.host || !proxy.port) {
    return Promise.reject(new Error('代理地址或端口为空。'));
  }
  const destination = target || DEFAULT_TARGET;
  const startedAt = Date.now();

  const createConnection = dial || ((opts, cb) => {
    const TcpSocket = TcpSocketModule.default || TcpSocketModule;
    return TcpSocket.createConnection(opts, cb);
  });

  return new Promise((resolve, reject) => {
    let settled = false;
    let socket = null;

    const finish = (fn, payload) => {
      if (settled) return;
      settled = true;
      if (socket && typeof socket.destroy === 'function') {
        try {
          socket.destroy();
        } catch (e) {
          /* 忽略 */
        }
      }
      fn(payload);
    };

    socket = createConnection({ host: String(proxy.host).trim(), port: Number(proxy.port) }, () => {
      const stream = { ...proxy, timeoutMs };
      tunnel
        .establish(socket, stream, destination, timeoutMs)
        .then(() => finish(resolve, { elapsedMs: Date.now() - startedAt, target: destination }))
        .catch((err) => finish(reject, err instanceof Error ? err : new Error(String(err))));
    });

    if (socket && typeof socket.on === 'function') {
      socket.on('error', (err) => finish(reject, err instanceof Error ? err : new Error(String(err))));
      socket.on('close', () => finish(reject, new Error('代理连接被关闭。')));
    }
  });
}

module.exports = { probeProxy, DEFAULT_TARGET };
