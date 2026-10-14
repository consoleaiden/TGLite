import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, View } from 'react-native';

import { completeLogin } from '../boot';
import Button from '../components/Button';
import type { RootStackParamList } from '../navigation';
import { fetchPasswordHint, humanizeAuthError, submitTwoFactorPassword } from '../tg/telegram';
import { colors, radius, spacing } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Password'>;

export default function PasswordScreen({ navigation }: Props) {
  const [password, setPassword] = useState('');
  const [hint, setHint] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const value = await fetchPasswordHint();
      if (value) setHint(value);
    })();
  }, []);

  async function handleSubmit() {
    setError(null);
    if (!password) {
      setError('请输入两步验证密码。');
      return;
    }

    setLoading(true);
    try {
      await submitTwoFactorPassword(password);
      await completeLogin();
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
      <View style={styles.content}>
        <Text style={styles.title}>两步验证</Text>
        <Text style={styles.subtitle}>
          该账号开启了两步验证，请输入你在 Telegram 里设置的密码。
        </Text>
        {hint ? <Text style={styles.hint}>密码提示：{hint}</Text> : null}

        <TextInput
          style={styles.input}
          value={password}
          onChangeText={setPassword}
          placeholder="两步验证密码"
          placeholderTextColor={colors.textFaint}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Button label="登录" onPress={handleSubmit} loading={loading} style={styles.submit} />
        <Button
          label="返回"
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
  hint: {
    marginTop: spacing.sm,
    fontSize: 13,
    color: colors.primary,
  },
  input: {
    marginTop: spacing.xl,
    height: 50,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    fontSize: 16,
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
  back: {
    marginTop: spacing.md,
  },
});
