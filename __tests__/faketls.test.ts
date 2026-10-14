/**
 * fake-TLS（`ee` 模式）纯逻辑测试。
 *
 * 这些用例锁定的都是「读官方源码得出的、靠猜一定猜不到」的细节：
 *  - ClientHello 的 random 字段 = HMAC(secret, hello[random 清零])  + 时间戳异或
 *  - 紧凑版正好 517 字节，且所有长度字段自洽（record / handshake / SNI / ext）
 *  - cipher_suites 声明长度必须等于实际字节数（本项目曾在这里差 2 字节，
 *    导致服务端 get_sni_domain_info() 找不到 SNI）
 *  - 记录 payload **不加密**
 *  - ServerHello HMAC 校验（不校验就会把上游的 TLS Alert 误判成握手成功）
 */
import { createHmac } from 'crypto';

import {
  TLS_REQUEST_LENGTH,
  OFFSET_RANDOM,
  RANDOM_LEN,
  buildClientHello,
  fillClientRandom,
  verifyServerHello,
  wrapRecord,
  isAppDataRecord,
  isAlertRecord,
  readRecordLength,
  splitIntoRecords,
  pickFakeTlsDomain,
  POST_HANDSHAKE_PREFIX,
} from '../src/net/mtproxy-faketls';

// 项目 tsconfig 里 Buffer 解析成 DOM 版本，会丢掉 Node 的编码/位运算重载。
// 这里显式取 Node 的 Buffer 构造器，避免整片 tsc 报错。
const Buf: typeof Buffer = require('buffer').Buffer;

// RN 的 tsconfig 把 Buffer.alloc 声明成只收 1 个参数，
// 用这个包装把「带填充值」的写法收在一处，避免满文件 as any
const alloc = (size: number, fill = 0): Buffer =>
  (Buf.alloc as unknown as (n: number, f: number) => Buffer)(size, fill);

const SECRET = Buf.from('54ce330e4690cc297d2b031ff3f288b0', 'hex');
const DOMAIN = 'mt.akenai.click';

/** 固定随机源，保证用例可复现 */
function fixedRandom(seed = 1) {
  let x = seed;
  return (n: number): Buffer => {
    const b = Buf.alloc(n);
    for (let i = 0; i < n; i++) {
      x = (x * 1103515245 + 12345) & 0x7fffffff;
      b[i] = x & 0xff;
    }
    return b;
  };
}

const hmac = (key: Buffer, data: Buffer): Buffer =>
  createHmac('sha256', key).update(data).digest();

/** 按官方 get_sni_domain_info() 走一遍，返回域名或 null */
function extractSni(hello: Buffer): string | null {
  let pos = 11 + 32 + 1 + 32;
  const csLen = (hello[pos] << 8) | hello[pos + 1];
  pos += 2;
  pos += csLen + 4; // +2 扩展列表总长 +1 压缩方法长度 +1 压缩方法
  while (pos + 4 <= hello.length) {
    const id = (hello[pos] << 8) | hello[pos + 1];
    const el = (hello[pos + 2] << 8) | hello[pos + 3];
    pos += 4;
    if (id === 0) {
      const inner = (hello[pos] << 8) | hello[pos + 1];
      const typ = hello[pos + 2];
      const dl = (hello[pos + 3] << 8) | hello[pos + 4];
      if (inner !== el - 2 || typ !== 0 || dl !== el - 5) return null;
      return hello.subarray(pos + 5, pos + 5 + dl).toString('ascii');
    }
    pos += el;
  }
  return null;
}

describe('buildClientHello：紧凑版结构自洽', () => {
  const hello = buildClientHello(DOMAIN, { randomBytes: fixedRandom(), shuffle: false });

  it('紧凑版正好 517 字节（官方 Op::P() 补到 513 + 首部）', () => {
    expect(hello.length).toBe(TLS_REQUEST_LENGTH);
  });

  it('TLS record 头声明的长度与实际一致', () => {
    expect(hello[0]).toBe(0x16);
    expect(hello[1]).toBe(0x03);
    expect(readRecordLength(hello)).toBe(hello.length - 5);
  });

  it('handshake 头声明的长度与实际一致', () => {
    expect(hello[5]).toBe(0x01); // ClientHello
    const hsLen = (hello[6] << 16) | (hello[7] << 8) | hello[8];
    expect(hsLen).toBe(hello.length - 9);
  });

  it('random 字段初始为 0（留给 fillClientRandom 填）', () => {
    const rand = hello.subarray(OFFSET_RANDOM, OFFSET_RANDOM + RANDOM_LEN);
    expect(rand.equals(Buffer.alloc(32))).toBe(true);
  });

  it('cipher_suites 声明的长度等于实际字节数（差 2 字节会让 SNI 解析错位）', () => {
    const pos = 11 + 32 + 1 + 32;
    const declared = (hello[pos] << 8) | hello[pos + 1];
    // 声明长度后面的内容里，前 declared 字节都应是合法套件（GREASE 或 0x13xx/0xc0xx…）
    expect(declared % 2).toBe(0);
    expect(declared).toBeGreaterThan(0);
    // 声明长度之后紧跟压缩方法：长度=1、方法=null
    expect(hello[pos + 2 + declared]).toBe(1);
    expect(hello[pos + 3 + declared]).toBe(0);
  });

  it('SNI 能被官方解析逻辑还原出原域名', () => {
    expect(extractSni(hello)).toBe(DOMAIN);
  });

  it('扩展列表总长与实际相符', () => {
    const pos = 11 + 32 + 1 + 32;
    const csLen = (hello[pos] << 8) | hello[pos + 1];
    const extTotalAt = pos + 2 + csLen + 2;
    const extTotal = (hello[extTotalAt] << 8) | hello[extTotalAt + 1];
    const extStart = extTotalAt + 2;
    // 末尾还有 padding 扩展（id=0x0015），其内部长度会补到 517
    expect(extStart + extTotal).toBe(TLS_REQUEST_LENGTH);
  });

  it('域名超过 253 字节时明确报错，不做静默截断', () => {
    // 静默截断会得到一个「既不是原域名、也不是合法域名」的串，
    // 服务端按它去找未知域 → 表现出「格式没问题但连不上」，极难排查
    const long = `${'a'.repeat(300)}.com`;
    expect(() => buildClientHello(long, { randomBytes: fixedRandom(), shuffle: false })).toThrow(
      /过长/,
    );
  });

  it('略长的域名（仍在 253 以内）照样可用，且正好 517 字节', () => {
    const h = buildClientHello('a'.repeat(60) + '.example.com', {
      randomBytes: fixedRandom(),
      shuffle: false,
    });
    expect(h.length).toBe(TLS_REQUEST_LENGTH);
    expect(extractSni(h)).toBe('a'.repeat(60) + '.example.com');
  });

  it('空域名直接报错，不静默产出坏包', () => {
    expect(() => buildClientHello('')).toThrow(/伪装域名/);
    expect(() => buildClientHello(null as unknown as string)).toThrow(/伪装域名/);
  });
});

describe('buildClientHello：打乱扩展顺序后仍然可用', () => {
  it('打乱后 SNI 依然可解析，长度依然是 517', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const h = buildClientHello(DOMAIN, { randomBytes: fixedRandom(seed), shuffle: true });
      expect(h.length).toBe(TLS_REQUEST_LENGTH);
      expect(extractSni(h)).toBe(DOMAIN);
    }
  });
});

describe('fillClientRandom：官方 HMAC + 时间戳异或算法', () => {
  it('random[0..28] == HMAC(secret, hello-with-zeroed-random)[0..28]', () => {
    const hello = buildClientHello(DOMAIN, { randomBytes: fixedRandom(), shuffle: false });
    const ts = 1700000000;
    fillClientRandom(hello, SECRET, hmac, ts);

    const copy = Buffer.from(hello);
    copy.fill(0, OFFSET_RANDOM, OFFSET_RANDOM + RANDOM_LEN);
    const expected = hmac(SECRET, copy);

    expect(Buffer.from(hello.subarray(OFFSET_RANDOM, OFFSET_RANDOM + 28)).equals(
      expected.subarray(0, 28),
    )).toBe(true);
  });

  it('random[28..32] 与 HMAC 尾部异或后能还原出时间戳', () => {
    const hello = buildClientHello(DOMAIN, { randomBytes: fixedRandom(), shuffle: false });
    const ts = 1700000000;
    fillClientRandom(hello, SECRET, hmac, ts);

    const copy = Buffer.from(hello);
    copy.fill(0, OFFSET_RANDOM, OFFSET_RANDOM + RANDOM_LEN);
    const expected = hmac(SECRET, copy);

    const recovered = expected.readUInt32BE(28) ^ hello.readUInt32BE(OFFSET_RANDOM + 28);
    expect(recovered >>> 0).toBe(ts >>> 0);
  });

  it('填过 random 之后，SNI 仍然可解析（说明 HMAC 没有破坏结构）', () => {
    const hello = buildClientHello(DOMAIN, { randomBytes: fixedRandom(), shuffle: false });
    fillClientRandom(hello, SECRET, hmac, 1700000000);
    expect(extractSni(hello)).toBe(DOMAIN);
  });

  it('密钥长度不对直接报错', () => {
    const hello = buildClientHello(DOMAIN, { randomBytes: fixedRandom() });
    expect(() => fillClientRandom(hello, Buffer.alloc(15), hmac)).toThrow(/16 字节/);
  });

  it('HMAC 返回长度不对时报错，而不是静默写出半截数据', () => {
    const hello = buildClientHello(DOMAIN, { randomBytes: fixedRandom() });
    expect(() => fillClientRandom(hello, SECRET, () => Buffer.alloc(20))).toThrow(/32 字节/);
  });
});

describe('verifyServerHello：必须校验，否则会误判', () => {
  const clientRandom = alloc(32, 0x11);

  function fakeServerResponse(secret = SECRET) {
    const resp = alloc(132, 0xab);
    resp[0] = 0x16;
    resp[1] = 0x03;
    resp[2] = 0x03;
    resp.writeUInt16BE(127, 3);
    // 服务端生成顺序（net-tcp-rpc-ext-server.c:1233-1235）：
    //   sha256_hmac(secret, client_random ++ response, server_random);
    //   memcpy(response + 11, server_random, 32);
    // 即 MAC 覆盖的响应里 11..43 是「待填」状态，所以复现时要先清零再算。
    const blank = Buffer.from(resp);
    blank.fill(0, 11, 43);
    const mac = hmac(secret, Buffer.concat([clientRandom, blank]));
    mac.copy(resp, 11);
    return resp;
  }

  it('正确的 ServerHello 校验通过', () => {
    expect(verifyServerHello(clientRandom, SECRET, fakeServerResponse(), hmac)).toBe(true);
  });

  it('密钥不对 → 校验失败（这就是「被转发到上游」时会发生的事）', () => {
    const other = alloc(16, 0x22);
    expect(verifyServerHello(clientRandom, other, fakeServerResponse(), hmac)).toBe(false);
  });

  it('响应被篡改一个字节 → 校验失败', () => {
    const resp = fakeServerResponse();
    resp[100] ^= 0x01;
    expect(verifyServerHello(clientRandom, SECRET, resp, hmac)).toBe(false);
  });

  it('响应太短直接返回 false，不抛错', () => {
    expect(verifyServerHello(clientRandom, SECRET, Buffer.alloc(10), hmac)).toBe(false);
  });

  it('client_random 长度不对报错', () => {
    expect(() => verifyServerHello(Buffer.alloc(16), SECRET, Buffer.alloc(64), hmac)).toThrow(
      /32 字节/,
    );
  });
});

describe('TLS 记录成帧：payload 明文直传', () => {
  it('wrapRecord 产出 17 03 03 + 长度 + 原文', () => {
    const payload = Buffer.from('deadbeef', 'hex');
    const rec = wrapRecord(payload);
    expect(rec.subarray(0, 5).toString('hex')).toBe('1703030004');
    expect(rec.subarray(5).toString('hex')).toBe('deadbeef');
    // 关键：payload 原样出现，没有任何加密
    expect(rec.subarray(5).equals(payload)).toBe(true);
  });

  it('post-handshake 前缀就是官方那 9 个字节', () => {
    expect(POST_HANDSHAKE_PREFIX.toString('hex')).toBe('140303000101170303');
  });

  it('记录类型判定', () => {
    expect(isAppDataRecord(Buffer.from('17030300', 'hex'))).toBe(true);
    expect(isAlertRecord(Buffer.from('15030300', 'hex'))).toBe(true);
    expect(isAppDataRecord(Buffer.from('16030300', 'hex'))).toBe(false);
    expect(isAlertRecord(Buffer.from('16030300', 'hex'))).toBe(false);
  });

  it('splitIntoRecords 首条吃满 2878 字节', () => {
    const payload = alloc(2878 * 2 + 5, 1);
    const parts = splitIntoRecords(payload);
    expect(parts.length).toBe(3);
    expect(parts[0].length).toBe(2878);
    expect(parts[1].length).toBe(2878);
    expect(parts[2].length).toBe(5);
    expect(Buffer.concat(parts).equals(payload)).toBe(true);
  });

  it('空 payload 也返回一条空记录，不会返回空数组', () => {
    expect(splitIntoRecords(Buffer.alloc(0)).length).toBe(1);
  });
});

describe('pickFakeTlsDomain：域名在 ee 密钥尾巴里，没有长度字节', () => {
  it('从裸域名尾巴里取域名', () => {
    const tail = Buffer.from('mt.akenai.click', 'ascii');
    expect(pickFakeTlsDomain(tail)).toBe('mt.akenai.click');
  });

  it('前面带一个分隔字节时也能取到（有些服务商这么拼）', () => {
    const tail = Buffer.from('\x0fmt.akenai.click', 'latin1');
    expect(pickFakeTlsDomain(tail)).toBe('mt.akenai.click');
  });

  it('取不出域名时回退到给定主机名', () => {
    expect(pickFakeTlsDomain(Buffer.alloc(0), 'fallback.example')).toBe('fallback.example');
    expect(pickFakeTlsDomain(Buffer.from('abc'), 'fallback.example')).toBe('fallback.example');
  });

  it('完全没有可回退值时给一个安全的默认域名', () => {
    expect(pickFakeTlsDomain(Buffer.alloc(0))).toBe('www.google.com');
  });
});
