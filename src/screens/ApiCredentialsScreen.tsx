import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Button from '../components/Button';
import TextField from '../components/TextField';
import { API_CREDENTIALS_URL, BUILTIN_API_HASH, BUILTIN_API_ID } from '../config';
import { detachRealtime } from '../boot';
import { useAppStore } from '../store';
import { getCredentials, logout, saveCredentials } from '../tg/telegram';
import { colors, radius, spacing } from '../theme';

/** 把 api_hash 打码，只留头尾，避免被旁人一眼看到 */
function maskHash(hash: string): string {
  if (!hash) return '';
  if (hash.length <= 8) return '••••••••';
  return `${hash.slice(0, 4)}${'•'.repeat(Math.min(hash.length - 8, 16))}${hash.slice(-4)}`;
}

/**
 * 切换 API 凭据。
 *
 * 这里必须讲清一件事：api_id / api_hash 是「应用身份」，
 * 与当前登录会话是绑定的。改完凭据后旧会话在服务端就不再匹配，
 * 所以保存后要引导用户重新登录，而不是悄悄替换。
 */
export default function ApiCredentialsScreen() {
  const insets = useSafeAreaInsets();
  const reset = useAppStore((state) => state.reset);
  const setMe = useAppStore((state) => state.setMe);

  const [apiId, setApiId] = useState('');
  const [apiHash, setApiHash] = useState('');
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 当前正在使用的凭据（用于展示与判断是否改动过） */
  const [current, setCurrent] = useState<{ apiId: number; apiHash: string } | null>(null);

  useEffect(() => {
    const creds = getCredentials();
    if (creds) {
      setCurrent(creds);
      setApiId(String(creds.apiId));
      setApiHash(creds.apiHash);
    }
  }, []);

  const idValid = /^\d{4,12}$/.test(apiId.trim());
  const hashValid = apiHash.trim().length > 8;
  const dirty =
    !!current &&
    (String(current.apiId) !== apiId.trim() || current.apiHash !== apiHash.trim());
  const canSave = idValid && hashValid && dirty && !busy;

  const handleSave = useCallback(async () => {
    if (!canSave) return;
    setError(null);

    const next = { apiId: Number(apiId.trim()), apiHash: apiHash.trim() };

    Alert.alert(
      '切换 API 凭据',
      '更换 api_id / api_hash 后，当前会话在服务端将不再匹配，需要重新登录。是否继续？',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '保存并重新登录',
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            try {
              // 先落盘新凭据，再登出（logout 只清 session，会保留凭据）
              await saveCredentials(next);
              detachRealtime();
              await logout(true);
              setCurrent(next);
              // 必须把全局状态退回登录态，否则导航栈还停在已登录界面，
              // 而此时客户端已被关闭，一点就崩
              setMe(null);
              reset();
            } catch (err) {
              setError(err instanceof Error ? err.message : String(err));
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  }, [canSave, apiId, apiHash, reset, setMe]);

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + spacing.md, paddingBottom: insets.bottom + spacing.xl },
      ]}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.card}>
        <Text style={styles.cardTitle}>当前生效的凭据</Text>
        {current ? (
          <>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>来源</Text>
              <Text style={styles.infoValue}>
                {BUILTIN_API_ID === current.apiId && BUILTIN_API_HASH === current.apiHash
                  ? '编译内置'
                  : 'App 内填写'}
              </Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>api_id</Text>
              <Text style={styles.infoValue}>{current.apiId}</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>api_hash</Text>
              <Text style={styles.infoValue}>
                {revealed ? current.apiHash : maskHash(current.apiHash)}
              </Text>
            </View>
          </>
        ) : (
          <Text style={styles.infoEmpty}>当前没有可用凭据，请填写后登录。</Text>
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>修改凭据</Text>

        <TextField
          label="api_id"
          value={apiId}
          onChangeText={setApiId}
          placeholder="纯数字，例如 1234567"
          keyboardType="number-pad"
          maxLength={12}
          hint="在 my.telegram.org 的 API development tools 里申请"
        />

        <TextField
          label="api_hash"
          value={apiHash}
          onChangeText={setApiHash}
          placeholder="32 位十六进制字符串"
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry={!revealed}
          maxLength={64}
        />

        <Button
          label={revealed ? '隐藏 api_hash' : '显示 api_hash'}
          variant="ghost"
          onPress={() => setRevealed((prev) => !prev)}
        />

        {error ? (
          <View style={styles.errorBar}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        <View style={styles.actions}>
          <Button
            label={busy ? '处理中…' : '保存并重新登录'}
            onPress={handleSave}
            disabled={!canSave}
            loading={busy}
          />
        </View>

        {!dirty && current ? (
          <Text style={styles.hint}>凭据没有改动，无需保存。</Text>
        ) : null}
        {dirty && (!idValid || !hashValid) ? (
          <Text style={styles.warn}>
            api_id 需为 4–12 位数字，api_hash 长度需大于 8 位。
          </Text>
        ) : null}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>说明</Text>
        <Text style={styles.paragraph}>
          api_id 与 api_hash 代表「应用身份」，不等于你的登录状态。换一组凭据后，
          旧的登录会话在 Telegram 服务端就不再匹配，因此必须重新输入手机号与验证码登录。
        </Text>
        <Text style={styles.paragraph}>
          申请地址：{API_CREDENTIALS_URL}
        </Text>
        <Text style={styles.paragraph}>
          把凭据留在本地（而不是编译进 APK）的好处是：安装包不含任何敏感信息，
          可以放心分享；每个人用各自申请的凭据登录即可。
        </Text>
      </View>

      {busy ? (
        <View style={styles.busyRow}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    paddingHorizontal: spacing.md,
    gap: spacing.md,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
  },
  cardTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textMuted,
    marginBottom: 2,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  infoLabel: {
    fontSize: 13,
    color: colors.textMuted,
  },
  infoValue: {
    flexShrink: 1,
    fontSize: 13,
    color: colors.text,
    textAlign: 'right',
  },
  infoEmpty: {
    fontSize: 13,
    color: colors.textFaint,
  },
  actions: {
    marginTop: spacing.sm,
  },
  errorBar: {
    marginTop: spacing.sm,
    padding: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.dangerSoft,
  },
  errorText: {
    fontSize: 12,
    color: colors.danger,
  },
  hint: {
    marginTop: spacing.sm,
    fontSize: 12,
    color: colors.textFaint,
  },
  warn: {
    marginTop: spacing.sm,
    fontSize: 12,
    color: colors.danger,
  },
  paragraph: {
    fontSize: 13,
    lineHeight: 20,
    color: colors.textMuted,
  },
  busyRow: {
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
});
