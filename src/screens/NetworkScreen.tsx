import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Button from '../components/Button';
import Switch from '../components/Switch';
import TextField from '../components/TextField';
import type { RootStackParamList } from '../navigation';
import { proxyActuallyInUse, testProxy, transportLabel } from '../net/transport';
import type { ProxyKind, TransportKind } from '../settings';
import { useSettingsStore, validateProxy } from '../settings';
import { useAppStore } from '../store';
import { detachRealtime, attachRealtime } from '../boot';
import { lastTransport, reconnectClient } from '../tg/telegram';
import { colors, radius, spacing } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Network'>;

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

export default function NetworkScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const settings = useSettingsStore();

  const [transport, setTransport] = useState<TransportKind>(settings.transport);
  const [proxy, setProxy] = useState(settings.proxy);

  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const requestDialogsRefresh = useAppStore((state) => state.requestDialogsRefresh);
  const active = lastTransport();

  const conflict = transport === 'wss' && proxy.enabled;
  const dirty =
    transport !== settings.transport || JSON.stringify(proxy) !== JSON.stringify(settings.proxy);

  function patchProxy(patch: Partial<typeof proxy>) {
    setProxy((prev) => ({ ...prev, ...patch }));
  }

  async function handleTest() {
    const invalid = validateProxy({ ...proxy, enabled: true });
    if (invalid) {
      Alert.alert('无法测试', invalid);
      return;
    }
    setTesting(true);
    setStatus(null);
    try {
      const result = await testProxy(proxy);
      setStatus(result.message);
      Alert.alert(result.ok ? '代理可用' : '代理不可用', result.message);
    } finally {
      setTesting(false);
    }
  }

  function handleSave() {
    const invalid = proxy.enabled ? validateProxy(proxy) : null;
    if (invalid) {
      Alert.alert('代理配置有误', invalid);
      return;
    }
    if (conflict) {
      Alert.alert(
        '这个组合不可用',
        'WebSocket 通道由系统网络栈直接发起连接，自研的 SOCKS / HTTP 隧道插不进去。\n\n请二选一：关闭代理，或把通道切回 TCP。',
        [
          { text: '取消', style: 'cancel' },
          { text: '关闭代理并保存', onPress: () => commit({ ...proxy, enabled: false }) },
        ],
      );
      return;
    }
    commit(proxy);
  }

  async function commit(nextProxy: typeof proxy) {
    settings.setTransport(transport);
    settings.setProxy(nextProxy);
    setBusy(true);
    setStatus('正在用新配置重连…');
    try {
      detachRealtime();
      const plan = await reconnectClient();
      attachRealtime();
      requestDialogsRefresh();
      setStatus(`已重连：${plan.summary}`);
      if (plan.warning) {
        Alert.alert('注意', plan.warning);
      } else {
        Alert.alert('已生效', plan.summary);
      }
    } catch (err) {
      setStatus(null);
      Alert.alert(
        '重连失败',
        `${err instanceof Error ? err.message : String(err)}\n\n可以切回原来的配置再试一次。`,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.md }]}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.headerRow}>
        <Pressable accessibilityRole="button" onPress={() => navigation.goBack()} hitSlop={12}>
          <Text style={styles.back}>返回</Text>
        </Pressable>
        <Text style={styles.title}>网络与代理</Text>
        <View style={styles.backSpacer} />
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>当前状态</Text>
        <Row label="实际使用" value={active ? active.summary : transportLabel(settings.transport)} />
        <Row label="代理生效" value={proxyActuallyInUse() ? '是' : '否'} />
        {active?.warning ? <Text style={styles.warn}>{active.warning}</Text> : null}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>传输通道</Text>
        {TRANSPORTS.map((item) => {
          const selected = transport === item.value;
          return (
            <Pressable
              key={item.value}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              onPress={() => setTransport(item.value)}
              style={[styles.option, selected ? styles.optionSelected : null]}
            >
              <View style={styles.optionText}>
                <Text style={[styles.optionTitle, selected ? styles.optionTitleSelected : null]}>
                  {item.title}
                </Text>
                <Text style={styles.optionDetail}>{item.detail}</Text>
              </View>
              <Text style={[styles.radio, selected ? styles.radioOn : null]}>{selected ? '●' : '○'}</Text>
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
          <Switch value={proxy.enabled} onChange={(value) => patchProxy({ enabled: value })} />
        </View>

        <View style={styles.kindRow}>
          {PROXY_KINDS.map((item) => {
            const selected = proxy.kind === item.value;
            return (
              <Pressable
                key={item.value}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                disabled={!proxy.enabled}
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
          disabled={!proxy.enabled}
        />
        <TextField
          label="端口"
          value={proxy.port}
          onChangeText={(port) => patchProxy({ port: port.replace(/[^0-9]/g, '') })}
          placeholder="1080"
          keyboardType="number-pad"
          maxLength={5}
          disabled={!proxy.enabled}
        />
        <TextField
          label="用户名"
          value={proxy.username}
          onChangeText={(username) => patchProxy({ username })}
          placeholder="没有就留空"
          disabled={!proxy.enabled}
        />
        <TextField
          label="密码"
          value={proxy.password}
          onChangeText={(password) => patchProxy({ password })}
          placeholder="没有就留空"
          secureTextEntry
          disabled={!proxy.enabled}
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
          disabled={!proxy.enabled || busy}
        />
        <Text style={styles.hint}>
          测试会把隧道直接建到 Telegram DC2（149.154.167.51:443），只验证握手，不发送任何账号信息。
        </Text>
      </View>

      {status ? (
        <View style={styles.statusBox}>
          {busy ? <ActivityIndicator color={colors.primary} /> : null}
          <Text style={styles.statusText}>{status}</Text>
        </View>
      ) : null}

      <Button label={busy ? '重连中…' : '保存并重连'} onPress={handleSave} loading={busy} />
      {!dirty ? (
        <Text style={styles.footnote}>当前配置已保存。改动后才需要重新保存。</Text>
      ) : (
        <Text style={styles.footnote}>改动传输通道或代理后需要重连一次才会生效。</Text>
      )}
    </ScrollView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bgAlt,
  },
  content: {
    padding: spacing.lg,
    gap: spacing.md,
    paddingBottom: spacing.xl * 2,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  back: {
    fontSize: 15,
    color: colors.primary,
    minWidth: 52,
  },
  backSpacer: {
    minWidth: 52,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.text,
  },
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
  statusBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  statusText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 19,
    color: colors.textMuted,
  },
  footnote: {
    marginTop: spacing.sm,
    fontSize: 12,
    lineHeight: 18,
    color: colors.textFaint,
    textAlign: 'center',
  },
});
