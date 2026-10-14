import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import MessageBubble from '../components/MessageBubble';
import { classifyText, compileRule, shouldDropMessage } from '../filters';
import type { RootStackParamList } from '../navigation';
import { useSettingsStore } from '../settings';
import { useAppStore } from '../store';
import { onIncoming } from '../tg/bus';
import { collectGroupedIds } from '../tg/media';
import {
  deleteMessages,
  loadMessages,
  loadOlderMessages,
  markPeerRead,
  sendTextMessage,
  type ChatMessage,
} from '../tg/telegram';
import { pickImage, pickDocument } from '../tg/pickers';
import { downloadMediaAsDataUri, sendMedia } from '../tg/media-transfer';
import { colors, radius, spacing } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Chat'>;

/** 首屏与翻页的条数，与 loadMessages 的默认值保持一致 */
const PAGE_SIZE = 50;

export default function ChatScreen({ navigation, route }: Props) {
  const { peerKey, title } = route.params;
  const insets = useSafeAreaInsets();
  const clearUnread = useAppStore((state) => state.clearUnread);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const reachedStart = useRef(false);

  /** 正在回复的消息（输入框上方的回复条） */
  const [replyTarget, setReplyTarget] = useState<ChatMessage | null>(null);
  /** 多选模式下选中的消息 id */
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const selecting = selectedIds.length > 0;
  /** 已下载图片的 data uri，key 是 messageId */
  const [imageUris, setImageUris] = useState<Record<string, string>>({});
  /** 正在请求下载的图片 id，避免重复请求 */
  const loadingImages = useRef<Set<string>>(new Set());
  /** 上传媒体的进度提示 */
  const [uploading, setUploading] = useState(false);

  const listRef = useRef<FlatList<ChatMessage>>(null);

  // 关键词规则订阅成 4 个基本类型，避免每次 set 都触发整页重渲染
  const adEnabled = useSettingsStore((state) => state.ad.enabled);
  const adRaw = useSettingsStore((state) => state.ad.raw);
  const minorEnabled = useSettingsStore((state) => state.minor.enabled);
  const minorRaw = useSettingsStore((state) => state.minor.raw);

  const adRule = useMemo(() => compileRule(adEnabled, adRaw), [adEnabled, adRaw]);
  const minorRule = useMemo(() => compileRule(minorEnabled, minorRaw), [minorEnabled, minorRaw]);

  /**
   * 过滤在渲染层做，而不是在拉取时做：
   * 用户改完关键词回到聊天页，历史消息会立刻按新规则重新判定，不需要重新拉取。
   */
  const visibleMessages = useMemo(
    () => messages.filter((item) => !shouldDropMessage(classifyText(item.text, adRule, minorRule))),
    [messages, adRule, minorRule],
  );
  const hiddenCount = messages.length - visibleMessages.length;

  /**
   * 把引用块里的「谁回复了谁」补全。
   *
   * GramJS 的 replyTo 只带 messageId，正文要自己找。
   * 被回复的消息通常已在当前列表里，所以直接在本地查——
   * 这样不用为每个引用块额外发一次网络请求。
   */
  const decoratedMessages = useMemo(() => {
    const byId = new Map(messages.map((item) => [item.id, item]));
    return visibleMessages.map((item) => {
      if (!item.replyTo) return item;
      const target = byId.get(item.replyTo.id);
      if (!target) return item;
      // 引用块正文按「类型」给个可读描述，媒体消息不至于显示空白
      const preview = target.text || (target.media ? `［${target.media.label}］` : '');
      return {
        ...item,
        replyTo: {
          ...item.replyTo,
          text: preview,
          senderName: target.senderName || '',
          out: target.out,
        },
      };
    });
  }, [visibleMessages, messages]);

  /** 去重 + 把「发送中」的本地消息替换成服务端返回的真实消息 */
  const mergeMessage = useCallback((incoming: ChatMessage) => {
    setMessages((prev) => {
      if (prev.some((item) => item.id === incoming.id)) return prev;
      if (incoming.out) {
        const pendingIndex = prev.findIndex((item) => item.pending && item.text === incoming.text);
        if (pendingIndex >= 0) {
          const next = [...prev];
          next[pendingIndex] = incoming;
          return next;
        }
      }
      return [incoming, ...prev];
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    reachedStart.current = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const items = await loadMessages(peerKey);
        if (cancelled) return;
        setMessages(items);
        if (items.length < PAGE_SIZE) reachedStart.current = true;
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    clearUnread(peerKey);
    markPeerRead(peerKey);

    const unsubscribe = onIncoming((key, payload) => {
      if (key === peerKey) mergeMessage(payload as ChatMessage);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [peerKey, clearUnread, mergeMessage]);

  /**
   * 图片懒加载：只下载可视范围内的图片。
   *
   * Telegram 的图片是分片存储的，整屏一次性下载会同时打出几十个请求，
   * 在移动网络下很容易集体超时。这里按需触发，并用 Set 去重。
   */
  const ensureImage = useCallback(
    async (message: ChatMessage) => {
      if (!message.media) return;
      const kind = message.media.kind;
      if (kind !== 'photo' && kind !== 'sticker' && kind !== 'gif') return;
      if (imageUris[message.id] || loadingImages.current.has(message.id)) return;
      loadingImages.current.add(message.id);
      try {
        const uri = await downloadMediaAsDataUri(peerKey, message.id);
        if (uri) setImageUris((prev) => ({ ...prev, [message.id]: uri }));
      } catch {
        // 单张图失败不影响其它内容
      } finally {
        loadingImages.current.delete(message.id);
      }
    },
    [peerKey, imageUris],
  );

  const handleLoadMore = useCallback(async () => {
    if (loadingMore || reachedStart.current || !messages.length) return;
    const oldest = messages[messages.length - 1];
    // 还没落地的本地消息没有服务端 id，不能用来翻页
    if (!/^\d+$/.test(oldest.id)) return;
    setLoadingMore(true);
    try {
      const older = await loadOlderMessages(peerKey, oldest.id);
      if (!older.length) {
        reachedStart.current = true;
      } else {
        setMessages((prev) => {
          const existing = new Set(prev.map((item) => item.id));
          return [...prev, ...older.filter((item) => !existing.has(item.id))];
        });
      }
    } catch {
      reachedStart.current = true;
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, messages, peerKey]);

  const handleSend = useCallback(async () => {
    const value = input.trim();
    if (!value) return;

    const replyId = replyTarget?.id;
    const tempId = `local-${Date.now()}`;
    const optimistic: ChatMessage = {
      id: tempId,
      out: true,
      text: value,
      date: Math.floor(Date.now() / 1000),
      kind: 'text',
      pending: true,
      replyTo: replyTarget
        ? {
            id: replyTarget.id,
            text: replyTarget.text,
            senderName: replyTarget.senderName || '',
            out: replyTarget.out,
          }
        : null,
    };

    setMessages((prev) => [optimistic, ...prev]);
    setInput('');
    setReplyTarget(null);

    try {
      const sent = await sendTextMessage(peerKey, value, replyId);
      setMessages((prev) =>
        prev.map((item) => (item.id === tempId ? sent ?? { ...item, pending: false } : item)),
      );
    } catch {
      setMessages((prev) =>
        prev.map((item) => (item.id === tempId ? { ...item, pending: false, failed: true } : item)),
      );
    }
  }, [input, peerKey, replyTarget]);

  /** 从相册选图片/视频发送 */
  const handlePickImage = useCallback(async () => {
    try {
      const picked = await pickImage();
      if (!picked) return;
      setUploading(true);
      await sendMedia(peerKey, picked, {
        caption: input.trim() || undefined,
        replyToId: replyTarget?.id,
      });
      setInput('');
      setReplyTarget(null);
      // 上传成功后重新拉一次，让新消息带上真实媒体信息
      const items = await loadMessages(peerKey);
      setMessages(items);
    } catch (err) {
      Alert.alert('发送失败', err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  }, [peerKey, input, replyTarget]);

  /** 选任意文件发送 */
  const handlePickFile = useCallback(async () => {
    try {
      const picked = await pickDocument();
      if (!picked) return;
      setUploading(true);
      await sendMedia(peerKey, { ...picked, asFile: true }, { replyToId: replyTarget?.id });
      setReplyTarget(null);
      const items = await loadMessages(peerKey);
      setMessages(items);
    } catch (err) {
      Alert.alert('发送失败', err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  }, [peerKey, replyTarget]);

  // ---------------------------------------------------------------------------
  // 多选与消息操作
  // ---------------------------------------------------------------------------
  const toggleSelected = useCallback((id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }, []);

  const exitSelecting = useCallback(() => setSelectedIds([]), []);

  /** 单条消息的操作菜单（长按触发） */
  const openMessageActions = useCallback(
    (message: ChatMessage) => {
      const items = ['回复', '转发', '多选'];
      if (message.out) items.push('删除');
      items.push('取消');

      const onSelect = async (index: number) => {
        const label = items[index];
        if (label === '回复') {
          setReplyTarget(message);
        } else if (label === '转发') {
          navigation.navigate('Forward', {
            peerKey,
            messageIds: [message.id],
            grouped: false,
          });
        } else if (label === '多选') {
          setSelectedIds([message.id]);
        } else if (label === '删除') {
          Alert.alert('删除消息', '确定删除这条消息？', [
            { text: '取消', style: 'cancel' },
            {
              text: '删除',
              style: 'destructive',
              onPress: async () => {
                try {
                  await deleteMessages(peerKey, [message.id]);
                  setMessages((prev) => prev.filter((item) => item.id !== message.id));
                } catch {
                  Alert.alert('删除失败', '请稍后重试');
                }
              },
            },
          ]);
        }
      };

      if (Platform.OS === 'ios') {
        ActionSheetIOS.showActionSheetWithOptions(
          { options: items, cancelButtonIndex: items.length - 1 },
          onSelect,
        );
      } else {
        // Android 用 Alert 模拟，避免再引入一个原生依赖
        Alert.alert('消息操作', undefined, [
          ...items.slice(0, -1).map((label, i) => ({ text: label, onPress: () => onSelect(i) })),
          { text: '取消', style: 'cancel' as const },
        ]);
      }
    },
    [navigation, peerKey],
  );

  /** 多选模式下的批量操作 */
  const openBatchActions = useCallback(() => {
    if (!selectedIds.length) return;

    // 判断选中的是否构成一个完整相册：只有同一 groupedId 才算
    const selected = messages.filter((item) => selectedIds.includes(item.id));
    const grouped = selected.length > 1 && selected.every((s) => s.groupedId && s.groupedId === selected[0].groupedId);

    const items = ['转发', '转发整个消息组', '删除', '取消'];
    const onSelect = async (index: number) => {
      const label = items[index];
      if (label === '转发') {
        navigation.navigate('Forward', { peerKey, messageIds: selectedIds, grouped: false });
        exitSelecting();
      } else if (label === '转发整个消息组') {
        // 取选中项里第一个作为锚点，把它所在相册的全部消息一起转发
        const anchor = selectedIds[0];
        const ids = collectGroupedIds(messages, anchor);
        navigation.navigate('Forward', { peerKey, messageIds: ids, grouped: true });
        exitSelecting();
      } else if (label === '删除') {
        Alert.alert('删除消息', `确定删除选中的 ${selectedIds.length} 条消息？`, [
          { text: '取消', style: 'cancel' },
          {
            text: '删除',
            style: 'destructive',
            onPress: async () => {
              try {
                await deleteMessages(peerKey, selectedIds);
                setMessages((prev) => prev.filter((item) => !selectedIds.includes(item.id)));
                exitSelecting();
              } catch {
                Alert.alert('删除失败', '请稍后重试');
              }
            },
          },
        ]);
      }
    };

    // 不在相册里时，把「转发整个消息组」换成不可用的提示
    const shown = grouped ? items : items.filter((x) => x !== '转发整个消息组');

    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { options: shown, cancelButtonIndex: shown.length - 1 },
        (i) => onSelect(items.indexOf(shown[i])),
      );
    } else {
      Alert.alert(`已选 ${selectedIds.length} 条`, undefined, [
        ...shown.slice(0, -1).map((label) => ({
          text: label,
          onPress: () => onSelect(items.indexOf(label)),
        })),
        { text: '取消', style: 'cancel' as const },
      ]);
    }
  }, [selectedIds, messages, navigation, peerKey, exitSelecting]);

  /** 滚动到某条消息（点引用块时用） */
  const scrollToMessage = useCallback(
    (messageId: string) => {
      const index = decoratedMessages.findIndex((item) => item.id === messageId);
      if (index < 0) {
        Alert.alert('找不到原消息', '它可能还没加载出来，向上翻一翻再看看。');
        return;
      }
      try {
        // inverted 列表里 index 就是可视顺序，直接滚过去
        listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.5 });
      } catch {
        // scrollToIndex 在目标未渲染时会抛错，退化成不定位
      }
    },
    [decoratedMessages],
  );

  /** 打开评论页 */
  const openComments = useCallback(
    (message: ChatMessage) => {
      navigation.navigate('Comments', { peerKey, msgId: message.id, title });
    },
    [navigation, peerKey, title],
  );

  const renderItem = useCallback(
    ({ item }: { item: ChatMessage }) => (
      <MessageBubble
        message={item}
        filter={classifyText(item.text, adRule, minorRule)}
        imageUri={imageUris[item.id]}
        imageLoading={loadingImages.current.has(item.id)}
        selecting={selecting}
        selected={selectedIds.includes(item.id)}
        onLongPress={openMessageActions}
        onPress={(msg) => {
          if (selecting) toggleSelected(msg.id);
          else ensureImage(msg);
        }}
        onPressReply={scrollToMessage}
        onPressComments={openComments}
      />
    ),
    [
      adRule,
      minorRule,
      imageUris,
      selecting,
      selectedIds,
      openMessageActions,
      toggleSelected,
      ensureImage,
      scrollToMessage,
      openComments,
    ],
  );

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={0}
    >
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        {selecting ? (
          <>
            <Pressable
              accessibilityRole="button"
              hitSlop={12}
              style={styles.back}
              onPress={exitSelecting}
            >
              <Text style={styles.backText}>取消</Text>
            </Pressable>
            <View style={styles.titleWrap}>
              <Text style={styles.headerTitle} numberOfLines={1}>
                已选 {selectedIds.length} 条
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              hitSlop={12}
              style={styles.back}
              onPress={openBatchActions}
            >
              <Text style={styles.headerAction}>操作</Text>
            </Pressable>
          </>
        ) : (
          <>
            <Pressable
              accessibilityRole="button"
              hitSlop={12}
              style={styles.back}
              onPress={() => navigation.goBack()}
            >
              <Text style={styles.backText}>返回</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              style={styles.titleWrap}
              onPress={() => navigation.navigate('ChatInfo', { peerKey, title })}
            >
              <Text style={styles.headerTitle} numberOfLines={1}>
                {title}
              </Text>
              <Text style={styles.headerSub}>
                {hiddenCount > 0 ? `点击查看群信息 · 已隐藏 ${hiddenCount} 条` : '点击查看群信息'}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              hitSlop={12}
              style={styles.back}
              onPress={() => navigation.navigate('ChatInfo', { peerKey, title })}
            >
              <Text style={styles.headerAction}>详情</Text>
            </Pressable>
          </>
        )}
      </View>

      {error ? (
        <View style={styles.errorBar}>
          <Text style={styles.errorText} numberOfLines={2}>
            {error}
          </Text>
        </View>
      ) : null}

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.centerText}>正在加载消息…</Text>
        </View>
      ) : (
        <FlatList
          ref={listRef}
          style={styles.list}
          data={decoratedMessages}
          inverted
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.4}
          removeClippedSubviews={false}
          ListFooterComponent={
            loadingMore ? <ActivityIndicator style={styles.more} color={colors.primary} /> : null
          }
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Text style={styles.centerText}>
                {hiddenCount > 0 ? '消息都被过滤规则隐藏了' : '还没有消息，打个招呼吧'}
              </Text>
            </View>
          }
        />
      )}

      {/* 回复条：正在回复谁 */}
      {replyTarget && !selecting ? (
        <View style={styles.replyBar}>
          <View style={styles.replyBarLine} />
          <View style={styles.replyBarBody}>
            <Text style={styles.replyBarSender} numberOfLines={1}>
              回复 {replyTarget.out ? '自己' : replyTarget.senderName || title}
            </Text>
            <Text style={styles.replyBarText} numberOfLines={1}>
              {replyTarget.text || (replyTarget.media ? `［${replyTarget.media.label}］` : '')}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            hitSlop={10}
            onPress={() => setReplyTarget(null)}
            style={styles.replyBarClose}
          >
            <Text style={styles.replyBarCloseText}>✕</Text>
          </Pressable>
        </View>
      ) : null}

      {uploading ? (
        <View style={styles.uploadBar}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={styles.uploadText}>正在上传…</Text>
        </View>
      ) : null}

      {!selecting ? (
        <View style={[styles.composer, { paddingBottom: insets.bottom + spacing.sm }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="发送图片或视频"
            hitSlop={8}
            style={styles.attach}
            onPress={handlePickImage}
          >
            <Text style={styles.attachIcon}>＋</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="发送文件"
            hitSlop={8}
            style={styles.attach}
            onPress={handlePickFile}
          >
            <Text style={styles.attachIcon}>▤</Text>
          </Pressable>
          <TextInput
            style={styles.input}
            value={input}
            onChangeText={setInput}
            placeholder="输入消息…"
            placeholderTextColor={colors.textFaint}
            multiline
            maxLength={4096}
            editable={!uploading}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="发送"
            onPress={handleSend}
            disabled={!input.trim() || uploading}
            style={[styles.send, !input.trim() || uploading ? styles.sendDisabled : null]}
          >
            <Text style={styles.sendText}>发送</Text>
          </Pressable>
        </View>
      ) : null}
    </KeyboardAvoidingView>
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
  },
  backText: {
    fontSize: 15,
    color: colors.primary,
  },
  titleWrap: {
    flex: 1,
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
  headerAction: {
    fontSize: 14,
    color: colors.primary,
    fontWeight: '600',
  },
  errorBar: {
    backgroundColor: colors.dangerSoft,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  errorText: {
    fontSize: 12,
    color: colors.danger,
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingVertical: spacing.md,
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
  emptyWrap: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
  },
  more: {
    paddingVertical: spacing.md,
  },
  replyBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.bgAlt,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    gap: spacing.sm,
  },
  replyBarLine: {
    width: 3,
    height: 30,
    borderRadius: 2,
    backgroundColor: colors.primary,
  },
  replyBarBody: {
    flex: 1,
  },
  replyBarSender: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.primaryDark,
  },
  replyBarText: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 1,
  },
  replyBarClose: {
    paddingHorizontal: 4,
  },
  replyBarCloseText: {
    fontSize: 15,
    color: colors.textMuted,
  },
  uploadBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.primarySoft,
  },
  uploadText: {
    fontSize: 12,
    color: colors.primaryDark,
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
  attach: {
    width: 34,
    height: 34,
    borderRadius: radius.pill,
    backgroundColor: colors.bgAlt,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  attachIcon: {
    fontSize: 17,
    color: colors.primaryDark,
    fontWeight: '600',
  },
  input: {
    flex: 1,
    minHeight: 36,
    maxHeight: 120,
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
