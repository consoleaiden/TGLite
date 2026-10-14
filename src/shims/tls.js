/**
 * `tls` 模块占位。
 * GramJS 的 TCP 通道不使用 TLS（MTProto 自己在传输层之上做加密，
 * 加密传输由 ConnectionTCPObfuscated 的 obfuscated2 完成）。
 * 这里保留导出，避免打包时报 "Unable to resolve module tls"。
 */
function notSupported() {
  throw new Error('[tg-lite] 本客户端不支持 TLS 直连。MTProto 通道本身已是加密通道。');
}

module.exports = {
  connect: notSupported,
  createServer: notSupported,
  TLSSocket: function TLSSocket() {
    notSupported();
  },
  connect_: notSupported,
  DEFAULT_MIN_VERSION: 'TLSv1.2',
  DEFAULT_MAX_VERSION: 'TLSv1.3',
};
