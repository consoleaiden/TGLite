import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
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
import type { ChatMessage } from '../tg/telegram';
import { loadMessages, loadOlderMessages, markPeerRead, sendTextMessage } from '../tg/telegram';
import { colors, radius, spacing } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Chat'>;

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

  /** 去重 + 把「发送中」的本地消息替换成服务端返回的真实消息 */
  const mergeMessage = useCallback((incoming: ChatMessage) => {
    setMessages((prev) => {
      if (prev.some((item) => item.id === incoming.id)) return prev;
      if (incoming.out) {
        const pendingIndex = prev.findIndex(
          (item) => item.pending && item.text === incoming.text,
        );
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
        if (items.length < 50) reachedStart.current = true;
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

    const tempId = `local-${Date.now()}`;
    const optimistic: ChatMessage = {
      id: tempId,
      out: true,
      text: value,
      date: Math.floor(Date.now() / 1000),
      kind: 'text',
      pending: true,
    };

    setMessages((prev) => [optimistic, ...prev]);
    setInput('');

    try {
      const sent = await sendTextMessage(peerKey, value);
      setMessages((prev) =>
        prev.map((item) =>
          item.id === tempId ? sent ?? { ...item, pending: false } : item,
        ),
      );
    } catch {
      setMessages((prev) =>
        prev.map((item) =>
          item.id === tempId ? { ...item, pending: false, failed: true } : item,
        ),
      );
    }
  }, [input, peerKey]);

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={0}
    >
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
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
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.centerText}>正在加载消息…</Text>
        </View>
      ) : (
        <FlatList
          style={styles.list}
          data={visibleMessages}
          inverted
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <MessageBubble message={item} filter={classifyText(item.text, adRule, minorRule)} />
          )}
          contentContainerStyle={styles.listContent}
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.4}
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

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={[styles.composer, { paddingBottom: Math.max(insets.bottom, spacing.sm) }]}>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder="发消息…"
          placeholderTextColor={colors.textFaint}
          multiline
        />
        <Pressable
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.send,
            !input.trim() ? styles.sendDisabled : null,
            pressed ? styles.sendPressed : null,
          ]}
          onPress={handleSend}
          disabled={!input.trim()}
        >
          <Text style={styles.sendText}>发送</Text>
        </Pressable>
      </View>
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
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    backgroundColor: colors.bg,
  },
  back: {
    minWidth: 52,
  },
  backText: {
    fontSize: 15,
    color: colors.primary,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.text,
    textAlign: 'center',
  },
  titleWrap: {
    flex: 1,
    alignItems: 'center',
  },
  headerSub: {
    marginTop: 1,
    fontSize: 11,
    color: colors.textFaint,
  },
  headerAction: {
    fontSize: 15,
    color: colors.primary,
    textAlign: 'right',
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingVertical: spacing.md,
    flexGrow: 1,
  },
  more: {
    marginVertical: spacing.md,
  },
  emptyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ scaleY: -1 }],
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  centerText: {
    fontSize: 14,
    color: colors.textMuted,
  },
  error: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    fontSize: 12,
    color: colors.danger,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.bg,
  },
  input: {
    flex: 1,
    maxHeight: 120,
    minHeight: 40,
    borderRadius: radius.lg,
    backgroundColor: colors.bgAlt,
    paddingHorizontal: spacing.md,
    paddingTop: 10,
    paddingBottom: 10,
    fontSize: 15,
    color: colors.text,
  },
  send: {
    height: 40,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendDisabled: {
    opacity: 0.4,
  },
  sendPressed: {
    opacity: 0.8,
  },
  sendText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
});
