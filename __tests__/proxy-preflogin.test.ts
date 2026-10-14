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
  proxySupportsTransport,
  type ProxySetting,
  type TransportKind,
} from '../src/settings';

function proxy(overrides: Partial<ProxySetting> = {}): ProxySetting {
  return { ...DEFAULT_SETTINGS.proxy, enabled: true, host: '127.0.0.1', port: '1080', ...overrides };
}

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
});
