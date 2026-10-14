import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Button from '../components/Button';
import Switch from '../components/Switch';
import TextField from '../components/TextField';
import { compileRule, splitKeywords } from '../filters';
import type { RootStackParamList } from '../navigation';
import { useSettingsStore } from '../settings';
import { colors, radius, spacing } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Filters'>;

const COPY = {
  ad: {
    title: '广告过滤',
    subtitle: '命中关键词的消息会被折叠成一行提示，点一下仍然可以展开查看原文。',
    placeholder: '例如：\n加微信\n优惠券\nhttp://spam.example\n推广',
    hint: '一行一个关键词，也支持用逗号分隔。匹配不区分大小写，只要消息里包含该关键词就会被判定为广告。',
    emptyWarn: '请至少填写一个关键词，否则保存后过滤器不会生效。',
  },
  minor: {
    title: '未成年保护',
    subtitle: '命中关键词的消息会被彻底隐藏，不会出现在聊天记录里，也不会留下折叠提示。',
    placeholder: '例如：\n赌博\n色情\n加群拿资源',
    hint: '比广告过滤更严格：被过滤的消息完全不渲染，无法展开，也不计入聊天记录的展示。',
    emptyWarn: '请至少填写一个关键词，否则过滤器不会生效。',
  },
} as const;

export default function FiltersScreen({ navigation, route }: Props) {
  const { kind } = route.params;
  const insets = useSafeAreaInsets();
  const copy = COPY[kind];

  const setting = useSettingsStore((state) => (kind === 'ad' ? state.ad : state.minor));
  const setAd = useSettingsStore((state) => state.setAd);
  const setMinor = useSettingsStore((state) => state.setMinor);

  const [enabled, setEnabled] = useState(setting.enabled);
  const [raw, setRaw] = useState(setting.raw);

  const keywords = useMemo(() => splitKeywords(raw), [raw]);
  const dirty = enabled !== setting.enabled || raw !== setting.raw;

  function handleSave() {
    if (enabled && keywords.length === 0) {
      Alert.alert('还不能启用', copy.emptyWarn);
      return;
    }
    const patch = { enabled, raw };
    if (kind === 'ad') setAd(patch);
    else setMinor(patch);
    Alert.alert('已保存', `规则已生效，当前共 ${keywords.length} 个关键词。`);
  }

  function handleClear() {
    setRaw('');
  }

  const rule = compileRule(enabled, raw);

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
        <Text style={styles.title}>{copy.title}</Text>
        <View style={styles.backSpacer} />
      </View>

      <View style={styles.card}>
        <View style={styles.switchRow}>
          <View style={styles.switchText}>
            <Text style={styles.cardTitle}>启用{copy.title}</Text>
            <Text style={styles.switchHint}>{enabled ? '已启用' : '已停用'}</Text>
          </View>
          <Switch value={enabled} onChange={setEnabled} />
        </View>
        <Text style={styles.paragraph}>{copy.subtitle}</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>过滤关键词</Text>
        <TextField
          label="关键词"
          value={raw}
          onChangeText={setRaw}
          placeholder={copy.placeholder}
          hint={copy.hint}
          multiline
          numberOfLines={6}
        />
        <View style={styles.chipHead}>
          <Text style={styles.chipCount}>{keywords.length} 个关键词</Text>
          {raw ? (
            <Pressable accessibilityRole="button" onPress={handleClear} hitSlop={8}>
              <Text style={styles.clear}>清空</Text>
            </Pressable>
          ) : null}
        </View>
        <View style={styles.chips}>
          {keywords.slice(0, 40).map((word) => (
            <Text key={word} style={styles.chip}>
              {word}
            </Text>
          ))}
          {keywords.length > 40 ? <Text style={styles.chipMore}>…还有 {keywords.length - 40} 个</Text> : null}
          {!keywords.length ? <Text style={styles.chipEmpty}>还没有关键词</Text> : null}
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>过滤状态</Text>
        <Row label="开关" value={enabled ? '开启' : '关闭'} />
        <Row label="实际生效" value={rule.active ? '是' : '否'} />
        <Row
          label="作用范围"
          value={kind === 'ad' ? '群消息 + 用户消息（折叠，可展开）' : '群消息 + 用户消息（彻底隐藏）'}
        />
      </View>

      <Button label={dirty ? '保存' : '已保存'} onPress={handleSave} disabled={!dirty} />
      <Text style={styles.footnote}>
        过滤在本地进行，只影响本机的显示效果，不会删除服务端消息，也不会上报任何内容。
      </Text>
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
  paragraph: {
    fontSize: 13,
    lineHeight: 20,
    color: colors.textMuted,
  },
  chipHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  chipCount: {
    fontSize: 12,
    color: colors.textMuted,
  },
  clear: {
    fontSize: 13,
    color: colors.primary,
    fontWeight: '600',
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  chip: {
    fontSize: 12,
    color: colors.primaryDark,
    backgroundColor: colors.primarySoft,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    overflow: 'hidden',
  },
  chipMore: {
    fontSize: 12,
    color: colors.textFaint,
    paddingVertical: 3,
  },
  chipEmpty: {
    fontSize: 12,
    color: colors.textFaint,
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
  footnote: {
    marginTop: spacing.sm,
    fontSize: 12,
    lineHeight: 18,
    color: colors.textFaint,
    textAlign: 'center',
  },
});
