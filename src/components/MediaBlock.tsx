import React from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing } from '../theme';
import { formatBytes, formatDuration, type MediaInfo } from '../tg/media';

interface MediaBlockProps {
  media: MediaInfo;
  /** 图片的 data uri（已下载完成才有） */
  imageUri?: string | null;
  /** 是否正在加载图片 */
  loading?: boolean;
  /** 被过滤时只展示占位，不显示真实内容 */
  masked?: boolean;
}

/** 根据原始宽高算一个稳定的展示比例，避免加载时布局跳动 */
function aspectRatio(media: MediaInfo): number {
  const w = media.width || 0;
  const h = media.height || 0;
  if (!w || !h) return 4 / 3;
  // 夹在合理区间，防止极端长图把气泡撑爆
  return Math.min(Math.max(w / h, 0.6), 2.4);
}

/**
 * 媒体消息的展示块。
 * 图片/贴纸走 <Image>，其余类型用图标 + 元信息的形式呈现，
 * 不依赖任何额外的原生模块。
 */
export default function MediaBlock({
  media,
  imageUri,
  loading = false,
  masked = false,
}: MediaBlockProps) {
  // 被过滤的媒体不展示真实内容，只给一句提示
  if (masked) {
    return (
      <View style={[styles.placeholder, styles.maskedBox]}>
        <Text style={styles.maskedText}>［媒体内容已被过滤］</Text>
      </View>
    );
  }

  const isVisual = media.kind === 'photo' || media.kind === 'sticker' || media.kind === 'gif';

  if (isVisual) {
    const ratio = aspectRatio(media);
    return (
      <View style={[styles.imageWrap, { aspectRatio: ratio }]}>
        {imageUri ? (
          <Image source={{ uri: imageUri }} style={styles.image} resizeMode="cover" />
        ) : (
          <View style={styles.imageLoading}>
            {loading ? (
              <ActivityIndicator color={colors.primary} />
            ) : (
              <Text style={styles.placeholderText}>{media.kind === 'sticker' ? '贴纸' : '点击加载'}</Text>
            )}
          </View>
        )}
      </View>
    );
  }

  // 非视觉媒体：图标 + 名称 + 元信息
  const icon = iconFor(media);
  const metaParts = [
    media.size ? formatBytes(media.size) : '',
    media.duration ? formatDuration(media.duration) : '',
  ].filter(Boolean);

  return (
    <View style={styles.fileRow}>
      <View style={styles.fileIcon}>
        <Text style={styles.fileIconText}>{icon}</Text>
      </View>
      <View style={styles.fileInfo}>
        <Text style={styles.fileName} numberOfLines={2}>
          {media.label}
        </Text>
        {metaParts.length ? (
          <Text style={styles.fileMeta}>{metaParts.join(' · ')}</Text>
        ) : null}
      </View>
    </View>
  );
}

function iconFor(media: MediaInfo): string {
  switch (media.kind) {
    case 'video':
      return '▶';
    case 'audio':
      return '♪';
    case 'voice':
      return '◉';
    case 'gif':
      return 'GIF';
    case 'file':
      return '▤';
    default:
      return '▤';
  }
}

const styles = StyleSheet.create({
  imageWrap: {
    width: 220,
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: colors.bgAlt,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  imageLoading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholder: {
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholderText: {
    fontSize: 12,
    color: colors.textFaint,
  },
  maskedBox: {
    backgroundColor: colors.bgAlt,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderStyle: 'dashed',
    width: 200,
  },
  maskedText: {
    fontSize: 12,
    color: colors.textMuted,
  },
  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minWidth: 180,
    maxWidth: 240,
    paddingVertical: 2,
  },
  fileIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fileIconText: {
    fontSize: 14,
    color: colors.primaryDark,
    fontWeight: '700',
  },
  fileInfo: {
    flex: 1,
  },
  fileName: {
    fontSize: 14,
    color: colors.text,
  },
  fileMeta: {
    marginTop: 2,
    fontSize: 11,
    color: colors.textFaint,
  },
});
