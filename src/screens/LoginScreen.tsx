import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import Button from '../components/Button';
import { completeLogin } from '../boot';
import { API_CREDENTIALS_URL, BUILTIN_API_HASH, BUILTIN_API_ID, TELEGRAM_DC_IPV4 } from '../config';
import type { RootStackParamList } from '../navigation';
import { transportLabel } from '../net/transport';
import {
  useSettingsStore,
  describePreLoginNetwork,
  describeProxyTarget,
  proxyKindLabel,
} from '../settings';
import {
  createClient,
  humanizeAuthError,
  loadCredentials,
  requestLoginCode,
  saveCredentials,
} from '../tg/telegram';
import { colors, radius, spacing } from '../theme';
import { looksLikeNetworkError, looksLikePhone, normalizePhone } from '../utils/format';

type Props = NativeStackScreenProps<RootStackParamList, 'Login'>;

export default function LoginScreen({ navigation }: Props) {
  const [apiId, setApiId] = useState(BUILTIN_API_ID ? String(BUILTIN_API_ID) : '');
  const [apiHash, setApiHash] = useState(BUILTIN_API_HASH);
  const [phone, setPhone] = useState('');
  const [advanced, setAdvanced] = useState(!BUILTIN_API_ID);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 代理状态要在这里显示：很多网络里没有代理根本连不上 Telegram，
  // 得让用户在登录页就能看到当前有没有走代理、并一键去配置。
  const proxy = useSettingsStore((state) => state.proxy);
  const transport = useSettingsStore((state) => state.transport);

  useEffect(() => {
    (async () => {
      const stored = await loadCredentials();
      if (stored) {
        setApiId(String(stored.apiId));
        setApiHash(stored.apiHash);
        setAdvanced(false);
      }
    })();
  }, []);

  const canSubmit =
    /^\d{4,12}$/.test(apiId.trim()) && apiHash.trim().length > 8 && looksLikePhone(phone) && !loading;

  /**
   * 登录页要表达的是「这份配置会不会走代理」，
   * 而不是 proxyActuallyInUse()（那个读的是传输层实时状态，
   * 只有在 createClient 之后才为真，登录前永远是 false，会误导人）。
   */
  const netHint = describePreLoginNetwork(transport, proxy);

  async function handleSendCode() {
    setError(null);
    const normalized = normalizePhone(phone);
    const parsedId = Number(apiId.trim());
    const hash = apiHash.trim();

    if (!parsedId || hash.length < 8) {
      setError('请填写有效的 api_id 与 api_hash。');
      return;
    }
    if (!looksLikePhone(normalized)) {
      setError('手机号需要带国家码，例如 +8613800138000。');
      return;
    }

    setLoading(true);
    try {
      const creds = { apiId: parsedId, apiHash: hash };
      await saveCredentials(creds);
      // createClient 会在构造客户端时读取当前设置，
      // 所以用户在登录页配好的代理/通道到这里就自动生效了
      await createClient(creds);

      const result = await requestLoginCode(normalized);
      if (!result.phoneCodeHash) {
        // 会话仍然有效，直接进主界面（stage 变更后导航栈会自动切换）
        await completeLogin();
        return;
      }
      navigation.navigate('Code', {
        phone: normalized,
        isCodeViaApp: result.isCodeViaApp,
        phoneCodeHash: result.phoneCodeHash,
      });
    } catch (err) {
      setError(humanizeAuthError(err));
      // 建连阶段的失败往往就是网络不通，顺手把用户引导到代理设置
      if (looksLikeNetworkError(err)) {
        setError(
          `${humanizeAuthError(err)}\n\n如果所在网络无法直连 Telegram，请点下面的「网络与代理」配置代理或切换通道后重试。`,
        );
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.hero}>
          <View style={styles.logo}>
            <Text style={styles.logoText}>TG</Text>
          </View>
          <Text style={styles.title}>TG Lite</Text>
          <Text style={styles.subtitle}>
            极简第三方 Telegram 客户端{'\n'}不请求、不渲染任何推广内容，自然没有广告
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>手机号（含国家码）</Text>
          <TextInput
            style={styles.input}
            value={phone}
            onChangeText={setPhone}
            placeholder="+8613800138000"
            placeholderTextColor={colors.textFaint}
            keyboardType="phone-pad"
            autoComplete="tel"
            returnKeyType="done"
          />

          <View style={styles.switchRow}>
            <Text style={styles.switchText} onPress={() => setAdvanced((prev) => !prev)}>
              {advanced ? '收起 API 凭据设置' : '使用自己的 api_id / api_hash'}
            </Text>
          </View>

          {advanced ? (
            <>
              <Text style={styles.label}>api_id</Text>
              <TextInput
                style={styles.input}
                value={apiId}
                onChangeText={setApiId}
                placeholder="1234567"
                placeholderTextColor={colors.textFaint}
                keyboardType="number-pad"
              />

              <Text style={styles.label}>api_hash</Text>
              <TextInput
                style={styles.input}
                value={apiHash}
                onChangeText={setApiHash}
                placeholder="0123456789abcdef0123456789abcdef"
                placeholderTextColor={colors.textFaint}
                autoCapitalize="none"
                autoCorrect={false}
              />

              <Text style={styles.hint} onPress={() => Linking.openURL(API_CREDENTIALS_URL)}>
                到 my.telegram.org/apps 免费申请 → 点击打开
              </Text>
            </>
          ) : null}

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Button
            label="获取验证码"
            onPress={handleSendCode}
            loading={loading}
            disabled={!canSubmit}
            style={styles.submit}
          />
        </View>

        <View style={styles.netCard}>
          <View style={styles.netText}>
            <Text style={styles.netTitle}>网络与代理</Text>
            <Text style={styles.netValue}>
              {proxy.enabled
                ? `${proxyKindLabel(proxy.kind)} ${describeProxyTarget(proxy)}`
                : '未启用代理'}
              {` · 通道 ${transportLabel(transport)}`}
            </Text>
            <Text style={[styles.netHint, netHint.warning ? styles.netHintWarn : null]}>
              {netHint.message}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={() => navigation.navigate('Network', { preLogin: true })}
            hitSlop={12}
            style={styles.netAction}
          >
            <Text style={styles.netActionText}>去配置</Text>
          </Pressable>
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>
            登录信息只保存在本机，不会上传到任何第三方服务器。
          </Text>
          <Text style={styles.footerText}>
            默认出口 DC：{Object.keys(TELEGRAM_DC_IPV4).length} 个，按账号归属自动切换。
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    flexGrow: 1,
    padding: spacing.xl,
    justifyContent: 'center',
  },
  hero: {
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  logo: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoText: {
    color: '#FFFFFF',
    fontSize: 26,
    fontWeight: '700',
  },
  title: {
    marginTop: spacing.md,
    fontSize: 26,
    fontWeight: '700',
    color: colors.text,
  },
  subtitle: {
    marginTop: spacing.sm,
    fontSize: 13,
    lineHeight: 20,
    color: colors.textMuted,
    textAlign: 'center',
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  label: {
    fontSize: 13,
    color: colors.textMuted,
    marginBottom: 6,
    marginTop: spacing.md,
  },
  input: {
    height: 46,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.bg,
  },
  switchRow: {
    marginTop: spacing.md,
    alignItems: 'flex-end',
  },
  switchText: {
    fontSize: 13,
    color: colors.primary,
    fontWeight: '600',
  },
  hint: {
    marginTop: spacing.sm,
    fontSize: 12,
    color: colors.primary,
  },
  error: {
    marginTop: spacing.md,
    fontSize: 13,
    lineHeight: 19,
    color: colors.danger,
    backgroundColor: colors.dangerSoft,
    padding: spacing.md,
    borderRadius: radius.sm,
  },
  submit: {
    marginTop: spacing.lg,
  },
  footer: {
    marginTop: spacing.xl,
    alignItems: 'center',
  },
  footerText: {
    fontSize: 12,
    color: colors.textFaint,
    lineHeight: 18,
    textAlign: 'center',
  },
  netCard: {
    marginTop: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  netText: {
    flex: 1,
  },
  netTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
  },
  netValue: {
    marginTop: 2,
    fontSize: 12,
    color: colors.textMuted,
  },
  netHint: {
    marginTop: 4,
    fontSize: 11,
    lineHeight: 16,
    color: colors.textFaint,
  },
  netHintWarn: {
    color: colors.danger,
  },
  netAction: {
    paddingVertical: 6,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.primarySoft,
  },
  netActionText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.primaryDark,
  },
});
