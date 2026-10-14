/**
 * `socks` 模块占位。
 * GramJS 只有配置了 SOCKS 代理时才会调用 SocksClient.createConnection。
 * 本客户端不内置代理功能，这里给一个明确的报错实现，避免打包失败。
 */
class SocksClient {
  static async createConnection() {
    throw new Error('[tg-lite] 未启用 SOCKS 代理支持。如需代理请自行接入 react-native-socks 等实现。');
  }
}

module.exports = {
  SocksClient,
  SocksClientError: class SocksClientError extends Error {},
  SocksProxyType: { Socks4: 4, Socks5: 5 },
};
