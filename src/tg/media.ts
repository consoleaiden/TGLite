/**
 * 媒体消息的解析：把 GramJS 的 raw message 归一化成 UI 能直接用的结构。
 *
 * 单独放一个文件且不 import react-native，这样可以用 jest 直接测
 * （和 filters.ts / links.ts 一样的思路）。
 */

export type MediaKind =
  | 'photo'
  | 'video'
  | 'audio'
  | 'voice'
  | 'sticker'
  | 'gif'
  | 'file'
  | 'webpage'
  | 'poll'
  | 'geo'
  | 'contact'
  | null;

export interface MediaInfo {
  kind: MediaKind;
  /** 展示名：文件名 / 「图片」/「视频」等 */
  label: string;
  /** 文件名（文档类才有） */
  fileName?: string;
  /** MIME 类型 */
  mimeType?: string;
  /** 字节数 */
  size?: number;
  /** 图片/视频宽高，用于自适应占位 */
  width?: number;
  height?: number;
  /** 时长（秒），音视频才有 */
  duration?: number;
  /** 文档的 accessHash 等下载所需信息不放进这儿，下载时按 messageId 重新解析 */
  /** 是否可下载（有真实文件内容） */
  downloadable: boolean;
}

/** 把字节数格式化成人类可读的字符串 */
export function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  // 小于 10 的保留一位小数，读起来更有信息量
  const fixed = value >= 10 || unit === 0 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${fixed} ${units[unit]}`;
}

/** 把秒数格式化成 mm:ss 或 h:mm:ss */
export function formatDuration(seconds?: number): string {
  if (!seconds || seconds <= 0) return '';
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** 从文档的 attributes 里挖出文件名、时长、宽高 */
function readDocumentAttributes(doc: any): Partial<MediaInfo> {
  const out: Partial<MediaInfo> = {};
  const attrs: any[] = doc?.attributes || [];
  for (const attr of attrs) {
    const name = String(attr?.className || '');
    if (name.includes('DocumentAttributeFilename')) {
      out.fileName = String(attr.fileName || '');
    } else if (name.includes('DocumentAttributeVideo')) {
      out.width = Number(attr.w || 0) || undefined;
      out.height = Number(attr.h || 0) || undefined;
      out.duration = Number(attr.duration || 0) || undefined;
    } else if (name.includes('DocumentAttributeAudio')) {
      out.duration = Number(attr.duration || 0) || undefined;
    } else if (name.includes('DocumentAttributeImageSize')) {
      out.width = Number(attr.w || 0) || undefined;
      out.height = Number(attr.h || 0) || undefined;
    }
  }
  return out;
}

/**
 * 解析一条消息的媒体信息。
 * 返回 null 表示这条消息没有媒体（纯文本或纯系统消息）。
 */
export function parseMedia(raw: any): MediaInfo | null {
  const media = raw?.media;
  if (!media) return null;

  const mediaName = String(media.className || '');

  // Telegram 用 MessageMediaEmpty 显式表示"这条消息没有媒体"，
  // 不早退的话会掉进最后的兜底分支，把纯文本消息显示成 [媒体]。
  if (mediaName.includes('MessageMediaEmpty')) return null;

  // ---- 图片 ----
  if (mediaName.includes('MessageMediaPhoto')) {
    const photo = media.photo;
    if (!photo || String(photo.className || '').includes('Empty')) return null;
    let width: number | undefined;
    let height: number | undefined;
    const sizes: any[] = photo.sizes || [];
    for (const size of sizes) {
      const w = Number(size?.w || 0);
      const h = Number(size?.h || 0);
      if (w && h) {
        // 取最大的那个尺寸做占位比例
        if (!width || w * h > width * (height || 0)) {
          width = w;
          height = h;
        }
      }
    }
    return { kind: 'photo', label: '图片', width, height, downloadable: true };
  }

  // ---- 网页预览（可含图片）----
  if (mediaName.includes('MessageMediaWebPage')) {
    const page = media.webpage;
    const pageName = String(page?.className || '');
    if (pageName.includes('Empty')) return null;
    // WebPagePhoto 视为图片，其余只当链接预览
    return {
      kind: 'webpage',
      label: String(page?.title || page?.siteName || '链接'),
      downloadable: false,
    };
  }

  // ---- 文档（视频/音频/语音/贴纸/文件都在这）----
  if (mediaName.includes('MessageMediaDocument')) {
    const doc = media.document;
    if (!doc || String(doc.className || '').includes('Empty')) return null;

    const mime = String(doc.mimeType || '');
    const extra = readDocumentAttributes(doc);
    const size = Number(doc.size || 0) || undefined;

    // 贴纸：image/webp 且带 Sticker attribute
    const isSticker = (doc.attributes || []).some((a: any) =>
      String(a?.className || '').includes('DocumentAttributeSticker'),
    );
    if (isSticker || mime === 'image/webp') {
      return { kind: 'sticker', label: '贴纸', mimeType: mime, size, ...extra, downloadable: true };
    }

    // 动图：video/mp4 且没有音频、或者标记为 animated
    const isAnimated = (doc.attributes || []).some((a: any) => a?.className?.includes('Animated'));
    if (mime === 'image/gif' || (isAnimated && mime.startsWith('video/'))) {
      return { kind: 'gif', label: '动图', mimeType: mime, size, ...extra, downloadable: true };
    }

    // 语音：audio/ogg 且带 Voice attribute
    const isVoice = (doc.attributes || []).some((a: any) =>
      String(a?.className || '').includes('DocumentAttributeAudio') && a?.voice,
    );
    if (isVoice) {
      return { kind: 'voice', label: '语音', mimeType: mime, size, ...extra, downloadable: true };
    }

    if (mime.startsWith('video/')) {
      return { kind: 'video', label: '视频', mimeType: mime, size, ...extra, downloadable: true };
    }

    if (mime.startsWith('audio/')) {
      return {
        kind: 'audio',
        label: extra.fileName || '音频',
        mimeType: mime,
        size,
        ...extra,
        downloadable: true,
      };
    }

    return {
      kind: 'file',
      // 没有文件名就退回 MIME 的类型名，别让用户看到空白
      label: extra.fileName || mime || '文件',
      mimeType: mime,
      size,
      ...extra,
      downloadable: true,
    };
  }

  if (mediaName.includes('MessageMediaPoll')) {
    return { kind: 'poll', label: '投票', downloadable: false };
  }
  if (mediaName.includes('MessageMediaGeo')) {
    return { kind: 'geo', label: '位置', downloadable: false };
  }
  if (mediaName.includes('MessageMediaContact')) {
    return { kind: 'contact', label: '联系人', downloadable: false };
  }

  return { kind: 'file', label: '媒体', downloadable: false };
}

/**
 * 消息组（相册）判定。
 * Telegram 把同一批多图/多视频放进同一 groupedId，转发的"整体"就是它。
 */
export function groupedIdOf(raw: any): string | null {
  const grouped = raw?.groupedId;
  if (grouped === undefined || grouped === null) return null;
  // GramJS 里是 bigInt，toString 后做 key
  const text = String(grouped);
  return text && text !== '0' ? text : null;
}

/**
 * 从已加载的消息列表里，挑出与锚点消息同属一个相册的全部 id。
 *
 * 放在这里（而不是 telegram.ts）是为了能脱离 RN 环境直接测：
 * 这是「消息组整体转发」的核心逻辑，必须有测试覆盖。
 *
 * 返回按 id 升序，保证转发出去后的顺序与原来一致。
 */
export function collectGroupedIds(
  messages: Array<{ id: string; groupedId?: string | null }>,
  anchorId: string,
): string[] {
  const anchor = messages.find((item) => item.id === anchorId);
  // 锚点找不到，或它本身不属于任何相册 -> 只转发这一条
  if (!anchor || !anchor.groupedId) return [anchorId];

  const ids = messages
    .filter((item) => item.groupedId && item.groupedId === anchor.groupedId)
    .map((item) => Number(item.id))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);

  return ids.length ? ids.map(String) : [anchorId];
}

// ---------------------------------------------------------------------------
// 频道帖子的评论区定位
// ---------------------------------------------------------------------------

/**
 * 从 messages.getDiscussionMessage 的返回里，解析出「帖子在讨论组里的消息 id」。
 *
 * 为什么需要它：频道帖子（channel post）和它在讨论组里的那条起始消息
 * 是两套完全不同的 id。getReplies / commentTo 要的都是讨论组里的 id，
 * 直接用频道帖子的 id 会失败。判定办法是取 messages 里 id 最小的那条，
 * 与 GramJS 内部 getCommentData 的做法一致。
 *
 * 纯函数，方便单测；真实网络调用在 telegram.ts 的 resolveDiscussion 里。
 */
export function pickDiscussionAnchorId(messages: any[]): number | null {
  if (!Array.isArray(messages) || !messages.length) return null;
  let best: number | null = null;
  for (const message of messages) {
    // 注意 Number(null) === 0 且是有限值，会污染最小值，
    // 所以必须同时要求 id 存在且为正整数
    const raw = message?.id;
    if (raw === null || raw === undefined) continue;
    const id = Number(raw);
    if (!Number.isInteger(id) || id <= 0) continue;
    if (best === null || id < best) best = id;
  }
  return best;
}

/**
 * 从 getDiscussionMessage 返回的 chats 里，找出起始消息所属的那个讨论组。
 * 返回聊天实体（调用方再转成 InputPeer），找不到返回 null。
 */
export function pickDiscussionChat(chats: any[], anchorMessage: any): any | null {
  if (!Array.isArray(chats) || !chats.length) return null;
  const channelId = anchorMessage?.peerId?.channelId;
  if (channelId === undefined || channelId === null) return null;
  return chats.find((chat: any) => String(chat?.id) === String(channelId)) || null;
}
