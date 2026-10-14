import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AD_PLACEHOLDER, type FilterKind } from '../filters';
import type { ChatMessage } from '../tg/telegram';
import { colors, radius, spacing } from '../theme';
import { formatMessageTime } from '../utils/format';
import MediaBlock from './MediaBlock';

interface MessageBubbleProps {
  message: ChatMessage;
  /** 关键词过滤的结果：'ad' 折叠展示，'minor' 直接不渲染 */
  filter?: FilterKind;
  /** 图片已下载好的 data uri（按 messageId 索引，由 ChatScreen 维护） */
  imageUri?: string | null;
  /** 图片是否正在加载 */
  imageLoading?: boolean;
  /** 是否为多选模式下的选中项 */
  selected?: boolean;
  /** 多选模式开关 */
  selecting?: boolean;
  /** 长按气泡（进入多选 / 弹操作菜单） */
  onLongPress?: (message: ChatMessage) => void;
  /** 点击（多选模式下切换选中） */
  onPress?: (message: ChatMessage) => void;
  /** 点击引用块，跳到被回复的那条 */
  onPressReply?: (messageId: string) => void;
  /** 点击「评论」入口 */
  onPressComments?: (message: ChatMessage) => void;
}

export default function MessageBubble({
  message,
  filter = null,
  imageUri,
  imageLoading,
  selected = false,
  selecting = false,
  onLongPress,
  onPress,
  onPressReply,
  onPressComments,
}: MessageBubbleProps) {
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
    return <FilteredBubble message={message} isOut={isOut} selecting={selecting} />;
  }

  const hasMedia = !!message.media;

  const body = (
    <View style={[styles.bubble, isOut ? styles.bubbleOut : styles.bubbleIn]}>
      {/* 转发来源 */}
      {message.forwardFrom ? (
        <Text style={styles.forwardFrom} numberOfLines={1}>
          转发自 {message.forwardFrom}
        </Text>
      ) : null}

      {/* 群聊里显示发送者，方便区分谁说的话 */}
      {!isOut && message.senderName ? (
        <Text style={styles.sender} numberOfLines={1}>
          {message.senderName}
        </Text>
      ) : null}

      {/* 引用块 */}
      {message.replyTo ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="查看被回复的消息"
          onPress={() => onPressReply?.(message.replyTo!.id)}
          style={styles.replyBox}
        >
          <View style={styles.replyBar} />
          <View style={styles.replyContent}>
            <Text style={styles.replySender} numberOfLines={1}>
              {message.replyTo.out ? '你' : message.replyTo.senderName || '消息'}
            </Text>
            <Text style={styles.replyText} numberOfLines={2}>
              {message.replyTo.text || '［原始消息已不在当前范围］'}
            </Text>
          </View>
        </Pressable>
      ) : null}

      {/* 媒体 */}
      {hasMedia ? (
        <View style={message.text ? styles.mediaWithCaption : undefined}>
          <MediaBlock
            media={message.media!}
            imageUri={imageUri}
            loading={imageLoading}
          />
        </View>
      ) : null}

      {/* 正文：媒体消息的说明文字用次要样式，避免抢视觉 */}
      {message.text ? (
        <Text style={[styles.text, hasMedia ? styles.caption : null]} selectable>
          {message.text}
        </Text>
      ) : null}

      {/* 频道帖子的评论入口 */}
      {message.replyCount !== undefined || message.commentsPeer ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="查看评论"
          onPress={() => onPressComments?.(message)}
          style={styles.commentsRow}
        >
          <Text style={styles.commentsText}>
            {message.replyCount ? `💬 ${message.replyCount} 条评论` : '💬 查看评论'}
          </Text>
        </Pressable>
      ) : null}

      <View style={styles.meta}>
        {message.groupedId ? <Text style={styles.groupTag}>组</Text> : null}
        <Text style={styles.time}>{formatMessageTime(message.date)}</Text>
        {isOut ? (
          <Text style={[styles.tick, message.failed ? styles.tickFailed : null]}>
            {message.failed ? '未发送' : message.pending ? '发送中' : '已发送'}
          </Text>
        ) : null}
      </View>
    </View>
  );

  // 多选模式：整行可点，右侧带勾选圈
  if (selecting) {
    return (
      <Pressable
        accessibilityRole="button"
        onPress={() => onPress?.(message)}
        style={[styles.row, isOut ? styles.rowOut : styles.rowIn]}
      >
        <View style={[styles.check, selected ? styles.checkOn : null]}>
          {selected ? <Text style={styles.checkMark}>✓</Text> : null}
        </View>
        <View style={[styles.selectBody, selected ? styles.selectBodyOn : null]}>{body}</View>
      </Pressable>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      onLongPress={() => onLongPress?.(message)}
      onPress={() => onPress?.(message)}
      style={[styles.row, isOut ? styles.rowOut : styles.rowIn]}
    >
      {body}
    </Pressable>
  );
}

/**
 * 广告消息：默认折叠成一行提示，点一下展开看原文，再点一下收起。
 * 「默认隐藏」是产品要求，所以初始 state 必须是 false。
 */
function FilteredBubble({
  message,
  isOut,
  selecting,
}: {
  message: ChatMessage;
  isOut: boolean;
  selecting?: boolean;
}) {
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
          {selecting ? null : (
            <Text style={styles.filterToggle}>{revealed ? '收起' : '点击显示'}</Text>
          )}
        </View>
        {revealed ? (
          <>
            {/* 广告消息也可能带媒体，展开时一并显示（媒体同样标注为被过滤） */}
            {message.media ? <MediaBlock media={message.media} masked /> : null}
            <Text style={styles.filterBody}>{message.text}</Text>
          </>
        ) : null}
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
    alignItems: 'center',
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
  forwardFrom: {
    fontSize: 12,
    color: colors.primaryDark,
    marginBottom: 2,
  },
  sender: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.primaryDark,
    marginBottom: 2,
  },
  replyBox: {
    flexDirection: 'row',
    marginBottom: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: 'rgba(42, 171, 238, 0.10)',
    overflow: 'hidden',
  },
  replyBar: {
    width: 3,
    backgroundColor: colors.primary,
  },
  replyContent: {
    flex: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  replySender: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.primaryDark,
  },
  replyText: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 1,
  },
  mediaWithCaption: {
    marginBottom: 4,
  },
  text: {
    fontSize: 15,
    lineHeight: 21,
    color: colors.text,
  },
  caption: {
    marginTop: 4,
    fontSize: 14,
  },
  commentsRow: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  commentsText: {
    fontSize: 12,
    color: colors.primaryDark,
    fontWeight: '600',
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginTop: 2,
    gap: 6,
  },
  groupTag: {
    fontSize: 9,
    color: colors.textFaint,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: 3,
    paddingHorizontal: 3,
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
  check: {
    width: 22,
    height: 22,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
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
  selectBody: {
    flexShrink: 1,
    borderRadius: radius.md,
  },
  selectBodyOn: {
    backgroundColor: colors.primarySoft,
  },
});
