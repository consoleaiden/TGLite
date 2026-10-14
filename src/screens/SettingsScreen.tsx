import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Button from '../components/Button';
import { APP_NAME, APP_VERSION } from '../config';
import type { RootStackParamList } from '../navigation';
import { useAppStore } from '../store';
import { detachRealtime } from '../boot';
import { getCredentials, humanizeAuthError, logout } from '../tg/telegram';
import { colors, radius, spacing } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Settings'>;

export default function SettingsScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const me = useAppStore((state) => state.me);
  const reset = useAppStore((state) => state.reset);
  const setMe = useAppStore((state) => state.setMe);
  const [busy, setBusy] = useState(false);

  const creds = getCredentials();

  async function handleLogout() {
    setBusy(true);
    try {
      detachRealtime();
      await logout(true);
      setMe(null);
      reset();
    } catch (err) {
      Alert.alert('退出失败', humanizeAuthError(err));
    } finally {
      setBusy(false);
    }
  }

  function confirmLogout() {
    Alert.alert('退出登录', '会同时让当前会话在 Telegram 服务端失效，确定继续？', [
      { text: '取消', style: 'cancel' },
      { text: '退出', style: 'destructive', onPress: handleLogout },
    ]);
  }

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.md }]}
    >
      <View style={styles.headerRow}>
        <Text style={styles.title}>设置</Text>
        <Pressable accessibilityRole="button" onPress={() => navigation.goBack()} hitSlop={12}>
          <Text style={styles.close}>关闭</Text>
        </Pressable>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>当前账号</Text>
        <Row label="昵称" value={me?.name || '-'} />
        <Row label="用户名" value={me?.username || '未设置'} />
        <Row label="手机号" value={me?.phone || '-'} />
        <Row label="用户 ID" value={me?.id || '-'} />
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>接入信息</Text>
        <Row label="api_id" value={creds ? String(creds.apiId) : '未配置'} />
        <Row
          label="api_hash"
          value={creds ? `${creds.apiHash.slice(0, 6)}${'*'.repeat(8)}${creds.apiHash.slice(-4)}` : '未配置'}
        />
        <Row label="传输层" value="MTProto obfuscated2 / 裸 TCP 443" />
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>为什么没有广告</Text>
        <Text style={styles.paragraph}>
          官方客户端的「广告」来自服务端下发的推广内容：会话列表里的 Sponsored 频道/机器人，以及
          聊天记录里穿插的赞助消息。它们需要客户端主动调用 contacts.getSponsoredPeers /
          channels.getSponsoredMessages 之类的接口才会出现。
        </Text>
        <Text style={styles.paragraph}>
          本客户端只实现收发消息所必需的最小接口集合，完全不请求、也不渲染任何推广内容，
          因此从原理上就没有广告位。同理也不会带上官方客户端的推荐频道、贴纸推广、Premium 广告位。
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>关于</Text>
        <Row label="应用" value={APP_NAME} />
        <Row label="版本" value={APP_VERSION} />
        <Row label="协议库" value="GramJS (MTProto 2.0)" />
      </View>

      <Button label="退出登录" variant="danger" onPress={confirmLogout} loading={busy} />
      <Text style={styles.footnote}>
        退出后本机保存的会话会被清除，需要重新用手机号 + 验证码登录。
      </Text>
    </ScrollView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue} numberOfLines={2}>
        {value}
      </Text>
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
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.text,
  },
  close: {
    fontSize: 15,
    color: colors.primary,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  cardTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textMuted,
    marginBottom: spacing.xs,
    textTransform: 'uppercase',
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
  paragraph: {
    fontSize: 13,
    lineHeight: 21,
    color: colors.textMuted,
  },
  footnote: {
    marginTop: spacing.sm,
    fontSize: 12,
    color: colors.textFaint,
    textAlign: 'center',
  },
});
