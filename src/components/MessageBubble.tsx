import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AD_PLACEHOLDER, type FilterKind } from '../filters';
import type { ChatMessage } from '../tg/telegram';
import { colors, radius, spacing } from '../theme';
import { formatMessageTime } from '../utils/format';

interface MessageBubbleProps {
  message: ChatMessage;
  /** 关键词过滤的结果：'ad' 折叠展示，'minor' 直接不渲染 */
  filter?: FilterKind;
}

export default function MessageBubble({ message, filter = null }: MessageBubbleProps) {
  // 未成年保护：整条不出现（ChatScreen 已经过滤过一轮，这里再兜一次底）
  if (filter === 'minor') return null;

  const isOut = message.out;
  const isService = message.kind === 'service';

  if (isService) {
    return (
      <View style={styles.serviceRow}>
        <Text style={styles.serviceText}>{message.text}</Text>
      </View>
    );
  }

  if (filter === 'ad') {
    return <FilteredBubble message={message} isOut={isOut} />;
  }

  return (
    <View style={[styles.row, isOut ? styles.rowOut : styles.rowIn]}>
      <View style={[styles.bubble, isOut ? styles.bubbleOut : styles.bubbleIn]}>
        <Text style={styles.text} selectable>
          {message.text}
        </Text>
        <View style={styles.meta}>
          <Text style={styles.time}>{formatMessageTime(message.date)}</Text>
          {isOut ? (
            <Text style={[styles.tick, message.failed ? styles.tickFailed : null]}>
              {message.failed ? '未发送' : message.pending ? '发送中' : '已发送'}
            </Text>
          ) : null}
        </View>
      </View>
    </View>
  );
}

/**
 * 广告消息：默认折叠成一行提示，点一下展开看原文，再点一下收起。
 * 「默认隐藏」是产品要求，所以初始 state 必须是 false。
 */
function FilteredBubble({ message, isOut }: { message: ChatMessage; isOut: boolean }) {
  const [revealed, setRevealed] = useState(false);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={revealed ? '收起被过滤的广告消息' : '展开被过滤的广告消息'}
      onPress={() => setRevealed((prev) => !prev)}
      style={[styles.row, isOut ? styles.rowOut : styles.rowIn]}
    >
      <View style={[styles.bubble, styles.bubbleFiltered]}>
        <View style={styles.filterHead}>
          <Text style={styles.filterBadge}>AD</Text>
          <Text style={styles.filterTitle}>{AD_PLACEHOLDER}</Text>
          <Text style={styles.filterToggle}>{revealed ? '收起' : '点击显示'}</Text>
        </View>
        {revealed ? <Text style={styles.filterBody}>{message.text}</Text> : null}
        <View style={styles.meta}>
          <Text style={styles.time}>{formatMessageTime(message.date)}</Text>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    marginVertical: 2,
    paddingHorizontal: spacing.md,
  },
  rowOut: {
    justifyContent: 'flex-end',
  },
  rowIn: {
    justifyContent: 'flex-start',
  },
  bubble: {
    maxWidth: '82%',
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: 6,
  },
  bubbleOut: {
    backgroundColor: colors.bubbleOut,
    borderBottomRightRadius: radius.sm,
  },
  bubbleIn: {
    backgroundColor: colors.bubbleIn,
    borderBottomLeftRadius: radius.sm,
  },
  bubbleFiltered: {
    maxWidth: '86%',
    backgroundColor: colors.bgAlt,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderStyle: 'dashed',
    borderBottomLeftRadius: radius.sm,
    borderBottomRightRadius: radius.sm,
  },
  filterHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  filterBadge: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.textFaint,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  filterTitle: {
    flex: 1,
    fontSize: 13,
    color: colors.textMuted,
  },
  filterToggle: {
    fontSize: 12,
    color: colors.primary,
    fontWeight: '600',
  },
  filterBody: {
    marginTop: spacing.sm,
    fontSize: 14,
    lineHeight: 20,
    color: colors.textMuted,
  },
  text: {
    fontSize: 15,
    lineHeight: 21,
    color: colors.text,
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginTop: 2,
    gap: 6,
  },
  time: {
    fontSize: 11,
    color: colors.textFaint,
  },
  tick: {
    fontSize: 11,
    color: colors.textFaint,
  },
  tickFailed: {
    color: colors.danger,
  },
  serviceRow: {
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  serviceText: {
    fontSize: 12,
    color: colors.textMuted,
    backgroundColor: colors.bgAlt,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
});
