import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
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
import type { RootStackParamList } from '../navigation';
import { useAppStore } from '../store';
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
  const setDialogs = useAppStore((state) => state.setDialogs);
  const setLoading = useAppStore((state) => state.setDialogsLoading);
  const setError = useAppStore((state) => state.setDialogsError);

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
  }, [refresh]);

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

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>对话</Text>
        <Pressable
          accessibilityRole="button"
          style={styles.headerButton}
          onPress={() => navigation.navigate('Settings')}
        >
          <Text style={styles.headerButtonText}>设置</Text>
        </Pressable>
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
            return (
              <Pressable
                style={({ pressed }) => [styles.row, pressed ? styles.rowPressed : null]}
                onPress={() => onOpen(item)}
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
                  <Text style={styles.rowPreview} numberOfLines={1}>
                    {item.previewText || '暂无消息'}
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
