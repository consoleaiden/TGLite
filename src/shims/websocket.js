/**
 * `websocket` npm 包（Node 版）的替代实现。
 *
 * GramJS 的 extensions/PromisedWebSockets 用 `new w3cwebsocket(url, 'binary')` 做
 * MTProto-over-WebSocket。React Native 自带全局 WebSocket，这里做一个薄适配层。
 *
 * 什么时候会走到这里：
 *   设置页把「传输通道」切成 WebSocket 时（telegram.ts 会把 networkSocket 换成
 *   PromisedWebSockets、useWSS 设成 true），GramJS 就会用
 *   `wss://<dc-ip>:443/apiws` 建连。此时 TLS 由系统网络栈（Android 上是 OkHttp）
 *   完成，所以这条路不需要任何原生加密模块。
 *
 * 也因此，WebSocket 通道用不了我们在 net shim 里自研的 SOCKS/HTTP 隧道——
 * OkHttp 只认系统代理。设置页对这个组合有显式拦截。
 */
function resolveWebSocketImpl() {
  const Impl = global.WebSocket;
  if (!Impl) {
    throw new Error('[tg-lite] 当前运行环境没有提供 WebSocket 实现。');
  }
  return Impl;
}

class W3CWebSocket {
  constructor(url, protocols) {
    const Impl = resolveWebSocketImpl();
    this.url = url;
    this.readyState = 0;
    this.onopen = null;
    this.onerror = null;
    this.onclose = null;
    this.onmessage = null;

    const socket = protocols ? new Impl(url, protocols) : new Impl(url);
    try {
      socket.binaryType = 'arraybuffer';
    } catch (e) {
      /* 某些实现不允许设置，忽略 */
    }

    socket.onopen = (event) => {
      this.readyState = 1;
      if (this.onopen) this.onopen(event);
    };
    socket.onerror = (event) => {
      if (this.onerror) this.onerror(event);
    };
    socket.onclose = (event) => {
      this.readyState = 3;
      if (this.onclose) this.onclose(event);
    };
    socket.onmessage = (event) => {
      if (this.onmessage) this.onmessage(event);
    };

    this._socket = socket;
  }

  send(data) {
    this._socket.send(data);
  }

  close() {
    try {
      this._socket.close();
    } catch (e) {
      /* 忽略重复关闭 */
    }
  }
}

module.exports = {
  w3cwebsocket: W3CWebSocket,
  WebSocket: W3CWebSocket,
  client: W3CWebSocket,
  server: undefined,
  connection: undefined,
};
