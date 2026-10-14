/**
 * 代理配置面板（登录前与登录后共用）。
 *
 * 版式对齐官方 App 的「代理信息」页：
 *   1. 顶部三选一：SOCKS5 代理 / MTProto / WEB 代理
 *   2. 中间是随类型变化的表单
 *        SOCKS5 代理 -> 服务器 / 端口 / 用户名 / 密码
 *        MTProto     -> 服务器 / 端口 / 密钥
 *        WEB 代理    -> 服务器 / 密钥
 *   3. 底部一段该模式的说明文字（官方也是这么做的，且不同模式文案不同）
 *
 * 为什么把「传输通道」也留在这一页：
 *   官方客户端没有"通道"概念（它内部自己选），但我们这个客户端把
 *   TCP / WebSocket 做成了可选项，而代理只在 TCP 下生效 —— 两者强耦合，
 *   分开两页会让用户配了代理却不知道为什么没生效。所以放在一起，
 *   并在冲突时给出明确提示。这一块放在代理配置之后，避免喧宾夺主。
 *
 * 两处调用方唯一的差别是「保存之后做什么」，由外部注入的 onCommit 决定：
 *   - 登录后（设置页）：断开旧连接、用新配置重连
 *   - 登录前（登录页）：还没有客户端，只把配置落盘
 */
import React, { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import Button from './Button';
import Switch from './Switch';
import TextField from './TextField';
import { testProxy, transportLabel } from '../net/transport';
import type { ProxyKind, ProxySetting, TransportKind } from '../settings';
import {
  proxyKindLabel,
  proxyKindSupported,
  proxyNeedsSecret,
  validateProxy,
} from '../settings';
import { colors, radius, spacing } from '../theme';

/** 三种代理类型，顺序与官方一致 */
const PROXY_MODES: Array<{ value: ProxyKind; title: string }> = [
  { value: 'socks5', title: 'SOCKS5 代理' },
  { value: 'mtproxy', title: 'MTProto' },
  { value: 'web', title: 'WEB 代理' },
];

/**
 * 每种模式的说明文字，照官方界面写。
 * 官方在 MTProto 下会专门提醒"可能显示赞助频道"，这一点必须保留 ——
 * 它直接关系到这个 App 的卖点（去广告），不能让用户以为不一致。
 *
 * 注意 socks4 / http 与 socks5 共用同一段（它们同属"自建代理"，
 * 官方也只给了 SOCKS5 一项），所以用映射函数而不是 Record，
 * 否则 Record<ProxyKind, string> 会要求补齐全部 5 个键。
 */
function modeNote(kind: ProxyKind): string {
  switch (kind) {
    case 'mtproxy':
      return (
        'MTProto 代理设置。\n\n' +
        '这个代理可能会在您的对话列表中显示其赞助频道。代理服务器无法泄露任何您的 Telegram 内容。'
      );
    case 'web':
      return (
        'WEB 代理通过私有 WebView 中的 HTTPS 页面运行，需要主机名（不含协议和路径）' +
        '和 16 字节 MTProxy 密钥。此概念验证需要最新版 Android System WebView，仅供前台测试。\n\n' +
        '⚠️ 本客户端没有这种私有 WebView 环境，暂时无法使用 WEB 代理，' +
        '请改用 SOCKS5 或 MTProto 代理。'
      );
    default:
      return (
        'SOCKS5 代理设置。填代理服务器地址与端口；代理要求认证时再填用户名与密码。' +
        '也支持 SOCKS4 与 HTTP CONNECT，可在下方切换具体协议。'
      );
  }
}

/** 自建代理细分的具体协议（官方把它折在 SOCKS5 那一项下，我们这里显式列出） */
const TUNNEL_KINDS: Array<{ value: ProxyKind; title: string }> = [
  { value: 'socks5', title: 'SOCKS5' },
  { value: 'socks4', title: 'SOCKS4' },
  { value: 'http', title: 'HTTP' },
];

const TRANSPORTS: Array<{ value: TransportKind; title: string; detail: string }> = [
  {
    value: 'tcp',
    title: 'TCP',
    detail: 'MTProto obfuscated2 over 裸 TCP 443，最稳，支持自定义代理。',
  },
  {
    value: 'wss',
    title: 'WebSocket',
    detail: 'MTProto over wss://<dc>:443/apiws，走系统网络栈，适合 TCP 被封的网络。',
  },
];

export interface ProxyPanelProps {
  /** 初始值：来自设置 store */
  initialTransport: TransportKind;
  initialProxy: ProxySetting;
  /**
   * 保存动作由调用方决定语义：
   *   - 登录页：只落盘，不重连
   *   - 设置页：落盘 + 重连
   * 抛错时面板会弹错误；返回字符串则作为成功提示显示在面板底部。
   */
  onCommit: (next: {
    transport: TransportKind;
    proxy: ProxySetting;
  }) => Promise<string | void>;
  /** 保存按钮的文案 */
  saveLabel?: string;
  /** 是否显示「实际使用」状态行（登录前没有已建立的连接，显示它没有意义） */
  showStatus?: boolean;
  /** 当前实际生效的摘要，仅 showStatus 为 true 时使用 */
  statusSummary?: string;
  statusWarning?: string | null;
  /** 是否禁用全部编辑（比如正在重连） */
  disabled?: boolean;
}

export default function ProxyPanel({
  initialTransport,
  initialProxy,
  onCommit,
  saveLabel = '保存',
  showStatus = false,
  statusSummary,
  statusWarning,
  disabled = false,
}: ProxyPanelProps) {
  const [transport, setTransport] = useState<TransportKind>(initialTransport);
  const [proxy, setProxy] = useState<ProxySetting>(initialProxy);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const conflict = transport === 'wss' && proxy.enabled && proxyKindSupported(proxy.kind);
  const dirty =
    transport !== initialTransport || JSON.stringify(proxy) !== JSON.stringify(initialProxy);

  const needsSecret = proxyNeedsSecret(proxy.kind);
  const usable = proxyKindSupported(proxy.kind);
  /** 表单是否可编辑：代理总开关关闭、或模式不可用时禁掉输入 */
  const formDisabled = !proxy.enabled || !usable || disabled || busy;

  function patchProxy(patch: Partial<ProxySetting>) {
    setProxy((prev) => ({ ...prev, ...patch }));
  }

  /**
   * 切换模式时清掉不适用的字段，避免把上一个模式的残值带过去。
   * 比如从 SOCKS5 切到 MTProto，用户名密码就没意义了；
   * 反过来切到 SOCKS5，密钥也不该留着 —— 否则用户会以为密钥生效了。
   * 服务器/端口是三种模式通用的，保留。
   */
  function selectMode(kind: ProxyKind) {
    setProxy((prev) => {
      if (prev.kind === kind) return prev;
      const next: ProxySetting = { ...prev, kind };
      if (proxyNeedsSecret(kind)) {
        next.username = '';
        next.password = '';
      } else {
        next.secret = '';
      }
      // WEB 代理官方界面里没有端口；切过去时不必清空，
      // 但切回来时也不该是空的 —— 给个空串让用户自己填，不做隐式默认
      return next;
    });
  }

  async function handleTest() {
    const invalid = validateProxy({ ...proxy, enabled: true });
    if (invalid) {
      Alert.alert('无法测试', invalid);
      return;
    }
    setTesting(true);
    try {
      const result = await testProxy(proxy);
      Alert.alert(result.ok ? '代理可用' : '代理不可用', result.message);
    } finally {
      setTesting(false);
    }
  }

  async function handleSave() {
    const invalid = proxy.enabled ? validateProxy(proxy) : null;
    if (invalid) {
      Alert.alert('代理配置有误', invalid);
      return;
    }

    if (conflict) {
      // WebSocket 通道由系统网络栈直接发起连接，自研隧道插不进去，必须二选一
      Alert.alert(
        '这个组合不可用',
        'WebSocket 通道由系统网络栈直接发起连接，代理插不进去。\n\n请二选一：关闭代理，或把通道切回 TCP。',
        [
          { text: '取消', style: 'cancel' },
          {
            text: '关闭代理并保存',
            onPress: () => runCommit({ transport, proxy: { ...proxy, enabled: false } }),
          },
        ],
      );
      return;
    }

    await runCommit({ transport, proxy });
  }

  async function runCommit(next: { transport: TransportKind; proxy: ProxySetting }) {
    setBusy(true);
    setNotice(null);
    try {
      const message = await onCommit(next);
      // 保存成功后把面板的基准值同步过来，dirty 状态才会归零；
      // 代理被自动关闭的情况也在这里对齐
      setTransport(next.transport);
      setProxy(next.proxy);
      if (typeof message === 'string') setNotice(message);
    } catch (err) {
      Alert.alert('保存失败', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const locked = disabled || busy;

  return (
    <>
      {showStatus ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>当前状态</Text>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>实际使用</Text>
            <Text style={styles.rowValue}>{statusSummary ?? transportLabel(transport)}</Text>
          </View>
          {statusWarning ? <Text style={styles.warn}>{statusWarning}</Text> : null}
        </View>
      ) : null}

      {/* ---- 1. 代理类型三选一（与官方「代理信息」页一致）---- */}
      <View style={styles.card}>
        <View style={styles.switchRow}>
          <View style={styles.switchText}>
            <Text style={styles.cardTitle}>代理</Text>
            <Text style={styles.switchHint}>
              {proxy.enabled ? `已启用 · ${proxyKindLabel(proxy.kind)}` : '当前为直连'}
            </Text>
          </View>
          <Switch
            value={proxy.enabled}
            onChange={(value) => !locked && patchProxy({ enabled: value })}
          />
        </View>

        <View style={styles.modeList}>
          {PROXY_MODES.map((item) => {
            const selected = proxy.kind === item.value || (
              // SOCKS5 那一项同时代表 socks4 / http（它们同属自建代理）
              item.value === 'socks5' && proxy.kind !== 'mtproxy' && proxy.kind !== 'web'
            );
            const supported = proxyKindSupported(item.value);
            return (
              <Pressable
                key={item.value}
                accessibilityRole="radio"
                accessibilityState={{ selected, disabled: !proxy.enabled || !supported || locked }}
                disabled={!proxy.enabled || locked}
                onPress={() => selectMode(item.value)}
                style={[
                  styles.modeRow,
                  selected ? styles.modeRowSelected : null,
                  !proxy.enabled ? styles.modeRowDisabled : null,
                ]}
              >
                <View style={styles.modeTextWrap}>
                  <Text style={[styles.modeTitle, selected ? styles.modeTitleSelected : null]}>
                    {item.title}
                  </Text>
                  {!supported ? (
                    <Text style={styles.modeBadge}>本客户端暂不支持</Text>
                  ) : null}
                </View>
                <View style={[styles.radioOuter, selected ? styles.radioOuterOn : null]}>
                  {selected ? <View style={styles.radioInner} /> : null}
                </View>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* ---- 2. 随类型变化的表单 ---- */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>{proxyKindLabel(proxy.kind)} 设置</Text>

        {!usable ? (
          <Text style={styles.warn}>{modeNote('web')}</Text>
        ) : null}

        {/* SOCKS5 一行还包含 SOCKS4 / HTTP，列出具体协议 */}
        {proxy.kind !== 'mtproxy' && usable ? (
          <View style={styles.kindRow}>
            {TUNNEL_KINDS.map((item) => {
              const selected = proxy.kind === item.value;
              return (
                <Pressable
                  key={item.value}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  disabled={formDisabled}
                  onPress={() => patchProxy({ kind: item.value })}
                  style={[
                    styles.kindChip,
                    selected ? styles.kindChipSelected : null,
                    formDisabled ? styles.kindChipDisabled : null,
                  ]}
                >
                  <Text style={[styles.kindText, selected ? styles.kindTextSelected : null]}>
                    {item.title}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        <TextField
          label="服务器"
          value={proxy.host}
          onChangeText={(host) => patchProxy({ host })}
          placeholder="app.sosun4ik.top 或 127.0.0.1"
          disabled={formDisabled}
        />

        {/* WEB 代理在官方界面里没有端口字段，这里跟着隐藏 */}
        {proxy.kind !== 'web' ? (
          <TextField
            label="端口"
            value={proxy.port}
            onChangeText={(port) => patchProxy({ port: port.replace(/[^0-9]/g, '') })}
            placeholder="443"
            keyboardType="number-pad"
            maxLength={5}
            disabled={formDisabled}
          />
        ) : null}

        {/* MTProto / WEB 用密钥；其余用用户名密码 */}
        {needsSecret ? (
          <TextField
            label="密钥"
            value={proxy.secret}
            onChangeText={(secret) => patchProxy({ secret: secret.replace(/\s/g, '') })}
            placeholder="32 位十六进制，或 dd 开头"
            hint="在代理服务商给的链接里，t.me/proxy?server=...&secret=... 的 secret 参数就是它。"
            disabled={formDisabled}
          />
        ) : (
          <>
            <TextField
              label="用户名"
              value={proxy.username}
              onChangeText={(username) => patchProxy({ username })}
              placeholder="没有就留空"
              disabled={formDisabled}
            />
            <TextField
              label="密码"
              value={proxy.password}
              onChangeText={(password) => patchProxy({ password })}
              placeholder="没有就留空"
              secureTextEntry
              disabled={formDisabled}
            />
          </>
        )}

        {conflict ? (
          <Text style={styles.warn}>
            WebSocket 通道不支持代理。点保存时可以选择关闭代理，或把通道切回 TCP。
          </Text>
        ) : null}

        <Button
          label="测试连通性"
          variant="ghost"
          onPress={handleTest}
          loading={testing}
          disabled={!proxy.enabled || !usable || locked}
        />
        <Text style={styles.hint}>
          {proxy.kind === 'mtproxy'
            ? 'MTProto 代理的完整握手要配合密钥派生，只能在真正连接时验证；这里先做密钥格式校验。'
            : '测试会把隧道直接建到 Telegram DC2（149.154.167.51:443），只验证握手，不发送任何账号信息。'}
        </Text>

        {/* 3. 模式说明：官方每个模式都有一段不同的说明文字 */}
        <Text style={styles.modeNote}>{modeNote(proxy.kind)}</Text>
      </View>

      {/* ---- 传输通道：仅作为高级项，代理生效依赖它 ---- */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>传输通道</Text>
        {TRANSPORTS.map((item) => {
          const selected = transport === item.value;
          return (
            <Pressable
              key={item.value}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              disabled={locked}
              onPress={() => setTransport(item.value)}
              style={[styles.option, selected ? styles.optionSelected : null]}
            >
              <View style={styles.optionText}>
                <Text style={[styles.optionTitle, selected ? styles.optionTitleSelected : null]}>
                  {item.title}
                </Text>
                <Text style={styles.optionDetail}>{item.detail}</Text>
              </View>
              <Text style={[styles.radio, selected ? styles.radioOn : null]}>
                {selected ? '●' : '○'}
              </Text>
            </Pressable>
          );
        })}
        <Text style={styles.hint}>
          代理只在 TCP 通道下生效；WebSocket 走系统网络栈，插不进代理。
        </Text>
      </View>

      <Button
        label={busy ? '处理中…' : saveLabel}
        onPress={handleSave}
        loading={busy}
        disabled={locked}
      />
      {notice ? (
        <View style={styles.noticeBox}>
          <Text style={styles.noticeText}>{notice}</Text>
        </View>
      ) : null}
      {dirty ? (
        <Text style={styles.footnote}>改动后需要点上面保存才会生效。</Text>
      ) : (
        <Text style={styles.footnote}>当前配置已保存。</Text>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  switchText: {
    flex: 1,
  },
  switchHint: {
    marginTop: 2,
    fontSize: 12,
    color: colors.textMuted,
  },
  // ---- 代理类型三选一 ----
  modeList: {
    marginTop: spacing.xs,
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: colors.bgAlt,
  },
  modeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  modeRowSelected: {
    backgroundColor: colors.primarySoft,
  },
  modeRowDisabled: {
    opacity: 0.5,
  },
  modeTextWrap: {
    flex: 1,
  },
  modeTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  modeTitleSelected: {
    color: colors.primaryDark,
  },
  modeBadge: {
    marginTop: 2,
    fontSize: 11,
    color: colors.danger,
  },
  // 官方那种空心圆选中态
  radioOuter: {
    width: 22,
    height: 22,
    borderRadius: radius.pill,
    borderWidth: 2,
    borderColor: colors.textFaint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOuterOn: {
    borderColor: colors.primary,
  },
  radioInner: {
    width: 11,
    height: 11,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
  },
  modeNote: {
    marginTop: spacing.xs,
    fontSize: 12,
    lineHeight: 18,
    color: colors.textMuted,
  },
  // ---- 细分协议 chip ----
  kindRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  kindChip: {
    flex: 1,
    height: 38,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  kindChipSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft,
  },
  kindChipDisabled: {
    opacity: 0.5,
  },
  kindText: {
    fontSize: 13,
    color: colors.textMuted,
  },
  kindTextSelected: {
    color: colors.primaryDark,
    fontWeight: '600',
  },
  // ---- 传输通道 ----
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  optionSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft,
  },
  optionText: {
    flex: 1,
  },
  optionTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  optionTitleSelected: {
    color: colors.primaryDark,
  },
  optionDetail: {
    marginTop: 2,
    fontSize: 12,
    lineHeight: 18,
    color: colors.textMuted,
  },
  radio: {
    fontSize: 18,
    color: colors.textFaint,
  },
  radioOn: {
    color: colors.primary,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.lg,
    paddingVertical: 3,
  },
  rowLabel: {
    fontSize: 14,
    color: colors.textMuted,
  },
  rowValue: {
    flex: 1,
    fontSize: 14,
    color: colors.text,
    textAlign: 'right',
  },
  warn: {
    fontSize: 12,
    lineHeight: 18,
    color: colors.danger,
  },
  hint: {
    fontSize: 12,
    lineHeight: 18,
    color: colors.textFaint,
  },
  footnote: {
    marginTop: spacing.sm,
    fontSize: 12,
    lineHeight: 18,
    color: colors.textFaint,
    textAlign: 'center',
  },
  noticeBox: {
    padding: spacing.md,
    borderRadius: radius.sm,
    backgroundColor: colors.primarySoft,
  },
  noticeText: {
    fontSize: 13,
    lineHeight: 19,
    color: colors.primaryDark,
  },
});
