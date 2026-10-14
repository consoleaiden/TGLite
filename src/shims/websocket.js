/**
 * `websocket` npm 包（Node 版）的替代实现。
 *
 * GramJS 的 extensions/PromisedWebSockets 用 `new w3cwebsocket(url, 'binary')` 做
 * MTProto-over-WebSocket。React Native 自带全局 WebSocket，这里做一个薄适配层。
 *
 * 说明：本客户端默认走 TCP（ConnectionTCPObfuscated），WebSocket 只是备用通道。
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
