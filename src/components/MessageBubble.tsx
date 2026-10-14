import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { ChatMessage } from '../tg/telegram';
import { colors, radius, spacing } from '../theme';
import { formatMessageTime } from '../utils/format';

interface MessageBubbleProps {
  message: ChatMessage;
}

export default function MessageBubble({ message }: MessageBubbleProps) {
  const isOut = message.out;
  const isService = message.kind === 'service';

  if (isService) {
    return (
      <View style={styles.serviceRow}>
        <Text style={styles.serviceText}>{message.text}</Text>
      </View>
    );
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
