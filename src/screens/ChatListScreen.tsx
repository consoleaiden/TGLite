import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Avatar from '../components/Avatar';
import { classifyText, compileRule, maskPreviewText } from '../filters';
import type { RootStackParamList } from '../navigation';
import { useSettingsStore } from '../settings';
import { useAppStore } from '../store';
import { leaveChat } from '../tg/groups';
import type { DialogItem } from '../tg/telegram';
import { loadDialogs } from '../tg/telegram';
import { colors, spacing } from '../theme';
import { formatDialogTime } from '../utils/format';

type Props = NativeStackScreenProps<RootStackParamList, 'Chats'>;

/** 提到组件外，避免每次 render 都生成新的组件类型 */
function DialogSeparator() {
  return <View style={styles.separator} />;
}

export default function ChatListScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const dialogs = useAppStore((state) => state.dialogs);
  const unread = useAppStore((state) => state.unread);
  const loading = useAppStore((state) => state.dialogsLoading);
  const revision = useAppStore((state) => state.dialogsRevision);
  const setDialogs = useAppStore((state) => state.setDialogs);
  const setLoading = useAppStore((state) => state.setDialogsLoading);
  const setError = useAppStore((state) => state.setDialogsError);
  const removeDialog = useAppStore((state) => state.removeDialog);
  const requestDialogsRefresh = useAppStore((state) => state.requestDialogsRefresh);

  const adEnabled = useSettingsStore((state) => state.ad.enabled);
  const adRaw = useSettingsStore((state) => state.ad.raw);
  const minorEnabled = useSettingsStore((state) => state.minor.enabled);
  const minorRaw = useSettingsStore((state) => state.minor.raw);

  const adRule = useMemo(() => compileRule(adEnabled, adRaw), [adEnabled, adRaw]);
  const minorRule = useMemo(() => compileRule(minorEnabled, minorRaw), [minorEnabled, minorRaw]);

  const [query, setQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(
    async (showSpinner = true) => {
      if (showSpinner) setLoading(true);
      try {
        const items = await loadDialogs();
        setDialogs(items);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [setDialogs, setError, setLoading],
  );

  useEffect(() => {
    refresh();
  }, [refresh, revision]);

  const visible = useMemo(() => {
    const sorted = [...dialogs].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return b.previewDate - a.previewDate;
    });
    const keyword = query.trim().toLowerCase();
    if (!keyword) return sorted;
    return sorted.filter((dialog) => dialog.title.toLowerCase().includes(keyword));
  }, [dialogs, query]);

  const onOpen = useCallback(
    (dialog: DialogItem) => {
      navigation.navigate('Chat', { peerKey: dialog.key, title: dialog.title });
    },
    [navigation],
  );

  const handleLeave = useCallback(
    async (dialog: DialogItem) => {
      try {
        await leaveChat(dialog.key);
        removeDialog(dialog.key);
        requestDialogsRefresh();
      } catch (err) {
        Alert.alert('退出失败', err instanceof Error ? err.message : String(err));
      }
    },
    [removeDialog, requestDialogsRefresh],
  );

  const onLongPress = useCallback(
    (dialog: DialogItem) => {
      const buttons: Array<{ text: string; style?: 'cancel' | 'destructive'; onPress?: () => void }> = [
        {
          text: '查看群信息',
          onPress: () => navigation.navigate('ChatInfo', { peerKey: dialog.key, title: dialog.title }),
        },
      ];
      if (dialog.isGroup || dialog.isChannel) {
        buttons.push({
          text: '退出',
          style: 'destructive',
          onPress: () =>
            Alert.alert('退出会话', `确定退出「${dialog.title}」？退出后需要重新加入才能看到消息。`, [
              { text: '取消', style: 'cancel' },
              { text: '退出', style: 'destructive', onPress: () => handleLeave(dialog) },
            ]),
        });
      }
      buttons.push({ text: '取消', style: 'cancel' });
      Alert.alert(dialog.title, '选择要执行的操作', buttons);
    },
    [handleLeave, navigation],
  );

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>对话</Text>
        <View style={styles.headerButtons}>
          <Pressable
            accessibilityRole="button"
            style={styles.headerButton}
            onPress={() => navigation.navigate('Join')}
          >
            <Text style={styles.headerButtonText}>加入群组</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            style={styles.headerButton}
            onPress={() => navigation.navigate('Settings')}
          >
            <Text style={styles.headerButtonText}>设置</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.searchWrap}>
        <TextInput
          style={styles.search}
          value={query}
          onChangeText={setQuery}
          placeholder="搜索会话"
          placeholderTextColor={colors.textFaint}
          returnKeyType="search"
        />
      </View>

      {loading && !dialogs.length ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.centerText}>正在同步会话…</Text>
        </View>
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(item) => item.key}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                refresh(false);
              }}
              tintColor={colors.primary}
            />
          }
          ItemSeparatorComponent={DialogSeparator}
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={styles.centerText}>
                {query ? '没有匹配的会话' : '还没有任何会话'}
              </Text>
            </View>
          }
          renderItem={({ item }) => {
            const count = unread[item.key] ?? item.unreadCount ?? 0;
            const kind = classifyText(item.previewText, adRule, minorRule);
            const preview = maskPreviewText(item.previewText, kind);
            return (
              <Pressable
                style={({ pressed }) => [styles.row, pressed ? styles.rowPressed : null]}
                onPress={() => onOpen(item)}
                onLongPress={() => onLongPress(item)}
                delayLongPress={350}
              >
                <Avatar title={item.title} seed={item.key} unread={count} />
                <View style={styles.rowBody}>
                  <View style={styles.rowTop}>
                    <Text style={styles.rowTitle} numberOfLines={1}>
                      {item.title}
                      {item.verified ? ' ✓' : ''}
                    </Text>
                    <Text style={styles.rowTime}>{formatDialogTime(item.previewDate)}</Text>
                  </View>
                  <Text
                    style={[styles.rowPreview, kind ? styles.rowPreviewFiltered : null]}
                    numberOfLines={1}
                  >
                    {preview || '暂无消息'}
                  </Text>
                </View>
              </Pressable>
            );
          }}
        />
      )}
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
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.text,
  },
  headerButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: colors.primarySoft,
  },
  headerButtons: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'center',
  },
  headerButtonText: {
    color: colors.primaryDark,
    fontSize: 13,
    fontWeight: '600',
  },
  searchWrap: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  search: {
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.bgAlt,
    paddingHorizontal: spacing.lg,
    fontSize: 15,
    color: colors.text,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  rowPressed: {
    backgroundColor: colors.bgAlt,
  },
  rowBody: {
    flex: 1,
  },
  rowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  rowTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  rowTime: {
    fontSize: 12,
    color: colors.textFaint,
  },
  rowPreview: {
    marginTop: 3,
    fontSize: 14,
    color: colors.textMuted,
  },
  rowPreviewFiltered: {
    color: colors.textFaint,
    fontStyle: 'italic',
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginLeft: spacing.lg + 52 + spacing.md,
  },
  center: {
    paddingTop: spacing.xl * 2,
    alignItems: 'center',
    gap: spacing.sm,
  },
  centerText: {
    fontSize: 14,
    color: colors.textMuted,
  },
});
