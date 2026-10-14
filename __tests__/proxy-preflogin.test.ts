/**
 * 登录前「这份代理配置会不会生效」的判断。
 *
 * 为什么单独测这个：登录页新增了网络与代理入口，
 * 而登录前没有客户端，不能用 proxyActuallyInUse()（它读传输层实时状态，
 * 登录前恒为 false）。真正要回答的是"建连时会不会走代理"，
 * 由 describePreLoginNetwork() 依据设置本身算出。
 *
 * 这个函数刻意放在 settings.ts（不 import react-native / telegram），
 * 所以能被 jest 直接加载——transport.ts 那条路会拉进 GramJS，测不了。
 */
import {
  DEFAULT_SETTINGS,
  describePreLoginNetwork,
  describeProxyTarget,
  extractBareMtproxySecret,
  proxyKindLabel,
  proxyKindSupported,
  proxyNeedsSecret,
  proxySupportsTransport,
  validateProxy,
  validateProxySecret,
  type ProxyKind,
  type ProxySetting,
  type TransportKind,
} from '../src/settings';

function proxy(overrides: Partial<ProxySetting> = {}): ProxySetting {
  return { ...DEFAULT_SETTINGS.proxy, enabled: true, host: '127.0.0.1', port: '1080', ...overrides };
}

/** 图 2/3 里那个真实密钥，用来验证官方那种密钥能被接受 */
const REAL_SECRET = '0e45caf3bbce0d8d995cfb919fa9d61a';

/**
 * 现实里服务商给的 `ee` 拼接串（端到端实测可用，能真的从 Telegram 拿回 ResPQ）。
 * 结构是 ee + 16 字节密钥 + 后面跟域名/填充，GramJS 不认这种格式，
 * 必须由 extractBareMtproxySecret 裁出中间 16 字节。
 */
const EE_SECRET_HEX = 'ee68d6a83140657a1c7bf8e64d98ce9432786170692e6f7a6f6e2e7275';
const EE_SECRET_HEX_BARE = '68d6a83140657a1c7bf8e64d98ce9432';
/** 另一个 ee 拼接串样本，用来证明裁剪规则不是给某一个字符串写死的 */
const EE_SECRET_HEX2 = 'ee54ce330e4690cc297d2b031ff3f288b06d742e616b656e61692e636c69636b';
const EE_SECRET_HEX2_BARE = '54ce330e4690cc297d2b031ff3f288b0';

describe('describePreLoginNetwork', () => {
  it('未启用代理：直连，并提示去配置', () => {
    const hint = describePreLoginNetwork('tcp', proxy({ enabled: false }));
    expect(hint.willUseProxy).toBe(false);
    expect(hint.warning).toBeNull();
    expect(hint.message).toContain('直连');
    expect(hint.message).toContain('去配置');
  });

  it('TCP + 启用代理：判定会走代理，并把地址端口写进提示', () => {
    const hint = describePreLoginNetwork('tcp', proxy({ port: '1081' }));
    expect(hint.willUseProxy).toBe(true);
    expect(hint.warning).toBeNull();
    expect(hint.message).toContain('SOCKS5');
    expect(hint.message).toContain('127.0.0.1:1081');
  });

  it('WebSocket 通道：判定不会走代理，并提示要切回 TCP', () => {
    const hint = describePreLoginNetwork('wss', proxy());
    expect(hint.willUseProxy).toBe(false);
    expect(hint.warning).toContain('WebSocket');
    expect(hint.message).toContain('TCP');
  });

  it('地址为空：判定退回直连，warning 给出原因', () => {
    const hint = describePreLoginNetwork('tcp', proxy({ host: '  ' }));
    expect(hint.willUseProxy).toBe(false);
    expect(hint.warning).toContain('地址');
    expect(hint.message).toContain('退回直连');
  });

  it('端口越界：同样退回直连', () => {
    const hint = describePreLoginNetwork('tcp', proxy({ port: '99999' }));
    expect(hint.willUseProxy).toBe(false);
    expect(hint.warning).toContain('端口');
  });

  it('关掉代理时即使地址是空的也不算错误（不该拦着用户保存）', () => {
    const hint = describePreLoginNetwork('tcp', proxy({ enabled: false, host: '', port: '' }));
    expect(hint.willUseProxy).toBe(false);
    expect(hint.warning).toBeNull();
  });

  it('http / socks4 通道也判为会走代理', () => {
    for (const kind of ['http', 'socks4'] as const) {
      const hint = describePreLoginNetwork('tcp', proxy({ kind }));
      expect(hint.willUseProxy).toBe(true);
      expect(hint.message).toContain(kind.toUpperCase());
    }
  });

  it('提示里的地址两端空格会被去掉', () => {
    const hint = describePreLoginNetwork('tcp', proxy({ host: '  proxy.example.com  ' }));
    expect(hint.message).toContain('proxy.example.com:1080');
    // 不应出现双空格这种脏格式
    expect(hint.message).not.toContain('  proxy');
  });
});

describe('proxySupportsTransport', () => {
  it('TCP 支持代理', () => {
    expect(proxySupportsTransport(proxy(), 'tcp')).toBe(true);
  });

  it('WebSocket 不支持代理', () => {
    expect(proxySupportsTransport(proxy(), 'wss')).toBe(false);
  });

  it('没启用代理时任何通道都算兼容', () => {
    const off: TransportKind[] = ['tcp', 'wss'];
    for (const transport of off) {
      expect(proxySupportsTransport(proxy({ enabled: false }), transport)).toBe(true);
    }
  });

  it('MTProxy 也只在 TCP 下可用（它不是隧道，但同样依赖 TCP 连接）', () => {
    expect(proxySupportsTransport(proxy({ kind: 'mtproxy', secret: REAL_SECRET }), 'tcp')).toBe(true);
    expect(proxySupportsTransport(proxy({ kind: 'mtproxy', secret: REAL_SECRET }), 'wss')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 对齐官方 App「代理信息」页的三种模式
// ---------------------------------------------------------------------------
describe('官方三种代理模式：数据模型与校验', () => {
  it('socks5 / socks4 / http 不要求密钥', () => {
    for (const kind of ['socks5', 'socks4', 'http'] as const) {
      expect(proxyNeedsSecret(kind)).toBe(false);
      expect(validateProxy(proxy({ kind }))).toBeNull();
    }
  });

  it('mtproxy 必须填密钥', () => {
    expect(proxyNeedsSecret('mtproxy')).toBe(true);
    expect(validateProxy(proxy({ kind: 'mtproxy' }))).toContain('密钥');
  });

  it('mtproxy 接受官方那种 32 位十六进制密钥', () => {
    expect(validateProxy(proxy({ kind: 'mtproxy', secret: REAL_SECRET }))).toBeNull();
  });

  it('mtproxy 接受 dd 开头的 34 位密钥（伪造 TLS 形式）', () => {
    expect(validateProxy(proxy({ kind: 'mtproxy', secret: `dd${REAL_SECRET}` }))).toBeNull();
  });

  it('mtproxy 拒绝长度不对的十六进制密钥', () => {
    expect(validateProxy(proxy({ kind: 'mtproxy', secret: 'abcd' }))).toContain('32 位');
  });

  it('mtproxy 接受 base64 形式且解码后正好 16 字节', () => {
    const b64 = Buffer.from(new Uint8Array(16).fill(0x7f)).toString('base64');
    expect(validateProxy(proxy({ kind: 'mtproxy', secret: b64 }))).toBeNull();
  });

  it('mtproxy 拒绝解码后不是 16 字节的 base64', () => {
    const tooLong = Buffer.from(new Uint8Array(32).fill(0x7f)).toString('base64');
    expect(validateProxy(proxy({ kind: 'mtproxy', secret: tooLong }))).toContain('16 字节');
  });

  it('web 模式明确判为不支持，且给出可读原因', () => {
    expect(proxyKindSupported('web')).toBe(false);
    const err = validateProxy(proxy({ kind: 'web' }));
    expect(err).toContain('WEB 代理');
    expect(err).toContain('无法支持');
  });

  it('web 模式不校验端口（官方界面就没有端口字段）', () => {
    // 故意留空端口：不该因此报端口错
    const err = validateProxy(proxy({ kind: 'web', port: '' }));
    expect(err ?? '').not.toContain('端口');
  });

  it('其余四种模式都判为支持', () => {
    for (const kind of ['socks5', 'socks4', 'http', 'mtproxy'] as const) {
      expect(proxyKindSupported(kind)).toBe(true);
    }
  });

  it('关掉代理时即使模式不支持也不报错（不该拦着用户保存）', () => {
    expect(validateProxy(proxy({ kind: 'web', enabled: false }))).toBeNull();
  });
});

describe('validateProxySecret 边界', () => {
  it('空密钥给出「去链接里找」的引导，而不是干巴巴的"格式错误"', () => {
    const err = validateProxySecret('');
    expect(err).toBeTruthy();
    expect(err).toContain('密钥');
  });

  it('含有非法字符的密钥被拒', () => {
    expect(validateProxySecret('not-a-valid-secret!!')).toContain('格式');
  });

  it('两端空白会被容忍', () => {
    expect(validateProxySecret(`  ${REAL_SECRET}  `)).toBeNull();
  });
});

/**
 * 现实世界里的 `ee` 拼接串。
 *
 * 起因：用户连着给了几个"实测可用"的代理，密钥全是
 *   ee + <16 字节密钥> + <域名>
 * 这种拼接形式，直接粘进 GramJS 会抛
 * 「MTProxy secret must be a hex-string representing 16 bytes」。
 * 所以要有能力自动裁出中间那 16 字节，否则用户配了也连不上。
 *
 * 这里的期望值不是从被测代码反推的，而是先手工解码、再用真实 GramJS
 * 端到端连过（能从 DC2 拿回 ResPQ）之后定下来的。
 */
describe('extractBareMtproxySecret：裁剪 ee 拼接串', () => {
  it('从 ee 拼接串里裁出中间 16 字节', () => {
    expect(extractBareMtproxySecret(EE_SECRET_HEX)).toBe(EE_SECRET_HEX_BARE);
  });

  it('换一个拼接串同样能裁（规则不是给单个字符串写死的）', () => {
    expect(extractBareMtproxySecret(EE_SECRET_HEX2)).toBe(EE_SECRET_HEX2_BARE);
  });

  it('裁出来的长度正好 32 位 hex，能直接被 GramJS 接受', () => {
    const bare = extractBareMtproxySecret(EE_SECRET_HEX);
    expect(bare).not.toBeNull();
    expect(bare).toHaveLength(32);
    // 裁完必须能通过校验，否则 UI 会一边放行一边报错
    expect(validateProxySecret(bare as string)).toBeNull();
  });

  it('原本就合法的密钥不会被乱裁', () => {
    expect(extractBareMtproxySecret(REAL_SECRET)).toBeNull();
    expect(extractBareMtproxySecret(`dd${REAL_SECRET}`)).toBeNull();
  });

  it('不认识的形式一律返回 null，绝不猜', () => {
    // 猜错会得到"格式合法但连不上"的假成功，比直接报错更难排查
    expect(extractBareMtproxySecret('')).toBeNull();
    expect(extractBareMtproxySecret('zzzz')).toBeNull();
    expect(extractBareMtproxySecret('ee')).toBeNull();
    expect(extractBareMtproxySecret('ee12')).toBeNull();
  });

  it('ee 开头的 base64 拼接串也能裁', () => {
    // ee + 16 字节 + 域名，整体做 base64
    const raw = Buffer.from(EE_SECRET_HEX, 'hex');
    const b64 = raw.toString('base64');
    expect(extractBareMtproxySecret(b64)).toBe(EE_SECRET_HEX_BARE);
  });

  it('ee 拼接串能通过 validateProxy，用户不会再被拦下', () => {
    expect(validateProxySecret(EE_SECRET_HEX)).toBeNull();
    expect(validateProxy(proxy({ kind: 'mtproxy', secret: EE_SECRET_HEX, host: 'a03.lovely.lat', port: '853' }))).toBeNull();
  });
});

describe('proxyKindLabel / describeProxyTarget', () => {
  it('每种类型都有中文名，且不是空串或 undefined 字样', () => {
    const kinds: ProxyKind[] = ['socks5', 'socks4', 'http', 'mtproxy', 'web'];
    for (const kind of kinds) {
      const label = proxyKindLabel(kind);
      expect(typeof label).toBe('string');
      expect(label.length).toBeGreaterThan(0);
      // 标签会被直接拼进界面文案，混进 "undefined" 说明有分支漏了
      expect(label).not.toContain('undefined');
    }
  });

  it('mtproxy / web 的中文名与官方界面一致', () => {
    expect(proxyKindLabel('mtproxy')).toBe('MTProto 代理');
    expect(proxyKindLabel('web')).toBe('WEB 代理');
  });

  it('普通模式拼成 host:port', () => {
    expect(describeProxyTarget(proxy({ host: 'app.sosun4ik.top', port: '443' })))
      .toBe('app.sosun4ik.top:443');
  });

  it('web 模式不拼端口（官方界面没有端口）', () => {
    expect(describeProxyTarget(proxy({ kind: 'web', host: 'app.sosun4ik.top', port: '' })))
      .toBe('app.sosun4ik.top');
  });

  it('地址为空时给占位符，不留出 ":" 这种脏尾巴', () => {
    expect(describeProxyTarget(proxy({ host: '   ' }))).toBe('(未填写)');
  });
});

describe('登录前提示覆盖新的代理模式', () => {
  it('mtproxy 会判为走代理，且提示里是「MTProto 代理」而不是生硬的 MTPROXY', () => {
    const hint = describePreLoginNetwork('tcp', proxy({ kind: 'mtproxy', secret: REAL_SECRET }));
    expect(hint.willUseProxy).toBe(true);
    expect(hint.warning).toBeNull();
    expect(hint.message).toContain('MTProto 代理');
    expect(hint.message).toContain('127.0.0.1:1080');
  });

  it('mtproxy 缺密钥时判为退回直连', () => {
    const hint = describePreLoginNetwork('tcp', proxy({ kind: 'mtproxy', secret: '' }));
    expect(hint.willUseProxy).toBe(false);
    expect(hint.warning).toContain('密钥');
  });

  it('web 模式判为不会生效，并说明原因', () => {
    const hint = describePreLoginNetwork('tcp', proxy({ kind: 'web' }));
    expect(hint.willUseProxy).toBe(false);
    expect(hint.warning).toContain('WEB 代理');
    expect(hint.message).toContain('退回直连');
  });
});
