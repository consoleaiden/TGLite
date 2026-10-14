/**
 * Node `crypto` 模块的 React Native 兼容实现（100% 纯 JS，零原生依赖）。
 *
 * 为什么需要它：
 *   GramJS 内部的 crypto/crypto.js 用的是 WebCrypto（crypto.subtle）+ 纯 JS 的 AES，
 *   但 Helpers.generateRandomBytes / CryptoFile 走的是 Node 的 `crypto` 模块。
 *   React Native 两者都没有，所以这里用 @noble/hashes 补齐。
 *
 * 只实现 GramJS 真正用到的 API：
 *   randomBytes / createHash / createHmac / subtle.{digest,importKey,deriveBits} / getRandomValues
 * AES 加解密（文件上传下载用）本 App 不使用，遇到时直接抛出明确错误。
 */
const { Buffer } = require('buffer');
const { sha1 } = require('@noble/hashes/sha1');
const { sha256 } = require('@noble/hashes/sha256');
const { sha512 } = require('@noble/hashes/sha512');
const { hmac } = require('@noble/hashes/hmac');
const { pbkdf2 } = require('@noble/hashes/pbkdf2');

const HASHES = { sha1, sha256, sha512 };

function normalizeAlg(algorithm) {
  return String(algorithm || '').toLowerCase().replace(/[-_]/g, '');
}

function toBytes(data) {
  if (data == null) return new Uint8Array(0);
  if (typeof data === 'string') return Buffer.from(data, 'utf8');
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  return Buffer.from(data);
}

/** 截取 Uint8Array 的底层 ArrayBuffer，返回精确长度的 ArrayBuffer */
function toArrayBuffer(view) {
  return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
}

// ---------------------------------------------------------------------------
// 安全随机数：由 react-native-get-random-values 安装的原生实现提供
// ---------------------------------------------------------------------------
function getRandomValues(array) {
  const c = global.crypto;
  if (!c || typeof c.getRandomValues !== 'function' || c.getRandomValues === getRandomValues) {
    throw new Error(
      '[tg-lite] 安全随机数不可用：请确认 react-native-get-random-values 已安装并完成原生链接。',
    );
  }
  return c.getRandomValues(array);
}

function randomBytes(size) {
  const buf = Buffer.alloc(size);
  getRandomValues(buf);
  return buf;
}

// ---------------------------------------------------------------------------
// Hash / HMAC
// ---------------------------------------------------------------------------
function makeHasher(getInstance, algName) {
  const chunks = [];
  return {
    update(data, encoding) {
      chunks.push(typeof data === 'string' ? Buffer.from(data, encoding || 'utf8') : toBytes(data));
      return this;
    },
    digest(encoding) {
      if (!chunks.length) throw new Error(`${algName}: nothing to digest`);
      const out = Buffer.from(getInstance()(Buffer.concat(chunks)));
      return encoding ? out.toString(encoding) : out;
    },
  };
}

function createHash(algorithm) {
  const alg = normalizeAlg(algorithm);
  const fn = HASHES[alg];
  if (!fn) throw new Error(`[tg-lite] crypto.createHash 不支持的算法: ${algorithm}`);
  return makeHasher(() => fn, alg);
}

function createHmac(algorithm, key) {
  const alg = normalizeAlg(algorithm);
  const fn = HASHES[alg];
  if (!fn) throw new Error(`[tg-lite] crypto.createHmac 不支持的算法: ${algorithm}`);
  const k = Buffer.from(toBytes(key));
  const chunks = [];
  return {
    update(data, encoding) {
      chunks.push(typeof data === 'string' ? Buffer.from(data, encoding || 'utf8') : toBytes(data));
      return this;
    },
    digest(encoding) {
      const out = Buffer.from(hmac(fn, k, Buffer.concat(chunks)));
      return encoding ? out.toString(encoding) : out;
    },
  };
}

function unsupportedCipher(name) {
  return function () {
    throw new Error(
      `[tg-lite] crypto.${name} 未实现：本客户端不涉及加密文件的上下传。` +
        'MTProto 自身的 AES-IGE/CTR 由 GramJS 用纯 JS 实现，不受影响。',
    );
  };
}

// ---------------------------------------------------------------------------
// WebCrypto（GramJS 的 crypto/crypto.js 直接依赖这三个方法）
// ---------------------------------------------------------------------------
const subtle = {
  async digest(algorithm, data) {
    const name = typeof algorithm === 'string' ? algorithm : algorithm && algorithm.name;
    const fn = HASHES[normalizeAlg(name)];
    if (!fn) throw new Error(`[tg-lite] subtle.digest 不支持的算法: ${name}`);
    return toArrayBuffer(fn(toBytes(data)));
  },

  async importKey(format, keyData, algorithm, extractable, usages) {
    // GramJS 只用 "raw" 格式，且只做 PBKDF2 deriveBits
    return { __raw: toBytes(keyData), algorithm, type: 'secret' };
  },

  async deriveBits(algorithm, baseKey, length) {
    const name = normalizeAlg(algorithm && algorithm.name);
    if (name !== 'pbkdf2') throw new Error(`[tg-lite] subtle.deriveBits 不支持的算法: ${name}`);
    const fn = HASHES[normalizeAlg(algorithm.hash && (algorithm.hash.name || algorithm.hash)) || 'sha512'];
    if (!fn) throw new Error(`[tg-lite] PBKDF2 不支持的 HMAC: ${algorithm.hash}`);
    const derived = pbkdf2(fn, toBytes(baseKey && baseKey.__raw), toBytes(algorithm.salt), {
      c: algorithm.iterations,
      dkLen: (length || 512) / 8,
    });
    return toArrayBuffer(derived);
  },
};

module.exports = {
  randomBytes,
  createHash,
  createHmac,
  createCipheriv: unsupportedCipher('createCipheriv'),
  createDecipheriv: unsupportedCipher('createDecipheriv'),
  getRandomValues,
  subtle,
  webcrypto: { subtle, getRandomValues },
  randomUUID: undefined,
};
