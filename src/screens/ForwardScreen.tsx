import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Avatar from '../components/Avatar';
import type { RootStackParamList } from '../navigation';
import { useAppStore } from '../store';
import { forwardMessages, type DialogItem } from '../tg/telegram';
import { colors, radius, spacing } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Forward'>;

/**
 * 转发目标选择页。
 *
 * messageIds 是要转发的消息 id 列表：
 *   - 单条转发：长度 1
 *   - 多选转发：多个
 *   - 消息组整体转发：同一相册的全部 id（由 ChatScreen 用 collectGroupedIds 算好）
 */
export default function ForwardScreen({ navigation, route }: Props) {
  const { peerKey, messageIds, grouped } = route.params;
  const insets = useSafeAreaInsets();
  const dialogs = useAppStore((state) => state.dialogs);

  const [keyword, setKeyword] = useState('');
  /** 多选的目标会话（支持一次转发到多个） */
  const [targets, setTargets] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    // 排除来源会话本身：转发给自己所在的同一个会话没有意义
    const list = dialogs.filter((item) => item.key !== peerKey);
    if (!kw) return list;
    return list.filter((item) => item.title.toLowerCase().includes(kw));
  }, [dialogs, keyword, peerKey]);

  const toggle = useCallback((key: string) => {
    setTargets((prev) => (prev.includes(key) ? prev.filter((x) => x !== key) : [...prev, key]));
  }, []);

  const handleConfirm = useCallback(async () => {
    if (!targets.length) return;
    setBusy(true);
    try {
      await forwardMessages(peerKey, messageIds, targets);
      navigation.goBack();
      // 提示放到返回之后，避免用户以为卡住了
      setTimeout(() => {
        Alert.alert('已转发', `转发到 ${targets.length} 个会话`);
      }, 120);
    } catch (err) {
      Alert.alert('转发失败', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [navigation, peerKey, messageIds, targets]);

  const renderItem = useCallback(
    ({ item }: { item: DialogItem }) => {
      const checked = targets.includes(item.key);
      return (
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked }}
          onPress={() => toggle(item.key)}
          style={[styles.row, checked ? styles.rowOn : null]}
        >
          <Avatar title={item.title} seed={item.key} size={42} />
          <View style={styles.rowBody}>
            <Text style={styles.rowTitle} numberOfLines={1}>
              {item.title}
            </Text>
            <Text style={styles.rowSub} numberOfLines={1}>
              {item.isChannel ? '频道' : item.isGroup ? '群组' : '私聊'}
              {item.previewText ? ` · ${item.previewText}` : ''}
            </Text>
          </View>
          <View style={[styles.check, checked ? styles.checkOn : null]}>
            {checked ? <Text style={styles.checkMark}>✓</Text> : null}
          </View>
        </Pressable>
      );
    },
    [targets, toggle],
  );

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable
          accessibilityRole="button"
          hitSlop={12}
          onPress={() => navigation.goBack()}
          style={styles.back}
        >
          <Text style={styles.backText}>取消</Text>
        </Pressable>
        <View style={styles.titleWrap}>
          <Text style={styles.headerTitle}>转发到</Text>
          <Text style={styles.headerSub}>
            {grouped ? `整组 ${messageIds.length} 条消息` : `${messageIds.length} 条消息`}
            {targets.length ? ` · 已选 ${targets.length} 个会话` : ''}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          hitSlop={12}
          disabled={!targets.length || busy}
          onPress={handleConfirm}
          style={styles.back}
        >
          {busy ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <Text style={[styles.sendText, !targets.length ? styles.sendDisabled : null]}>
              发送
            </Text>
          )}
        </Pressable>
      </View>

      <View style={styles.searchWrap}>
        <TextInput
          style={styles.search}
          value={keyword}
          onChangeText={setKeyword}
          placeholder="搜索会话…"
          placeholderTextColor={colors.textFaint}
          autoCorrect={false}
        />
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.key}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.emptyWrap}>
            <Text style={styles.emptyText}>
              {dialogs.length <= 1 ? '没有其它可转发的会话' : '没有匹配的会话'}
            </Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    backgroundColor: colors.card,
    gap: spacing.sm,
  },
  back: {
    paddingVertical: 4,
    minWidth: 44,
  },
  backText: {
    fontSize: 15,
    color: colors.primary,
  },
  titleWrap: {
    flex: 1,
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  headerSub: {
    fontSize: 11,
    color: colors.textFaint,
    marginTop: 1,
  },
  sendText: {
    fontSize: 15,
    color: colors.primary,
    fontWeight: '600',
    textAlign: 'right',
  },
  sendDisabled: {
    color: colors.textFaint,
  },
  searchWrap: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  search: {
    height: 38,
    borderRadius: radius.lg,
    backgroundColor: colors.bgAlt,
    paddingHorizontal: spacing.md,
    fontSize: 14,
    color: colors.text,
  },
  listContent: {
    paddingBottom: spacing.xl,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.md,
  },
  rowOn: {
    backgroundColor: colors.primarySoft,
  },
  rowBody: {
    flex: 1,
  },
  rowTitle: {
    fontSize: 15,
    color: colors.text,
  },
  rowSub: {
    fontSize: 12,
    color: colors.textFaint,
    marginTop: 2,
  },
  check: {
    width: 22,
    height: 22,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  checkMark: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  emptyWrap: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
  },
  emptyText: {
    fontSize: 13,
    color: colors.textMuted,
  },
});
