/**
 * fake-TLS（`ee` 模式）MTProxy 的运行时接线层。
 *
 * ── 它解决什么问题 ────────────────────────────────────────────
 * GramJS 只实现了 MTProxy 的 `dd` 模式（obfuscated2）。`ee` 模式（伪 TLS，
 * 把流量伪装成一次 TLS 1.3 会话）在 GramJS 里**完全不存在**，所以服务商给的
 * `ee` 密钥在 GramJS 里要么被当成 16 字节裸密钥（失去伪装），要么直接报错。
 *
 * ── 怎么接进去 ────────────────────────────────────────────────
 * GramJS 的连接是「Connection（传输）+ ObfuscatedIO（加密/成帧）」两层：
 *
 *     ObfuscatedConnection._initConn()  → new ObfuscatedIO(this); await initHeader();
 *                                          socket.write(obfuscation.header)
 *     ObfuscatedConnection._send(data)  → obfuscation.write(codec.encodePacket(data))
 *     ObfuscatedConnection._recv()      → codec.readPacket(obfuscation)
 *
 * 而 `ObfuscatedIO` 是**实例属性**（`this.ObfuscatedIO = MTProxyIO`），
 * 不是模块私有的。所以我们只要写一个 `FakeTlsMTProxyIO extends MTProxyIO`，
 * 覆盖 `initHeader` / `read` / `write` 三个方法，再把它塞到实例上即可，
 * 完全不需要改 GramJS 源码、也不需要 monkey-patch 模块。
 *
 * ── 和 dd 模式的关键差别（见 src/net/mtproxy-faketls.js 文件头）────────
 * 1. 握手：先发 ClientHello（Op::P 补到 517），校验 ServerHello 的 HMAC，
 *    再发 `14 03 03 00 01 01 17 03 03` 前缀
 * 2. payload **不加密**：只做 `17 03 03 <len16> <payload>` 成帧，
 *    MTProto 自己的 obfuscated2 层负责加密
 * 3. 入站只剥 `17 03 03` 头，**不解密**
 * 4. 握手后完全不再走 AES —— 所以不能复用父类的 `_encrypt` / `_decrypt`
 */
'use strict';

const { Buffer } = require('buffer');
const crypto = require('crypto');

const faketls = require('./mtproxy-faketls');

/** Node/RN 通用的 HMAC-SHA256。优先用 node:crypto（RN 里由 shim 提供）。 */
function hmacSha256(key, data) {
  if (crypto && typeof crypto.createHmac === 'function') {
    return Buffer.from(crypto.createHmac('sha256', key).update(data).digest());
  }
  // 兜底：@noble/hashes（RN 里 crypto shim 没提供 createHmac 时走这里）
  const { hmac } = require('@noble/hashes/hmac');
  const { sha256 } = require('@noble/hashes/sha256');
  return Buffer.from(hmac(sha256, key, data));
}

/**
 * 把 `ee + 16 字节密钥 + 域名` 的拼接串解成 { key, domain }。
 *
 * 官方格式（ConnectionSocket.cpp:193-196）：
 *   secret[0] == 0xee → key = secret[1..17]，domain = secret[17..]（无长度字节）
 *
 * 但实测不少服务商给的是「base64 串」形式，且**开头正好也是 'ee'**
 * （例如 `eeNEgYdJvXrFGRMCIMJdCQ` 按 base64 解出 16 字节，
 * 首字节 0x79 而不是 0xee —— 那只是巧合，不是 ee 格式）。
 * 所以这里的判定必须严格：**解码后首字节必须是 0xee**，否则当 16 字节裸密钥。
 *
 * @param {string} secret 用户填的原始密钥（hex 或 base64）
 * @returns {{ key: Buffer, domain: string|null, mode: 'ee'|'raw16' }}
 */
function parseMtproxySecret(secret) {
  const trimmed = String(secret || '').trim();
  if (!trimmed) throw new Error('MTProxy 密钥为空');

  const isHex = /^[0-9a-fA-F]+$/.test(trimmed) && trimmed.length % 2 === 0;
  const raw = isHex ? Buffer.from(trimmed, 'hex') : Buffer.from(trimmed, 'base64');
  if (!raw.length) throw new Error(`MTProxy 密钥无法解析：${trimmed}`);

  // ee 模式：首字节 0xee 且后面至少还有 16 字节密钥
  if (raw[0] === 0xee && raw.length >= 17) {
    const key = Buffer.from(raw.subarray(1, 17));
    const domain = raw.length > 17 ? raw.subarray(17).toString('ascii') : null;
    return { key, domain, mode: 'ee' };
  }
  // dd 模式：交给 GramJS 自己的 obfuscated2 实现
  if (raw[0] === 0xdd && raw.length === 17) {
    return { key: Buffer.from(raw.subarray(1, 17)), domain: null, mode: 'raw16' };
  }
  if (raw.length === 16) {
    return { key: raw, domain: null, mode: 'raw16' };
  }
  throw new Error(
    `MTProxy 密钥长度不对：解码后 ${raw.length} 字节，应为 16（裸密钥）或 ≥17（ee + 密钥 + 域名）`,
  );
}

/** 判断一个密钥是不是 ee 模式（需要走 fake-TLS） */
function isFakeTlsSecret(secret) {
  try {
    return parseMtproxySecret(secret).mode === 'ee';
  } catch {
    return false;
  }
}

/**
 * 构造 fake-TLS 版的 MTProxyIO 类。
 *
 * 为什么不直接 `class FakeTlsMTProxyIO extends MTProxyIO`：
 * 我们要把 MTProxyIO 作为**参数**传进来（GramJS 的内部路径不适合写进
 * 被测模块的顶层 require），同时保留父类里 `dd` 模式的整套逻辑作为降级路径。
 *
 * @param {Function} MTProxyIO GramJS 的 network/connection/TCPMTProxy 里的 MTProxyIO
 * @param {object}   [deps]    注入便于测试
 * @returns {Function} 可直接赋给 `connection.ObfuscatedIO` 的类
 */
function createFakeTlsMTProxyIO(MTProxyIO, deps = {}) {
  const buildHello = deps.buildClientHello || faketls.buildClientHello;
  const fillRandom = deps.fillClientRandom || faketls.fillClientRandom;
  const verifyServer = deps.verifyServerHello || faketls.verifyServerHello;
  const wrap = deps.wrapRecord || faketls.wrapRecord;
  const isAppData = deps.isAppDataRecord || faketls.isAppDataRecord;
  const readLen = deps.readRecordLength || faketls.readRecordLength;
  const maxPayload =
    deps.maxRecordPayload === undefined ? faketls.MAX_RECORD_PAYLOAD : deps.maxRecordPayload;
  const hmac = deps.hmacSha256 || hmacSha256;
  const now = deps.now || (() => Math.floor(Date.now() / 1000));
  const rand = deps.randomBytes || ((n) => Buffer.from(crypto.randomBytes(n)));

  return class FakeTlsMTProxyIO extends MTProxyIO {
    constructor(connection) {
      super(connection);
      /** 握手是否已完成（完成前 write 要走握手路径） */
      this._handshakeDone = false;
      /** 服务端残留的半条 record */
      this._recvTail = Buffer.alloc(0);
      /** 我们发出去的 client_random（ServerHello 校验要用） */
      this._clientRandom = null;
      /** 解密后的业务字节缓冲（read(n) 从这里取） */
      this._plain = Buffer.alloc(0);
    }

    /**
     * 握手：发 ClientHello → 收 ServerHello → 校验 HMAC → 发 CCS/AppData 前缀。
     *
     * 注意 `this.connection` 是 GramJS 的 socket 包装（有 readExactly / write）。
     * 这里**不能**调用父类的 initHeader()：那套是 obfuscated2 的 64 字节随机头，
     * 服务端在 ee 模式下期待的是 TLS ClientHello，发错会直接被丢掉。
     */
    async initHeader() {
      const secretRaw = this._secret;
      const parsed = parseMtproxySecret(
        // GramJS 已经把用户填的密钥转成了 Buffer（hex 就按 hex 解，否则按 base64 解）。
        // 直接用 hex 字符串喂给 parseMtproxySecret 最保真：它内部的分支判定
        // 与用户原始输入无关，只看字节。
        Buffer.isBuffer(secretRaw) ? secretRaw.toString('hex') : String(secretRaw),
      );
      if (parsed.mode !== 'ee') {
        throw new Error('FakeTlsMTProxyIO 只处理 ee 模式；dd / 裸密钥请用 GramJS 默认实现');
      }

      const domain = this._domain || parsed.domain || this.connection.host || 'www.google.com';
      const hello = buildHello(domain, { randomBytes: rand });
      fillRandom(hello, parsed.key, hmac, now());
      this._clientRandom = Buffer.from(hello.subarray(faketls.OFFSET_RANDOM, faketls.OFFSET_RANDOM + 32));

      // ① 发 ClientHello
      this.connection.write(hello);

      // ② 收 ServerHello（含 5 字节 record 头 + 握手体）
      const head = await this.connection.readExactly(5);
      if (!isAppData(head) && !(head[0] === 0x16 && head[1] === 0x03)) {
        throw new Error(
          `fake-TLS 握手失败：服务端首个 record 类型是 0x${head[0].toString(16)}，` +
            '不是 TLS 握手（0x16）也不是应用数据（0x17）——很可能被转发到了真实上游',
        );
      }
      if (head[0] !== 0x16) {
        throw new Error('fake-TLS 握手失败：服务端没有返回 ServerHello（拿到的是应用数据）');
      }
      const body = await this.connection.readExactly(readLen(head));
      const serverHello = Buffer.concat([head, body]);

      // ③ 校验 HMAC —— 不校验就会把上游的 TLS 响应误判成握手成功
      if (!verifyServer(hello.subarray(faketls.OFFSET_RANDOM, faketls.OFFSET_RANDOM + 32), parsed.key, serverHello, hmac)) {
        throw new Error(
          'fake-TLS 握手失败：ServerHello 的 HMAC 不匹配。' +
            '说明对端没有用这个密钥做 MTProxy 校验（可能被转发到了真实上游，或密钥/域名不对）',
        );
      }

      // ④ 发 `14 03 03 00 01 01 17 03 03`（dummy CCS + 首个 AppData 头）
      this.connection.write(Buffer.from(faketls.POST_HANDSHAKE_PREFIX));
      this._handshakeDone = true;
    }

    /** 出站：把明文按 `17 03 03 <len16>` 成帧直传（不加密） */
    write(data) {
      if (!this._handshakeDone) {
        // 握手前不应该有业务数据；真出现就当成协议错误，别静默发出去
        throw new Error('fake-TLS 尚未完成握手，不能写业务数据');
      }
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
      for (const chunk of faketls.splitIntoRecords(buf, maxPayload)) {
        this.connection.write(wrap(chunk));
      }
    }

    /**
     * 入站：剥掉 `17 03 03` 头，把 payload 明文交给上层。
     *
     * 官方客户端在 2878 字节处会截断单条 record，所以必须能跨 record 拼包。
     */
    async read(n) {
      while (this._plain.length < n) {
        // 先补一条完整 record
        const head = await this.connection.readExactly(5);
        if (!isAppData(head)) {
          if (head[0] === 0x15) {
            const len = readLen(head);
            const alert = len ? await this.connection.readExactly(len) : Buffer.alloc(0);
            throw new Error(`fake-TLS 收到 TLS Alert：${Buffer.concat([head, alert]).toString('hex')}`);
          }
          if (head[0] === 0x14) {
            // ChangeCipherSpec：跳过，继续读
            const len = readLen(head);
            if (len) await this.connection.readExactly(len);
            continue;
          }
          throw new Error(`fake-TLS 收到意外的 record 类型 0x${head[0].toString(16)}`);
        }
        const len = readLen(head);
        const payload = len ? await this.connection.readExactly(len) : Buffer.alloc(0);
        this._plain = Buffer.concat([this._plain, payload]);
      }
      const out = this._plain.subarray(0, n);
      this._plain = this._plain.subarray(n);
      return Buffer.from(out);
    }
  };
}

/**
 * 把 fake-TLS IO 挂到连接实例上。
 *
 * @param {object} connection 一个 ConnectionTCPMTProxyAbridged 实例
 * @param {object} [deps]     透传给 createFakeTlsMTProxyIO；也可用 deps.impl 直接给类
 * @returns {boolean} 是否接管（false 表示这个密钥不需要 fake-TLS，走原逻辑）
 */
function attachFakeTlsIO(connection, deps = {}) {
  const secretHex = Buffer.isBuffer(connection._secret)
    ? connection._secret.toString('hex')
    : String(connection._secret || '');
  if (!isFakeTlsSecret(secretHex)) return false;

  const Base = connection.ObfuscatedIO;
  if (typeof Base !== 'function') {
    throw new Error('连接实例上没有 ObfuscatedIO，无法接管 fake-TLS');
  }
  const Impl = deps.impl || createFakeTlsMTProxyIO(Base, deps);
  connection.ObfuscatedIO = Impl;
  return true;
}

/**
 * 造一个「fake-TLS 版」的 ConnectionTCPMTProxyAbridged 子类。
 *
 * 为什么需要它：GramJS 在 `telegramBaseClient` 里看到 `proxy.MTProxy` 就
 * **自己** new 一个 `ConnectionTCPMTProxyAbridged`，我们拿不到那个实例。
 * 但它读取的是 `this._connection`（来自 clientParams.connection），
 * 所以把一个子类传进 clientParams.connection 就能拿到控制权。
 *
 * ⚠️ 时序很关键：`attachFakeTlsIO` 只能在**构造函数里**调用 ——
 * `ObfuscatedIO` 是在 `_initConn()`（即 `_connect()` 早期）里被实例化的，
 * 等 connect() 返回再换就已经晚了。
 *
 * @param {Function} ConnectionTCPMTProxyAbridged GramJS 的连接类
 * @param {object}   [deps] 透传给 createFakeTlsMTProxyIO
 * @returns {Function} 可直接作为 clientParams.connection 的类
 */
function createFakeTlsConnectionClass(ConnectionTCPMTProxyAbridged, deps = {}) {
  if (typeof ConnectionTCPMTProxyAbridged !== 'function') {
    throw new Error('需要 GramJS 的 ConnectionTCPMTProxyAbridged 构造函数');
  }
  return class FakeTlsConnectionTCPMTProxyAbridged extends ConnectionTCPMTProxyAbridged {
    constructor(params) {
      super(params);
      // 此时 this._secret / this.ObfuscatedIO 都已就绪（父类构造函数里赋的值）
      const takeover = deps.attach || attachFakeTlsIO;
      takeover(this, deps);
    }
  };
}

module.exports = {
  parseMtproxySecret,
  isFakeTlsSecret,
  createFakeTlsMTProxyIO,
  createFakeTlsConnectionClass,
  attachFakeTlsIO,
  hmacSha256,
};
