import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useCallback, useEffect, useState } from 'react';
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
import MediaBlock from '../components/MediaBlock';
import type { RootStackParamList } from '../navigation';
import { loadComments, sendComment, type CommentItem } from '../tg/telegram';
import { colors, radius, spacing } from '../theme';
import { formatMessageTime } from '../utils/format';

type Props = NativeStackScreenProps<RootStackParamList, 'Comments'>;

/**
 * 频道帖子的评论列表。
 *
 * Telegram 的评论存放在帖子的「关联讨论组」里，
 * 帖子的 message.id 就是讨论组里的起始消息 id，
 * 所以用 messages.getReplies 就能拉到全部评论。
 */
export default function CommentsScreen({ navigation, route }: Props) {
  const { peerKey, msgId, title } = route.params;
  const insets = useSafeAreaInsets();

  const [items, setItems] = useState<CommentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);

  const fetchComments = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const list = await loadComments(peerKey, msgId);
        setItems(list);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [peerKey, msgId],
  );

  useEffect(() => {
    fetchComments();
  }, [fetchComments]);

  const handleSend = useCallback(async () => {
    const value = input.trim();
    if (!value) return;
    setSending(true);
    try {
      // 把评论发到关联讨论组：commentTo 指向原帖，Telegram 会自动挂到评论区
      await sendComment(peerKey, msgId, value);
      setInput('');
      await fetchComments();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  }, [input, peerKey, msgId, fetchComments]);

  const renderItem = useCallback(
    ({ item }: { item: CommentItem }) => (
      <View style={styles.row}>
        <Avatar title={item.senderName} seed={item.id + item.senderName} size={36} />
        <View style={styles.rowBody}>
          <View style={styles.rowHead}>
            <Text style={styles.sender} numberOfLines={1}>
              {item.out ? '你' : item.senderName}
            </Text>
            <Text style={styles.time}>{formatMessageTime(item.date)}</Text>
          </View>
          {item.media ? <MediaBlock media={item.media} /> : null}
          {item.text ? <Text style={styles.text}>{item.text}</Text> : null}
        </View>
      </View>
    ),
    [],
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
          <Text style={styles.backText}>返回</Text>
        </Pressable>
        <View style={styles.titleWrap}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            评论
          </Text>
          <Text style={styles.headerSub} numberOfLines={1}>
            {title}
          </Text>
        </View>
        <View style={styles.back} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.centerText}>正在加载评论…</Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => fetchComments(true)} />
          }
          ListHeaderComponent={
            error ? (
              <View style={styles.errorBar}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null
          }
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Text style={styles.centerText}>还没有评论</Text>
            </View>
          }
        />
      )}

      <View style={[styles.composer, { paddingBottom: insets.bottom + spacing.sm }]}>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder="写下你的评论…"
          placeholderTextColor={colors.textFaint}
          multiline
          maxLength={4096}
          editable={!sending}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="发送评论"
          onPress={handleSend}
          disabled={!input.trim() || sending}
          style={[styles.send, !input.trim() || sending ? styles.sendDisabled : null]}
        >
          {sending ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Text style={styles.sendText}>发送</Text>
          )}
        </Pressable>
      </View>
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
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  centerText: {
    fontSize: 13,
    color: colors.textMuted,
  },
  listContent: {
    paddingVertical: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  rowBody: {
    flex: 1,
  },
  rowHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  sender: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    color: colors.primaryDark,
  },
  time: {
    fontSize: 11,
    color: colors.textFaint,
  },
  text: {
    marginTop: 2,
    fontSize: 14,
    lineHeight: 20,
    color: colors.text,
  },
  emptyWrap: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
  },
  errorBar: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    padding: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.dangerSoft,
  },
  errorText: {
    fontSize: 12,
    color: colors.danger,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.card,
    gap: spacing.sm,
  },
  input: {
    flex: 1,
    minHeight: 36,
    maxHeight: 110,
    paddingHorizontal: spacing.md,
    paddingTop: 8,
    paddingBottom: 8,
    borderRadius: radius.lg,
    backgroundColor: colors.bgAlt,
    fontSize: 15,
    color: colors.text,
  },
  send: {
    height: 36,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendDisabled: {
    opacity: 0.45,
  },
  sendText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
});
