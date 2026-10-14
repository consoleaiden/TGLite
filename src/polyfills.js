/**
 * ⚠️ 必须作为整个 App 的第一个 import（见项目根目录 index.js）。
 *
 * GramJS（npm 包 telegram）是为 Node.js 环境写的。React Native 缺少它的运行前提，
 * 这个文件负责把这些前提补齐，顺序很关键：
 *
 *   1. 全局对象：Buffer / process / self / TextEncoder / atob / btoa
 *   2. 安全随机数与 WebCrypto（crypto.getRandomValues + crypto.subtle）
 *   3. 把 GramJS 的「平台判定」改成 Node 语义（见下方详细说明）
 *
 * 第 3 点是最容易被忽略但最致命的：React Native 里存在全局 window，
 * GramJS 因此把自己当成浏览器，会：
 *   - 把默认 DC 地址设成 *.web.telegram.org（WebSocket 网关域名，不是各 DC 的真实 IP）
 *   - Client.getDC() 对媒体传输返回错误的域名
 * 结果就是能连上但下载/切 DC 全乱。改成 Node 语义后会使用 help.getConfig
 * 返回的真实 DC IP 列表，端口 443。
 */

// ---------------------------------------------------------------------------
// 1. 全局对象补齐
// ---------------------------------------------------------------------------
const { Buffer } = require('buffer');

if (!global.Buffer) global.Buffer = Buffer;
if (!global.SlowBuffer) global.SlowBuffer = Buffer;
if (!global.global) global.global = global;

// GramJS 的 crypto/crypto.js 里是 `self.crypto.subtle.digest(...)`，
// 所以 self 必须指向全局对象本身，且上面挂着的 crypto 就是我们补的那份。
if (!global.self || !global.self.crypto) global.self = global;

if (!global.process) {
  global.process = {};
}
if (!global.process.env) global.process.env = {};
if (!global.process.nextTick) {
  global.process.nextTick = (fn, ...args) => setTimeout(() => fn(...args), 0);
}
if (!global.process.version) global.process.version = 'v18.0.0';
if (typeof global.process.browser === 'undefined') global.process.browser = false;

if (typeof global.TextEncoder === 'undefined') {
  global.TextEncoder = class TextEncoder {
    get encoding() {
      return 'utf-8';
    }
    encode(input = '') {
      const buf = Buffer.from(String(input), 'utf8');
      return new Uint8Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    }
    encodeInto(input, dest) {
      const bytes = this.encode(input);
      const written = Math.min(bytes.length, dest.length);
      dest.set(bytes.subarray(0, written));
      return { read: String(input).length, written };
    }
  };
}

if (typeof global.TextDecoder === 'undefined') {
  global.TextDecoder = class TextDecoder {
    constructor(encoding = 'utf-8') {
      this.encoding = encoding;
    }
    decode(input) {
      if (!input) return '';
      return Buffer.from(input.buffer || input, input.byteOffset || 0, input.byteLength).toString('utf8');
    }
  };
}

if (typeof global.atob === 'undefined') {
  global.atob = (data) => Buffer.from(String(data), 'base64').toString('binary');
}
if (typeof global.btoa === 'undefined') {
  global.btoa = (data) => Buffer.from(String(data), 'binary').toString('base64');
}

// ---------------------------------------------------------------------------
// 2. 安全随机数 + WebCrypto
//    先让 react-native-get-random-values 安装原生 SecureRandom，
//    再用纯 JS 实现（@noble/hashes）补上 SHA / HMAC / PBKDF2。
// ---------------------------------------------------------------------------
require('react-native-get-random-values');

const cryptoShim = require('./shims/crypto');

const nativeGetRandomValues =
  global.crypto && typeof global.crypto.getRandomValues === 'function'
    ? global.crypto.getRandomValues.bind(global.crypto)
    : null;

if (!nativeGetRandomValues) {
  throw new Error(
    '[tg-lite] 无法获取安全随机数。请确认已执行 `npm install` 并重新构建 App（react-native-get-random-values 需要原生编译）。',
  );
}

global.crypto = {
  getRandomValues: nativeGetRandomValues,
  randomBytes: cryptoShim.randomBytes,
  createHash: cryptoShim.createHash,
  createHmac: cryptoShim.createHmac,
  createCipheriv: cryptoShim.createCipheriv,
  createDecipheriv: cryptoShim.createDecipheriv,
  subtle: cryptoShim.subtle,
  webcrypto: { subtle: cryptoShim.subtle, getRandomValues: nativeGetRandomValues },
};

// ---------------------------------------------------------------------------
// 3. 修正 GramJS 的平台判定（必须在 telegram 被 require 之前执行）
// ---------------------------------------------------------------------------
const gramPlatform = require('telegram/platform');
gramPlatform.isNode = true;
gramPlatform.isBrowser = false;

// ---------------------------------------------------------------------------
// 4. 兜底：GramJS 的 WebSocket 通道会用 Response 转换二进制帧
// ---------------------------------------------------------------------------
if (typeof global.Response === 'undefined') {
  global.Response = class Response {
    constructor(body) {
      this._body = body;
    }
    async arrayBuffer() {
      const body = this._body;
      if (body instanceof ArrayBuffer) return body;
      if (ArrayBuffer.isView(body)) return body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength);
      if (typeof body === 'string') {
        const buf = Buffer.from(body, 'utf8');
        return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
      }
      return new ArrayBuffer(0);
    }
    async text() {
      return Buffer.from(await this.arrayBuffer()).toString('utf8');
    }
  };
}

module.exports = {};
