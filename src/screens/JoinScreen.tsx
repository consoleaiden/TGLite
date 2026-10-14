import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Avatar from '../components/Avatar';
import Button from '../components/Button';
import TextField from '../components/TextField';
import type { RootStackParamList } from '../navigation';
import { useAppStore } from '../store';
import type { JoinPreview } from '../tg/groups';
import { joinByTarget, previewJoinTarget } from '../tg/groups';
import { parseJoinTarget } from '../tg/links';
import { colors, radius, spacing } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Join'>;

export default function JoinScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const requestDialogsRefresh = useAppStore((state) => state.requestDialogsRefresh);

  const [input, setInput] = useState('');
  const [preview, setPreview] = useState<JoinPreview | null>(null);
  const [previewFor, setPreviewFor] = useState('');
  const [loading, setLoading] = useState(false);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handlePreview() {
    const target = parseJoinTarget(input);
    if (target.kind === 'error') {
      setPreview(null);
      setError(target.reason);
      return;
    }
    setLoading(true);
    setError(null);
    setPreview(null);
    try {
      const result = await previewJoinTarget(target);
      setPreview(result);
      setPreviewFor(input.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleJoin() {
    const target = parseJoinTarget(input);
    if (target.kind === 'error') {
      setError(target.reason);
      return;
    }
    setJoining(true);
    setError(null);
    try {
      const joined = await joinByTarget(target);
      requestDialogsRefresh();
      // replace 而不是 navigate：返回键直接回到会话列表，而不是再看到加入页
      navigation.replace('Chat', { peerKey: joined.peerKey, title: joined.title });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      // 「已提交申请」这类不是错误，用提示语气给
      Alert.alert(message.includes('申请') ? '已提交申请' : '加入失败', message);
    } finally {
      setJoining(false);
    }
  }

  const dirty = input.trim() !== previewFor;

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
        <Text style={styles.title}>加入群组 / 频道</Text>
        <View style={styles.backSpacer} />
      </View>

      <View style={styles.card}>
        <TextField
          label="用户名或邀请链接"
          value={input}
          onChangeText={(value) => {
            setInput(value);
            setError(null);
          }}
          placeholder="@telegram 或 https://t.me/+AbCdEf123456"
          hint="支持：@username、t.me/username、https://t.me/+邀请码、https://t.me/joinchat/邀请码"
        />
        <Button
          label="解析并预览"
          variant="ghost"
          onPress={handlePreview}
          loading={loading}
          disabled={!input.trim() || joining}
        />
      </View>

      {error ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.centerText}>正在解析…</Text>
        </View>
      ) : null}

      {preview ? (
        <View style={styles.card}>
          <View style={styles.previewHead}>
            <Avatar title={preview.title} seed={preview.peerKey || preview.title} size={52} />
            <View style={styles.previewInfo}>
              <Text style={styles.previewTitle} numberOfLines={2}>
                {preview.title}
                {preview.verified ? ' ✓' : ''}
              </Text>
              <Text style={styles.previewMeta}>
                {preview.isBroadcast ? '广播频道' : preview.kind === 'group' ? '群组' : '用户'}
                {preview.username ? ` · ${preview.username}` : ''}
              </Text>
              <Text style={styles.previewMeta}>
                {preview.membersCount > 0 ? `${preview.membersCount} 位成员` : '成员数未公开'}
              </Text>
            </View>
          </View>

          {preview.about ? <Text style={styles.previewAbout}>{preview.about}</Text> : null}

          {preview.requestNeeded ? (
            <Text style={styles.warn}>该群组需要管理员审批才能加入，提交后请等待通过。</Text>
          ) : null}
          {preview.alreadyJoined ? (
            <Text style={styles.ok}>你已经在其中，可以直接打开会话。</Text>
          ) : null}

          {preview.alreadyJoined && preview.peerKey ? (
            <Button
              label="打开会话"
              onPress={() =>
                navigation.replace('Chat', { peerKey: preview.peerKey, title: preview.title })
              }
              disabled={joining}
            />
          ) : (
            <Button
              label={preview.requestNeeded ? '提交加入申请' : '加入'}
              onPress={handleJoin}
              loading={joining}
              disabled={dirty}
            />
          )}
          {dirty ? <Text style={styles.warn}>输入已修改，请重新点击「解析并预览」。</Text> : null}
        </View>
      ) : null}

      <View style={styles.card}>
        <Text style={styles.cardTitle}>说明</Text>
        <Text style={styles.hint}>
          私有群组/频道只能用管理员生成的邀请链接加入；公开群组/频道用 @用户名 即可。
          邀请链接里的邀请码就是 t.me/+ 后面那一串，本客户端只把它发给 Telegram 官方服务器，不做任何转发。
        </Text>
      </View>
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
    fontSize: 19,
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
  previewHead: {
    flexDirection: 'row',
    gap: spacing.md,
    alignItems: 'center',
  },
  previewInfo: {
    flex: 1,
    gap: 2,
  },
  previewTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.text,
  },
  previewMeta: {
    fontSize: 12,
    color: colors.textMuted,
  },
  previewAbout: {
    marginTop: spacing.sm,
    fontSize: 13,
    lineHeight: 20,
    color: colors.textMuted,
  },
  errorBox: {
    backgroundColor: colors.dangerSoft,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  errorText: {
    fontSize: 13,
    lineHeight: 19,
    color: colors.danger,
  },
  center: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.lg,
  },
  centerText: {
    fontSize: 13,
    color: colors.textMuted,
  },
  warn: {
    fontSize: 12,
    lineHeight: 18,
    color: colors.danger,
  },
  ok: {
    fontSize: 12,
    lineHeight: 18,
    color: colors.success,
  },
  hint: {
    fontSize: 12,
    lineHeight: 18,
    color: colors.textFaint,
  },
});
