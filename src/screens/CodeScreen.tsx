import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, View } from 'react-native';

import { completeLogin } from '../boot';
import Button from '../components/Button';
import type { RootStackParamList } from '../navigation';
import { humanizeAuthError, requestLoginCode, submitLoginCode } from '../tg/telegram';
import { colors, radius, spacing } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Code'>;

export default function CodeScreen({ navigation, route }: Props) {
  const { phone, isCodeViaApp } = route.params;
  const [code, setCode] = useState('');
  const [phoneCodeHash, setPhoneCodeHash] = useState(route.params.phoneCodeHash);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    setError(null);
    const value = code.replace(/\D/g, '');
    if (value.length < 3) {
      setError('请输入收到的验证码。');
      return;
    }

    setLoading(true);
    try {
      const result = await submitLoginCode(phone, phoneCodeHash, value);
      if (result === 'need_password') {
        navigation.navigate('Password');
        return;
      }
      await completeLogin();
    } catch (err) {
      setError(humanizeAuthError(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    setError(null);
    setResending(true);
    try {
      const result = await requestLoginCode(phone);
      if (result.phoneCodeHash) setPhoneCodeHash(result.phoneCodeHash);
    } catch (err) {
      setError(humanizeAuthError(err));
    } finally {
      setResending(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.content}>
        <Text style={styles.title}>输入验证码</Text>
        <Text style={styles.subtitle}>
          验证码已发送到 {phone}
          {isCodeViaApp ? '\n（Telegram 应用内消息）' : '\n（短信）'}
        </Text>

        <TextInput
          style={styles.codeInput}
          value={code}
          onChangeText={setCode}
          keyboardType="number-pad"
          placeholder="12345"
          placeholderTextColor={colors.textFaint}
          maxLength={8}
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Button label="登录" onPress={handleSubmit} loading={loading} style={styles.submit} />
        <Button
          label="重新发送验证码"
          variant="ghost"
          onPress={handleResend}
          loading={resending}
          style={styles.resend}
        />
        <Button
          label="返回修改手机号"
          variant="ghost"
          onPress={() => navigation.goBack()}
          style={styles.back}
        />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    flex: 1,
    padding: spacing.xl,
    paddingTop: spacing.xl * 3,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.text,
  },
  subtitle: {
    marginTop: spacing.sm,
    fontSize: 14,
    lineHeight: 22,
    color: colors.textMuted,
  },
  codeInput: {
    marginTop: spacing.xl,
    height: 60,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    fontSize: 26,
    letterSpacing: 10,
    textAlign: 'center',
    color: colors.text,
  },
  error: {
    marginTop: spacing.md,
    fontSize: 13,
    color: colors.danger,
    backgroundColor: colors.dangerSoft,
    padding: spacing.md,
    borderRadius: radius.sm,
  },
  submit: {
    marginTop: spacing.xl,
  },
  resend: {
    marginTop: spacing.md,
  },
  back: {
    marginTop: spacing.sm,
    borderWidth: 0,
  },
});
