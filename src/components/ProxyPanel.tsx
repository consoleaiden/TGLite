/**
 * 代理 / 传输通道配置面板（登录前与登录后共用）。
 *
 * 为什么要抽出来：
 *   登录页也必须有代理入口——否则在没有代理就打不开 Telegram 的网络里，
 *   用户连登录页都过不去，等于整个 App 不可用。
 *
 * 两处唯一的差别是「保存之后做什么」：
 *   - 登录后（设置页）：要断开旧连接、用新配置重连 —— reconnectClient()
 *   - 登录前（登录页）：还没有客户端，只把配置落盘，
 *     等用户点「获取验证码」时 createClient() 会自动读取（它在构造时就取设置）
 *
 * 所以这里把保存动作做成外部注入的 onCommit，面板本身只负责编辑与校验。
 */
import React, { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import Button from './Button';
import Switch from './Switch';
import TextField from './TextField';
import { testProxy, transportLabel } from '../net/transport';
import type { ProxyKind, ProxySetting, TransportKind } from '../settings';
import { validateProxy } from '../settings';
import { colors, radius, spacing } from '../theme';

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

const PROXY_KINDS: Array<{ value: ProxyKind; title: string }> = [
  { value: 'socks5', title: 'SOCKS5' },
  { value: 'socks4', title: 'SOCKS4' },
  { value: 'http', title: 'HTTP' },
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

  const conflict = transport === 'wss' && proxy.enabled;
  const dirty =
    transport !== initialTransport || JSON.stringify(proxy) !== JSON.stringify(initialProxy);

  function patchProxy(patch: Partial<ProxySetting>) {
    setProxy((prev) => ({ ...prev, ...patch }));
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
        'WebSocket 通道由系统网络栈直接发起连接，自研的 SOCKS / HTTP 隧道插不进去。\n\n请二选一：关闭代理，或把通道切回 TCP。',
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
          TCP 挂掉时切到 WebSocket 通常能救回来；两者都是 Telegram 官方支持的传输层，不会影响账号安全。
        </Text>
      </View>

      <View style={styles.card}>
        <View style={styles.switchRow}>
          <View style={styles.switchText}>
            <Text style={styles.cardTitle}>启用代理</Text>
            <Text style={styles.switchHint}>只作用于 TCP 通道</Text>
          </View>
          <Switch
            value={proxy.enabled}
            onChange={(value) => !locked && patchProxy({ enabled: value })}
          />
        </View>

        <View style={styles.kindRow}>
          {PROXY_KINDS.map((item) => {
            const selected = proxy.kind === item.value;
            return (
              <Pressable
                key={item.value}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                disabled={!proxy.enabled || locked}
                onPress={() => patchProxy({ kind: item.value })}
                style={[
                  styles.kindChip,
                  selected ? styles.kindChipSelected : null,
                  !proxy.enabled ? styles.kindChipDisabled : null,
                ]}
              >
                <Text style={[styles.kindText, selected ? styles.kindTextSelected : null]}>
                  {item.title}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <TextField
          label="代理地址"
          value={proxy.host}
          onChangeText={(host) => patchProxy({ host })}
          placeholder="127.0.0.1 或 proxy.example.com"
          disabled={!proxy.enabled || locked}
        />
        <TextField
          label="端口"
          value={proxy.port}
          onChangeText={(port) => patchProxy({ port: port.replace(/[^0-9]/g, '') })}
          placeholder="1080"
          keyboardType="number-pad"
          maxLength={5}
          disabled={!proxy.enabled || locked}
        />
        <TextField
          label="用户名"
          value={proxy.username}
          onChangeText={(username) => patchProxy({ username })}
          placeholder="没有就留空"
          disabled={!proxy.enabled || locked}
        />
        <TextField
          label="密码"
          value={proxy.password}
          onChangeText={(password) => patchProxy({ password })}
          placeholder="没有就留空"
          secureTextEntry
          disabled={!proxy.enabled || locked}
        />

        {conflict ? (
          <Text style={styles.warn}>
            WebSocket 通道不支持自建代理。点保存时可以选择关闭代理，或把通道切回 TCP。
          </Text>
        ) : null}

        <Button
          label="测试连通性"
          variant="ghost"
          onPress={handleTest}
          loading={testing}
          disabled={!proxy.enabled || locked}
        />
        <Text style={styles.hint}>
          测试会把隧道直接建到 Telegram DC2（149.154.167.51:443），只验证握手，不发送任何账号信息。
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
