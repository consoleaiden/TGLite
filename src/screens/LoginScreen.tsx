import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Linking,
  Platform,
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
import {
  createClient,
  humanizeAuthError,
  loadCredentials,
  requestLoginCode,
  saveCredentials,
} from '../tg/telegram';
import { colors, radius, spacing } from '../theme';
import { looksLikePhone, normalizePhone } from '../utils/format';

type Props = NativeStackScreenProps<RootStackParamList, 'Login'>;

export default function LoginScreen({ navigation }: Props) {
  const [apiId, setApiId] = useState(BUILTIN_API_ID ? String(BUILTIN_API_ID) : '');
  const [apiHash, setApiHash] = useState(BUILTIN_API_HASH);
  const [phone, setPhone] = useState('');
  const [advanced, setAdvanced] = useState(!BUILTIN_API_ID);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      await createClient(creds);

      const result = await requestLoginCode(normalized);
      if (!result.phoneCodeHash) {
        // 会话仍然有效，直接进主界面（stage 变更后导航栈会自动切换）
        await completeLogin();
        return;
      }
      navigation.navigate('Code', {
        phone: normalized,
        phoneCodeHash: result.phoneCodeHash,
        isCodeViaApp: result.isCodeViaApp,
      });
    } catch (err) {
      setError(humanizeAuthError(err));
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
});
