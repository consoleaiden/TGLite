/**
 * fake-TLS（`ee` 模式）ClientHello 构造与 TLS 记录成帧。
 *
 * 本文件是**纯逻辑**：不 import react-native / telegram，可被 jest 直接测试。
 *
 * ── 依据的权威实现 ──────────────────────────────────────────────
 * 1. Telegram 官方 Android 客户端（Nagram / Momogram 的 JNI 层）
 *      TMessagesProj/jni/tgnet/TLSHello.cpp      —— ClientHello 生成器
 *      TMessagesProj/jni/tgnet/ConnectionSocket.cpp —— 握手全流程
 * 2. MTProxy 服务端
 *      net/net-tcp-rpc-ext-server.c             —— 校验算法
 *      common/sha256.c                          —— sha256_hmac 语义
 *
 * ── 三个必须记住的结论 ──────────────────────────────────────────
 * ① random 字段（偏移 11..43）不是 obfuscated2 的 64 字节头，而是：
 *      把 hello 的 random 字段清零后
 *      HMAC-SHA256(secret16, 整个 hello) → 32 字节
 *      前 28 字节原样放回，后 4 字节与 unix 时间戳异或
 *    （服务端 net-tcp-rpc-ext-server.c:1141-1166）
 *
 * ② **记录里的 payload 完全不加密**。官方客户端只做 TLS 成帧：
 *      首包： 14 03 03 00 01 01  17 03 03 <len16> <payload>
 *      之后： 17 03 03 <len16> <payload>
 *    payload 明文直传，加密由 MTProto 自己的 obfuscated2 层负责。
 *    （ConnectionSocket.cpp:615-640 写入 / :435-475 读取，两边都没有 AES）
 *    —— 早期版本误以为要套 AES-CTR，是错的。
 *
 * ③ ClientHello 用「算子 + 嵌套作用域」构造，长度字段靠 BeginScope/EndScope
 *    自动回填，扩展列表随机打乱（Permutation），最后用 padding 扩展补到 517。
 *    手写固定偏移极易错位（本项目就因 cipher_suites 少写 2 字节导致
 *    服务端 get_sni_domain_info() 找不到 SNI）。
 */

export const TLS_REQUEST_LENGTH = 517;
/**
 * 服务端校验里 min_len 来自 record 头，本身没有 517 的上限；
 * 517 是官方 `Op::P()` 把 padding 补到的目标。这里放宽到 4096
 * （服务端 `read_len = len <= 4096 ? len : 4096`），
 * 以便完整版 ML-KEM hello（~1800B）也能通过。
 */
export const MAX_HELLO_LENGTH = 4096;
export const TLS_RECORD_HEADER = 5;
/** 官方客户端单条 record 的上限（ConnectionSocket.cpp: remaining > 2878 时截断） */
export const MAX_RECORD_PAYLOAD = 2878;

/** hello 里 random 字段偏移 = 5(record 头) + 6(handshake 类型+长度+版本) */
export const OFFSET_RANDOM = 11;
export const RANDOM_LEN = 32;

// ─────────────────────────── 算子模型 ───────────────────────────

export const Op = {
  String: 'string',
  Random: 'random',
  K: 'k',
  M: 'm',
  E: 'e',
  P: 'p',
  Zero: 'zero',
  Domain: 'domain',
  Grease: 'grease',
  BeginScope: 'begin',
  EndScope: 'end',
  Permutation: 'perm',
};

const hex = (h) => Buffer.from(h.replace(/\s/g, ''), 'hex');
const str = (h) => ({ t: Op.String, d: hex(h) });
const random = (n) => ({ t: Op.Random, n });
const kOp = () => ({ t: Op.K });
const mOp = () => ({ t: Op.M });
const eOp = () => ({ t: Op.E });
const pOp = () => ({ t: Op.P });
const zero = (n) => ({ t: Op.Zero, n });
const domainOp = () => ({ t: Op.Domain });
const grease = (i) => ({ t: Op.Grease, i });
const begin = () => ({ t: Op.BeginScope });
const end = () => ({ t: Op.EndScope });
const perm = (entities) => ({ t: Op.Permutation, entities });

/**
 * 默认 hello 的算子序列（逐行对应官方 TLSHello::getDefault()）。
 *
 * 注意：官方最新版在 key_share 里带 ML-KEM-768（`M()`，1184 字节），
 * 会让整个 hello 到 1800+ 字节。MTProxy 服务端并不依赖 517 这个数
 * （`TLS_REQUEST_LENGTH` 只用在它自带的探测函数里），但为兼容老代理，
 * 这里提供 `compact: true` 选项走「无 ML-KEM」的紧凑版，正好 517 字节。
 */
function defaultOps() {
  return [
    str('160301'), begin(),
    str('0100'), begin(),
    str('0303'), zero(32),
    str('20'), random(32),
    str('0020'), grease(0),
    // cipher_suites：GREASE(2) + 15 个套件(30) = 32 字节，
    // 结尾 0100 是「压缩方法长度 + null 压缩」，不属于套件列表
    str('130113021303c02bc02fc02cc030cca9cca8c013c014009c009d002f00350100'),
    begin(),
    grease(2),
    str('0000'),
    perm([
      [str('0000'), begin(), begin(), str('00'), begin(), domainOp(), end(), end(), end()],
      [str('000500050100000000')],
      [str('000a000c000a'), grease(4), str('11ec001d00170018')],
      [str('000b00020100')],
      [str('000d0018001609040905090604030804040105030805050108060601')],
      [str('0010000e000c02683208687474702f312e31')],
      [str('00120000')],
      [str('00170000')],
      [str('001b0003020002')],
      [str('00230000')],
      [
        str('0033'), begin(),           // key_share：长度由 scope 自动回填
        grease(4), str('0001001d0020'), kOp(),
        end(),
      ],
      [str('002b0003020304')],
      [str('002d00020101')],
      [str('ff01000100')],
    ]),
    grease(3),
    str('000100'), pOp(),
    end(), end(), end(),
  ];
}

/** 完整版：把 key_share 换成 ML-KEM-768（官方新版行为） */
function fullOps() {
  const ops = defaultOps();
  // 找到 key_share 那一组并替换
  for (const op of ops) {
    if (op.t !== Op.Permutation) continue;
    for (let i = 0; i < op.entities.length; i++) {
      const part = op.entities[i];
      if (part.length && part[0].t === Op.String && part[0].d.equals(hex('0033002b0029'))) {
        op.entities[i] = [
          str('003304ef04ed'), grease(4), str('00010011ec04c0'),
          mOp(), kOp(), str('001d0020'), kOp(),
        ];
      }
      if (part.length && part[0].t === Op.String && part[0].d.equals(hex('44cd00050003026832'))) {
        // 保留
      }
    }
    // 追加支持 quantum-safe 的扩展组
    op.entities.push([
      str('fe0d'), begin(), str('0000010001'), random(1), str('0020'), kOp(),
      begin(), eOp(), end(), end(),
    ]);
  }
  return ops;
}

function makeGrease(randomBytes) {
  const g = randomBytes(8);
  for (let i = 0; i < 8; i++) g[i] = (g[i] & 0xf0) + 0x0a;
  for (let i = 1; i < 8; i += 2) if (g[i] === g[i + 1]) g[i] ^= 0x10;
  return g;
}

/**
 * 把算子序列写进 buffer，返回实际长度。
 * 这是官方 `TLSHello::writeOp` 的逐条移植（含作用域回填）。
 */
function writeOps(ops, out, offsetRef, ctx) {
  const { randomBytes, greaseBytes, domainBuf } = ctx;
  const scopeOffsets = ctx.scopeOffsets;

  for (const op of ops) {
    switch (op.t) {
      case Op.String:
        op.d.copy(out, offsetRef.v);
        offsetRef.v += op.d.length;
        break;
      case Op.Random:
        randomBytes(op.n).copy(out, offsetRef.v);
        offsetRef.v += op.n;
        break;
      case Op.K:
        // X25519 公钥：32 字节随机 + 最高位清零（官方用 BN 运算，字节分布等价）
        ctx.publicKey(randomBytes(32)).copy(out, offsetRef.v);
        offsetRef.v += 32;
        break;
      case Op.M:
        // ML-KEM-768：1184 字节（1152 冗余 + 32 种子）
        randomBytes(1152).copy(out, offsetRef.v);
        randomBytes(32).copy(out, offsetRef.v + 1152);
        offsetRef.v += 1184;
        break;
      case Op.Zero:
        out.fill(0, offsetRef.v, offsetRef.v + op.n);
        offsetRef.v += op.n;
        break;
      case Op.Domain:
        domainBuf.copy(out, offsetRef.v);
        offsetRef.v += domainBuf.length;
        break;
      case Op.Grease:
        out[offsetRef.v] = greaseBytes[op.i];
        out[offsetRef.v + 1] = greaseBytes[op.i];
        offsetRef.v += 2;
        break;
      case Op.BeginScope:
        scopeOffsets.push(offsetRef.v);
        offsetRef.v += 2;
        break;
      case Op.EndScope: {
        if (!scopeOffsets.length) throw new Error('作用域不匹配：多了一个 end_scope');
        const b = scopeOffsets.pop();
        const size = offsetRef.v - b - 2;
        out[b] = (size >> 8) & 0xff;
        out[b + 1] = size & 0xff;
        break;
      }
      case Op.E: {
        // 随机长度的「密钥材料」，官方在 144/176/208/240 里随机取
        const len = ctx.pickEncryptedSize();
        randomBytes(len).copy(out, offsetRef.v);
        offsetRef.v += len;
        break;
      }
      case Op.P: {
        // 补到 517：writeOp("0015") + begin + zero(513-cur) + end
        const cur = offsetRef.v;
        if (cur <= 513) {
          writeOps([str('0015'), begin(), zero(513 - cur), end()], out, offsetRef, ctx);
        }
        break;
      }
      case Op.Permutation: {
        // 官方是 Fisher-Yates，这里可选关闭以便测试
        const list = op.entities.slice();
        if (ctx.shuffle) {
          for (let i = 0; i < list.length - 1; i++) {
            const j = i + Math.floor(ctx.random() * (list.length - i));
            if (i !== j) {
              const tmp = list[i];
              list[i] = list[j];
              list[j] = tmp;
            }
          }
        }
        for (const part of list) writeOps(part, out, offsetRef, ctx);
        break;
      }
      default:
        throw new Error(`未知算子: ${op.t}`);
    }
  }
}

/**
 * 构造 ClientHello（random 字段为 0，需再调 fillClientRandom）。
 *
 * @param {string} domain       伪装域名（SNI）
 * @param {object} [opts]
 * @param {Function} [opts.randomBytes] (n) => Buffer，注入以便测试
 * @param {boolean}  [opts.compact=true] true=不带 ML-KEM（517B）
 * @param {boolean}  [opts.shuffle=true] 是否打乱扩展顺序
 * @returns {Buffer} ClientHello
 */
export function buildClientHello(domain, opts = {}) {
  if (!domain || typeof domain !== 'string') {
    throw new Error('fake-TLS 需要伪装域名');
  }
  const randomBytes = opts.randomBytes || defaultRandom;
  const shuffle = opts.shuffle !== false;
  // TLS 里 SNI 域名上限 253 字节。**超限直接报错，不做静默截断**——
  // 截断出来的域名既不是原域名也不是合法域名，服务端要么当未知域拒绝、
  // 要么按截断名去连上游，都会得到「格式看着没问题但连不上」的假象。
  // 官方是 `if (size > 253) size = 253;` 硬截，但调用方给的一定是合法域名，
  // 我们这里是用户手填，宁可报错。
  const domainBuf = Buffer.from(domain, 'ascii');
  if (domainBuf.length > 253) {
    throw new Error(`伪装域名过长（${domainBuf.length} > 253 字节）`);
  }
  const ctx = {
    randomBytes,
    greaseBytes: makeGrease(randomBytes),
    domainBuf,
    scopeOffsets: [],
    publicKey: (b) => {
      b[31] &= 127;
      return b;
    },
    pickEncryptedSize: () => [144, 176, 208, 240][Math.floor((opts.random || Math.random)() * 4)],
    random: opts.random || Math.random,
    shuffle,
  };

  const ops = opts.compact === false ? fullOps() : defaultOps();
  const out = Buffer.alloc(8192);
  const offsetRef = { v: 0 };
  writeOps(ops, out, offsetRef, ctx);

  if (ctx.scopeOffsets.length) {
    throw new Error(`作用域未闭合，还剩 ${ctx.scopeOffsets.length} 个`);
  }
  const hello = Buffer.from(out.subarray(0, offsetRef.v));

  // 官方 Op::P() 只在「当前已写长度 <= 513」时才补零到 517。
  // 域名太长（或用了完整版 ML-KEM）就会超出，此时明确报错，
  // 不要静默产出一个服务端不认的包。
  if (opts.strictLength !== false && hello.length > MAX_HELLO_LENGTH) {
    throw new Error(
      `fake-TLS ClientHello 过长（${hello.length} > ${MAX_HELLO_LENGTH}）：伪装域名 "${domain}" 太长`,
    );
  }
  return hello;
}

/**
 * 按官方算法填入 random 字段。
 *
 * @param {Buffer} hello         buildClientHello 的产物（原地修改）
 * @param {Buffer} secret16      16 字节密钥
 * @param {Function} hmacSha256  (key, data) => Buffer
 * @param {number} [timestamp]   unix 秒，便于测试固定
 * @returns {Buffer} hello
 */
export function fillClientRandom(hello, secret16, hmacSha256, timestamp) {
  if (!Buffer.isBuffer(hello) || hello.length < OFFSET_RANDOM + RANDOM_LEN) {
    throw new Error('ClientHello 太短');
  }
  if (!Buffer.isBuffer(secret16) || secret16.length !== 16) {
    throw new Error('密钥必须是 16 字节');
  }
  const ts = timestamp === undefined ? Math.floor(Date.now() / 1000) : timestamp;

  // 官方也是先清零再算 HMAC
  hello.fill(0, OFFSET_RANDOM, OFFSET_RANDOM + RANDOM_LEN);
  const digest = hmacSha256(secret16, hello);
  if (!Buffer.isBuffer(digest) || digest.length !== 32) {
    throw new Error('HMAC-SHA256 应返回 32 字节');
  }
  digest.copy(hello, OFFSET_RANDOM, 0, 28);
  const xor = Buffer.alloc(4);
  xor.writeUInt32BE((digest.readUInt32BE(28) ^ (ts >>> 0)) >>> 0, 0);
  xor.copy(hello, OFFSET_RANDOM + 28);
  return hello;
}

/**
 * 校验服务端 ServerHello 的 HMAC。
 *
 * 官方客户端（ConnectionSocket.cpp:360-372）：
 *     memcpy(save, response + 11, 32);   // 先把收到的 server_random 存起来
 *     memset(response + 11, 0, 32);      // ★ 再把这 32 字节清零
 *     HMAC(secret, client_random(32) ++ response, mac);
 *     memcmp(mac, save, 32) == 0
 *
 * 服务端生成侧同理（net-tcp-rpc-ext-server.c:1233-1235）：先算 MAC，再写回 11..43。
 * 所以**校验时必须先把 11..43 清零**，否则永远算不出同一个值。
 *
 * 不校验这一步，就会把「被代理转发到真实上游的 TLS Alert」误判成握手成功。
 *
 * @param {Buffer} clientRandom32  我们发出去的 hello 的 11..43 字节
 * @param {Buffer} secret16        16 字节密钥
 * @param {Buffer} serverResponse  服务端返回的首个 record 全文（含 5 字节头）
 * @param {Function} hmacSha256    (key, data) => Buffer
 * @returns {boolean}
 */
export function verifyServerHello(clientRandom32, secret16, serverResponse, hmacSha256) {
  if (!Buffer.isBuffer(clientRandom32) || clientRandom32.length !== 32) {
    throw new Error('client_random 必须是 32 字节');
  }
  if (!Buffer.isBuffer(serverResponse) || serverResponse.length < 43) return false;

  const claimed = Buffer.from(serverResponse.subarray(11, 43));
  const blind = Buffer.from(serverResponse);
  blind.fill(0, 11, 43);

  const mac = hmacSha256(secret16, Buffer.concat([clientRandom32, blind]));
  if (!Buffer.isBuffer(mac) || mac.length < 32) return false;
  return mac.subarray(0, 32).equals(claimed);
}

// ─────────────────────── TLS 记录成帧 / 解析 ───────────────────────

/** 包一条 ApplicationData 记录（payload 明文，见文件头结论 ②） */
export function wrapRecord(payload) {
  if (!Buffer.isBuffer(payload)) throw new Error('wrapRecord 需要 Buffer');
  if (payload.length > 0xffff) throw new Error('record 长度超出 16 位');
  const header = Buffer.alloc(TLS_RECORD_HEADER);
  header[0] = 0x17;
  header[1] = 0x03;
  header[2] = 0x03;
  header.writeUInt16BE(payload.length, 3);
  return Buffer.concat([header, payload]);
}

/** 握手后发给服务端的固定 9 字节前缀：dummy CCS + 首个 AppData 头 */
export const POST_HANDSHAKE_PREFIX = hex('140303000101170303');

export function isAppDataRecord(buf) {
  return buf.length >= 3 && buf[0] === 0x17 && buf[1] === 0x03 && buf[2] === 0x03;
}

export function isHandshakeRecord(buf) {
  return buf.length >= 3 && buf[0] === 0x16 && buf[1] === 0x03 && buf[2] === 0x03;
}

export function isChangeCipherSpec(buf) {
  return buf.length >= 3 && buf[0] === 0x14 && buf[1] === 0x03 && buf[2] === 0x03;
}

export function isAlertRecord(buf) {
  return buf.length >= 3 && buf[0] === 0x15 && buf[1] === 0x03 && buf[2] === 0x03;
}

export function readRecordLength(buf) {
  if (buf.length < TLS_RECORD_HEADER) throw new Error('record 头不足 5 字节');
  return (buf[3] << 8) | buf[4];
}

/** 按官方上限把 payload 切成多条 record（首条 2878 字节） */
export function splitIntoRecords(payload, max = MAX_RECORD_PAYLOAD) {
  const out = [];
  for (let i = 0; i < payload.length; i += max) {
    out.push(payload.subarray(i, Math.min(i + max, payload.length)));
  }
  return out.length ? out : [Buffer.alloc(0)];
}

/**
 * 从 `ee` 密钥尾巴里取出要伪装的域名。
 *
 * 官方格式（ConnectionSocket.cpp:193-196）：
 *     secret[0] == 0xee 时
 *       currentSecret       = secret.substr(1, 16)
 *       currentSecretDomain = secret.substr(17)   ← 域名，**没有长度字节**
 */
export function pickFakeTlsDomain(tailBytes, fallbackHost) {
  if (Buffer.isBuffer(tailBytes) && tailBytes.length > 0) {
    const text = tailBytes.toString('latin1');
    const m = text.match(/[A-Za-z0-9][A-Za-z0-9.-]{2,}/);
    if (m && m[0].includes('.')) return m[0];
  }
  return fallbackHost || 'www.google.com';
}

function defaultRandom(n) {
  const b = Buffer.alloc(n);
  for (let i = 0; i < n; i++) b[i] = Math.floor(Math.random() * 256);
  return b;
}

export default {
  TLS_REQUEST_LENGTH,
  MAX_HELLO_LENGTH,
  MAX_RECORD_PAYLOAD,
  POST_HANDSHAKE_PREFIX,
  buildClientHello,
  fillClientRandom,
  verifyServerHello,
  wrapRecord,
  isAppDataRecord,
  isHandshakeRecord,
  isChangeCipherSpec,
  isAlertRecord,
  readRecordLength,
  splitIntoRecords,
  pickFakeTlsDomain,
};
