/**
 * fake-TLS 运行时接线层的测试。
 *
 * 重点验证三件事（都是"错了就会静默产生假绿灯"的地方）：
 *   1. 密钥判定必须严格 —— 开头恰好是 'ee' 的 base64 串不能被误判成 ee 模式
 *   2. initHeader 必须真的校验 ServerHello 的 HMAC，否则会把上游响应当成功
 *   3. read/write 必须只做 record 成帧、**不套 AES**（官方行为）
 *
 * 这里用假的 connection/socket 驱动，不需要网络。
 */
import { Buffer } from 'buffer';

// 项目 tsconfig 里 Buffer 解析成 DOM 版本，会丢掉 Node 的编码/位运算重载。
// 这里显式取 Node 的 Buffer 构造器，避免整片 tsc 报错。
const Buf: typeof Buffer = require('buffer').Buffer;

// RN 的 tsconfig 把 Buffer.alloc 声明成只收 1 个参数，
// 用这个包装把「带填充值」的写法收在一处，避免满文件 as any
const alloc = (size: number, fill = 0): Buffer =>
  (Buf.alloc as unknown as (n: number, f: number) => Buffer)(size, fill);

// eslint-disable-next-line @typescript-eslint/no-var-requires
const runtime = require('../src/net/mtproxy-faketls-runtime');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const faketls = require('../src/net/mtproxy-faketls');

const crypto = require('crypto');
const hmac = (key: Buffer, data: Buffer) => Buffer.from(crypto.createHmac('sha256', key).update(data).digest());

// ── 假 socket：GramJS 的 MTProxyIO 把 connection.socket 存成 this.connection ──
// 也就是说 IO 层直接用 socket 自己的 readExactly / write（见 TCPMTProxy.js 构造函数
// 里的 `this.connection = connection.socket`）。PromisedNetSockets 正是这个形状。
class FakeSocket {
  written: Buffer[] = [];
  chunks: Buffer[] = [];
  host = 'fake.example';

  write(data: Buffer) {
    this.written.push(Buffer.from(data));
  }

  /** 测试用：预置服务端要"发回来"的字节 */
  feed(data: Buffer) {
    this.chunks.push(Buffer.from(data));
  }

  /** 已缓冲字节数 */
  get available(): number {
    return this.chunks.reduce((s, c) => s + c.length, 0);
  }

  async readExactly(n: number): Promise<Buffer> {
    const total = this.chunks.reduce((s, c) => s + c.length, 0);
    if (total < n) {
      throw new Error(`FakeSocket 数据不足：需要 ${n} 字节，只有 ${total}`);
    }
    const all = Buffer.concat(this.chunks);
    const out = all.subarray(0, n);
    this.chunks = total > n ? [all.subarray(n)] : [];
    return Buffer.from(out);
  }
}

// ── 假 GramJS MTProxyIO：形状必须与 node_modules 里的一致 ────────────────────
// 真实实现的构造函数是：
//     this.connection = connection.socket;
//     this._packetClass = connection.PacketCodecClass;
//     this._secret = connection._secret;      ← 少抄这行就会让 subclass 拿不到密钥
//     this._dcId = connection._dcId;
class FakeMTProxyIO {
  header: Buffer | undefined;
  connection: any;
  _secret: any;
  _dcId: any;
  _packetClass: any;
  constructor(connection: any) {
    this.connection = connection.socket;
    this._packetClass = connection.PacketCodecClass;
    this._secret = connection._secret;
    this._dcId = connection._dcId;
  }
  async initHeader() {
    this.header = Buffer.alloc(64);
  }
  async read(n: number) {
    return this.connection.readExactly(n);
  }
  write(data: Buffer) {
    this.connection.write(data);
  }
}

/**
 * 造一个假连接。`_secret` 必须和 GramJS 的行为一致：
 *   TCPMTProxy 构造函数里 `proxy.secret.match(/^[0-9a-f]+$/i)` 决定按 hex 还是 base64 解。
 * 我们的 EE_SECRET 是纯十六进制，所以解出来就是 32 字节的 ee+key+domain。
 */
function makeConnection(secret: string) {
  const isHex = /^[0-9a-f]+$/i.test(secret);
  return {
    _secret: Buffer.from(secret, isHex ? 'hex' : 'base64'),
    _dcId: 2,
    ObfuscatedIO: FakeMTProxyIO as any,
    socket: new FakeSocket(),
  } as any;
}

/** 构造一个"正确"的 ServerHello（用同一个 secret 算 HMAC） */
function makeServerHello(clientRandom: Buffer, key16: Buffer, filler = 1) {
  const body = alloc(94, filler);
  body[0] = 0x16; // TLS record: handshake
  body[1] = 0x03;
  body[2] = 0x03;
  body.writeUInt16BE(89, 3);
  body[5] = 0x02; // ServerHello
  // 11..43 先留空（客户端校验时会先清零），算出 HMAC 再填回去
  body.fill(0, 11, 43);
  const mac = hmac(key16, Buffer.concat([clientRandom, body]));
  mac.copy(body, 11, 0, 32);
  return body;
}

/**
 * 让 initHeader 能跑完：先拦截 write 拿到真实发出去的 hello，
 * 再用它的 11..43 造一个合法 ServerHello 喂回去。
 */
function primeServerHello(conn: any, key16: Buffer) {
  let sentHello: Buffer | null = null;
  const origWrite = conn.socket.write.bind(conn.socket);
  conn.socket.write = (d: Buffer) => {
    if (!sentHello && d.length > 100) sentHello = Buffer.from(d);
    origWrite(d);
  };
  const origReadExactly = conn.socket.readExactly.bind(conn.socket);
  let served = false;
  conn.socket.readExactly = async (n: number) => {
    if (!served) {
      served = true;
      const cr = Buffer.from((sentHello as unknown as Buffer).subarray(11, 43));
      conn.socket.feed(makeServerHello(cr, key16));
    }
    return origReadExactly(n);
  };
  return () => sentHello;
}

const KEY16 = Buffer.from('54ce330e4690cc297d2b031ff3f288b0', 'hex');
/**
 * 实测服务商给的 ee 串：**整体是十六进制**，域名以 hex 字节的形式追加在密钥后面。
 *   ee 54ce…88b0 6d742e616b656e61692e636c69636b
 *     └ 0xee      └ 16 字节密钥          └ "mt.akenai.click" 的 ASCII 字节
 * 所以不能拿 `'ee' + key.toString('hex') + 'mt.akenai.click'` 拼
 * —— 那样域名是裸 ASCII，混进 hex 里就解不出来了。
 */
const EE_SECRET = 'ee54ce330e4690cc297d2b031ff3f288b06d742e616b656e61692e636c69636b';

describe('parseMtproxySecret —— 密钥判定', () => {
  it('ee + 16 字节密钥 + 域名 → ee 模式并切出域名', () => {
    const r = runtime.parseMtproxySecret(EE_SECRET);
    expect(r.mode).toBe('ee');
    expect(r.key.equals(KEY16)).toBe(true);
    expect(r.domain).toBe('mt.akenai.click');
  });

  it('ee 但只有 17 字节（无域名）→ 域名是 null', () => {
    const r = runtime.parseMtproxySecret(`ee${KEY16.toString('hex')}`);
    expect(r.mode).toBe('ee');
    expect(r.domain).toBeNull();
  });

  it('域名是裸 ASCII 混在 hex 里的串 → 解不出来就报错（不能瞎猜）', () => {
    // `ee` + key 的 hex + 裸 ASCII 域名：长度是奇数时连 hex 都解不了
    expect(() => runtime.parseMtproxySecret(`ee${KEY16.toString('hex')}mt.akenai.click`)).toThrow(
      /无法解析|长度不对/,
    );
  });

  it('裸 32 位十六进制（16 字节）→ raw16', () => {
    const r = runtime.parseMtproxySecret(KEY16.toString('hex'));
    expect(r.mode).toBe('raw16');
    expect(r.key.equals(KEY16)).toBe(true);
  });

  it('dd + 16 字节 → raw16（交给 GramJS 自己的 obfuscated2）', () => {
    const r = runtime.parseMtproxySecret(`dd${KEY16.toString('hex')}`);
    expect(r.mode).toBe('raw16');
  });

  it('★ 开头恰好是 "ee" 的 base64 串不能被误判成 ee 模式', () => {
    // `eeNEgYdJvXrFGRMCIMJdCQ` 是 22 字符 base64，解出 16 字节，首字节 0x79。
    // 它的前两个字符 "ee" 纯属巧合。若按 hex 解会得到 16 字节但首字节是 0xee，
    // 于是被误当成 ee 模式 → 握手必然失败。
    const r = runtime.parseMtproxySecret('eeNEgYdJvXrFGRMCIMJdCQ');
    expect(r.mode).toBe('raw16');
    expect(r.key.length).toBe(16);
    expect(r.key[0]).toBe(0x79);
  });

  it('非法长度（解码后 8 字节）报错', () => {
    expect(() => runtime.parseMtproxySecret('0011223344556677')).toThrow(/长度不对/);
  });

  it('空密钥报错', () => {
    expect(() => runtime.parseMtproxySecret('')).toThrow(/为空/);
  });
});

describe('isFakeTlsSecret', () => {
  it('ee 拼接串 → true', () => {
    expect(runtime.isFakeTlsSecret(EE_SECRET)).toBe(true);
  });
  it('裸十六进制 → false', () => {
    expect(runtime.isFakeTlsSecret(KEY16.toString('hex'))).toBe(false);
  });
  it('dd 前缀 → false', () => {
    expect(runtime.isFakeTlsSecret(`dd${KEY16.toString('hex')}`)).toBe(false);
  });
  it('base64 的 16 字节裸密钥 → false', () => {
    expect(runtime.isFakeTlsSecret('eeNEgYdJvXrFGRMCIMJdCQ')).toBe(false);
  });
});

describe('attachFakeTlsIO', () => {
  it('ee 密钥 → 接管 ObfuscatedIO', () => {
    const conn = makeConnection(EE_SECRET);
    expect(runtime.attachFakeTlsIO(conn)).toBe(true);
    expect(conn.ObfuscatedIO).not.toBe(FakeMTProxyIO);
  });

  it('裸密钥 → 不接管，保持 GramJS 原实现', () => {
    const conn = makeConnection(KEY16.toString('hex'));
    expect(runtime.attachFakeTlsIO(conn)).toBe(false);
    expect(conn.ObfuscatedIO).toBe(FakeMTProxyIO);
  });
});

describe('FakeTlsMTProxyIO.initHeader —— 握手', () => {
  it('正确 ServerHello → 握手通过，发出 ClientHello + 后握手前缀', async () => {
    const Impl = runtime.createFakeTlsMTProxyIO(FakeMTProxyIO as any);
    const conn = makeConnection(EE_SECRET);
    const io: any = new (Impl as any)(conn);

    const getHello = primeServerHello(conn, KEY16);
    await io.initHeader();

    const hello = getHello();
    expect(hello).not.toBeNull();
    // ClientHello：>= 517（含 padding），首字节 0x16（TLS handshake）
    expect(hello!.length).toBeGreaterThanOrEqual(517);
    expect(hello![0]).toBe(0x16);

    const all = Buffer.concat(conn.socket.written);
    // 末 9 字节必须是后握手前缀
    expect(all.subarray(all.length - 9).equals(faketls.POST_HANDSHAKE_PREFIX)).toBe(true);
    expect(io._handshakeDone).toBe(true);
    // client_random 必须等于真正发出去的 hello 的 11..43
    expect(io._clientRandom.equals(Buffer.from(hello!.subarray(11, 43)))).toBe(true);
  });

  it('★ ServerHello 的 HMAC 不对 → 必须抛错（不能当成握手成功）', async () => {
    const Impl = runtime.createFakeTlsMTProxyIO(FakeMTProxyIO as any);
    const conn = makeConnection(EE_SECRET);
    const io: any = new (Impl as any)(conn);

    // 用错误的密钥算 ServerHello → HMAC 必不匹配
    primeServerHello(conn, alloc(16, 0x11));
    await expect(io.initHeader()).rejects.toThrow(/HMAC 不匹配/);
    expect(io._handshakeDone).toBe(false);
  });

  it('服务端返回非 TLS 记录（被转发到上游）→ 抛错', async () => {
    const Impl = runtime.createFakeTlsMTProxyIO(FakeMTProxyIO as any);
    const conn = makeConnection(EE_SECRET);
    const io: any = new (Impl as any)(conn);
    conn.socket.feed(alloc(64, 0x48)); // "HHHH..." 不是 TLS

    await expect(io.initHeader()).rejects.toThrow(/被转发到了真实上游|不是 TLS/);
  });

  it('服务端回 0x17（应用数据而非 ServerHello）→ 抛错', async () => {
    const Impl = runtime.createFakeTlsMTProxyIO(FakeMTProxyIO as any);
    const conn = makeConnection(EE_SECRET);
    const io: any = new (Impl as any)(conn);
    // 合法的 ApplicationData record：17 03 03 <len16>
    conn.socket.feed(Buffer.concat([Buffer.from('1703030010', 'hex'), alloc(16, 0x41)]));

    await expect(io.initHeader()).rejects.toThrow(/没有返回 ServerHello/);
  });

  it('非 ee 密钥交给它 → 抛错（不该走到这里）', async () => {
    const Impl = runtime.createFakeTlsMTProxyIO(FakeMTProxyIO as any);
    // 裸 16 字节密钥：attachFakeTlsIO 不会接管，但如果有人硬塞进来必须报错
    const conn = makeConnection(KEY16.toString('hex'));
    const io: any = new (Impl as any)(conn);
    await expect(io.initHeader()).rejects.toThrow(/只处理 ee 模式/);
  });
});

describe('FakeTlsMTProxyIO.write —— 出站成帧', () => {
  function makeHandshaken(secret = EE_SECRET) {
    const Impl = runtime.createFakeTlsMTProxyIO(FakeMTProxyIO as any);
    const conn = makeConnection(secret);
    const io: any = new (Impl as any)(conn);
    io._handshakeDone = true;
    return { io, conn };
  }

  it('★ payload 明文直传，只加 17 03 03 头（不套 AES）', () => {
    const { io, conn } = makeHandshaken();
    const payload = Buffer.from('deadbeef', 'hex');
    io.write(payload);

    const out = Buffer.concat(conn.socket.written);
    expect(out.subarray(0, 5).toString('hex')).toBe('17030300 04'.replace(/ /g, ''));
    expect(out.subarray(5).toString('hex')).toBe('deadbeef');
    expect(out.length).toBe(9);
  });

  it('超过 2878 字节会拆成多条 record', () => {
    const { io, conn } = makeHandshaken();
    const payload = alloc(2878 * 2 + 10, 0x5a);
    io.write(payload);
    const out = Buffer.concat(conn.socket.written);
    // 每条 record 头 5 字节，共 3 条
    expect(out.length).toBe(payload.length + 5 * 3);
    let pos = 0;
    const lens: number[] = [];
    while (pos < out.length) {
      expect(out[pos]).toBe(0x17);
      const len = (out[pos + 3] << 8) | out[pos + 4];
      lens.push(len);
      pos += 5 + len;
    }
    expect(lens).toEqual([2878, 2878, 10]);
  });

  it('握手未完成就写业务数据 → 抛错（不静默发出）', () => {
    const Impl = runtime.createFakeTlsMTProxyIO(FakeMTProxyIO as any);
    const conn = makeConnection(EE_SECRET);
    const io: any = new (Impl as any)(conn);
    expect(() => io.write(Buffer.from([1, 2, 3]))).toThrow(/尚未完成握手/);
  });
});

describe('FakeTlsMTProxyIO.read —— 入站剥壳', () => {
  function makeHandshaken(secret = EE_SECRET) {
    const Impl = runtime.createFakeTlsMTProxyIO(FakeMTProxyIO as any);
    const conn = makeConnection(secret);
    const io: any = new (Impl as any)(conn);
    io._handshakeDone = true;
    return { io, conn };
  }

  it('★ 剥掉 17 03 03 头后返回明文，不做解密', async () => {
    const { io, conn } = makeHandshaken();
    const payload = Buffer.from('cafebabe', 'hex');
    conn.socket.feed(Buffer.concat([Buffer.from('1703030004', 'hex'), payload]));
    const got = await io.read(4);
    expect(got.toString('hex')).toBe('cafebabe');
  });

  it('跨多条 record 拼包', async () => {
    const { io, conn } = makeHandshaken();
    conn.socket.feed(Buffer.concat([Buffer.from('1703030003', 'hex'), Buffer.from('aabbcc', 'hex')]));
    conn.socket.feed(Buffer.concat([Buffer.from('1703030003', 'hex'), Buffer.from('ddeeff', 'hex')]));
    const got = await io.read(6);
    expect(got.toString('hex')).toBe('aabbccddeeff');
  });

  it('遇到 TLS Alert(0x15) 抛错', async () => {
    const { io, conn } = makeHandshaken();
    conn.socket.feed(Buffer.from('15030300020232', 'hex'));
    await expect(io.read(1)).rejects.toThrow(/TLS Alert/);
  });

  it('遇到 ChangeCipherSpec(0x14) 会跳过', async () => {
    const { io, conn } = makeHandshaken();
    conn.socket.feed(Buffer.from('140303000101', 'hex'));
    conn.socket.feed(Buffer.concat([Buffer.from('1703030002', 'hex'), Buffer.from('abcd', 'hex')]));
    const got = await io.read(2);
    expect(got.toString('hex')).toBe('abcd');
  });
});

describe('createFakeTlsConnectionClass —— 接管时机', () => {
  /** 最小可用的"父类"，模拟 GramJS 的 ConnectionTCPMTProxyAbridged */
  class StubConn {
    _secret: any;
    ObfuscatedIO: any;
    _dcId = 2;
    socket = new FakeSocket();
    constructor({ secret }: any) {
      this._secret = Buffer.from(secret, 'hex');
      this.ObfuscatedIO = FakeMTProxyIO as any;
    }
  }

  it('构造时就把 ee 密钥的连接换成 fake-TLS IO', () => {
    const Impl = runtime.createFakeTlsConnectionClass(StubConn as any);
    const conn: any = new (Impl as any)({ secret: EE_SECRET });
    expect(conn.ObfuscatedIO).not.toBe(FakeMTProxyIO);
    // 新 IO 必须是我们那套（有 _handshakeDone 这个标志）
    const io: any = new conn.ObfuscatedIO(conn);
    expect(io._handshakeDone).toBe(false);
  });

  it('dd / 裸密钥的连接保持 GramJS 原实现（不接管）', () => {
    const Impl = runtime.createFakeTlsConnectionClass(StubConn as any);
    const conn: any = new (Impl as any)({ secret: KEY16.toString('hex') });
    expect(conn.ObfuscatedIO).toBe(FakeMTProxyIO);
  });

  it('传进去的不是构造函数时报错', () => {
    expect(() => runtime.createFakeTlsConnectionClass(null as any)).toThrow(/构造函数/);
  });
});
