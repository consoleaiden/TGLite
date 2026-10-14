import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import ProxyPanel from '../components/ProxyPanel';
import type { RootStackParamList } from '../navigation';
import { proxyActuallyInUse } from '../net/transport';
import { describePreLoginNetwork, useSettingsStore } from '../settings';
import { useAppStore } from '../store';
import { attachRealtime, detachRealtime } from '../boot';
import { lastTransport, reconnectClient } from '../tg/telegram';
import { colors, radius, spacing } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Network'>;

export default function NetworkScreen({ navigation, route }: Props) {
  const insets = useSafeAreaInsets();
  const settings = useSettingsStore();
  const requestDialogsRefresh = useAppStore((state) => state.requestDialogsRefresh);

  /** 从登录页进来时没有客户端，保存只能落盘，不能重连 */
  const preLogin = !!route.params?.preLogin;

  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const active = lastTransport();

  /**
   * 登录后保存：落盘 + 断开旧连接用新配置重连。
   * 登录前保存：只落盘 —— 随后用户点「获取验证码」时
   * createClient() 会在构造客户端时读取最新设置，代理自然生效。
   */
  async function commit(next: {
    transport: typeof settings.transport;
    proxy: typeof settings.proxy;
  }) {
    settings.setTransport(next.transport);
    settings.setProxy(next.proxy);

    if (preLogin) {
      setStatus('配置已保存，返回后即可用这份配置登录。');
      return '配置已保存。现在返回登录页获取验证码，就会走这个代理建连。';
    }

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
      // 抛出去让面板知道没成功，不会把 dirty 状态清掉
      throw err;
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

      <ProxyPanel
        initialTransport={settings.transport}
        initialProxy={settings.proxy}
        onCommit={commit}
        saveLabel={preLogin ? '保存配置' : busy ? '重连中…' : '保存并重连'}
        disabled={busy}
        showStatus={!preLogin}
        statusSummary={active ? active.summary : undefined}
        statusWarning={active?.warning}
      />

      {status ? (
        <View style={styles.statusBox}>
          {busy ? <ActivityIndicator color={colors.primary} /> : null}
          <Text style={styles.statusText}>{status}</Text>
        </View>
      ) : null}

      {preLogin ? (
        <Text style={styles.footnote}>
          当前是「登录前」配置：保存后立即生效于随后的登录请求（获取验证码时会按这份配置建连）。
          {' '}
          {describePreLoginNetwork(settings.transport, settings.proxy).message}
        </Text>
      ) : (
        <Text style={styles.footnote}>
          代理生效：{proxyActuallyInUse() ? '是' : '否'}。
          改动传输通道或代理后需要重连一次才会生效。
        </Text>
      )}
    </ScrollView>
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
