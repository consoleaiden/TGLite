/**
 * 媒体收发：选择文件、上传、下载。
 *
 * React Native 没有 Node 的文件系统，GramJS 的 CustomFile 支持两种模式：
 *   - path:   有真实路径，GramJS 自己读（RN 里不可用）
 *   - buffer: 直接给字节内容（RN 里必须走这条）
 *
 * 所以流程是：选择器给出 uri -> 用 fetch(uri) 读成 ArrayBuffer -> Buffer -> CustomFile。
 * 这是 RN 里读本地文件的标准办法，不需要额外接 fs。
 */
import { Platform } from 'react-native';
import { Api } from 'telegram';
import { CustomFile } from 'telegram/client/uploads';

import { getClient } from './telegram';
import { parseMedia, type MediaInfo } from './media';

/** 选择器返回的统一结构 */
export interface PickedFile {
  uri: string;
  name: string;
  mimeType?: string;
  /** 选择器一般会给出字节数；没给就靠读出来的 buffer 长度兜底 */
  size?: number;
  /** 图片/视频的尺寸，用于发送前占位 */
  width?: number;
  height?: number;
  /** 视频/音频时长（秒） */
  duration?: number;
  /** 是否标记为音频（语音消息） */
  isVoice?: boolean;
  /** 强制以「文件」方式发送，不走图片/视频压缩 */
  asFile?: boolean;
}

/** 单个文件大小上限：2GB 是 Telegram 客户端侧上限，这里留出安全余量 */
export const MAX_UPLOAD_BYTES = 1.5 * 1024 * 1024 * 1024;

/** 把本地 uri 读成 Buffer（RN 环境下的唯一可行路径） */
export async function readUriAsBuffer(uri: string): Promise<Buffer> {
  const response = await fetch(uri);
  if (!response.ok) {
    throw new Error(`读取文件失败：HTTP ${response.status}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/** 从 uri 里猜一个像样的文件名（选择器偶尔不给 name） */
function fallbackName(uri: string, mimeType?: string): string {
  const raw = decodeURIComponent(uri.split('?')[0] || '');
  const last = raw.split('/').pop() || '';
  if (last && last.includes('.')) return last;
  const ext = mimeType?.split('/')[1] || 'bin';
  return `file-${Date.now()}.${ext}`;
}

/** 归一化：把选择器的返回塞成 PickedFile */
export function normalizePicked(file: Partial<PickedFile> & { uri: string }): PickedFile {
  return {
    uri: file.uri,
    name: file.name || fallbackName(file.uri, file.mimeType),
    mimeType: file.mimeType,
    size: file.size,
    width: file.width,
    height: file.height,
    duration: file.duration,
    isVoice: file.isVoice,
  };
}

/**
 * 发送一个媒体文件。
 * 自动按 MIME 决定是「图片」「视频」「语音」还是「普通文件」，
 * 内部交给 GramJS 的 sendFile 处理（它会自己分片上传）。
 */
export async function sendMedia(
  peerKey: string,
  file: PickedFile,
  options: { caption?: string; replyToId?: string; asFile?: boolean } = {},
): Promise<any> {
  const tg = getClient();
  const peer: any = await (tg as any).getEntity(peerKey);

  // 先读出内容：RN 里拿不到稳定 path，只能给 buffer
  const buffer = await readUriAsBuffer(file.uri);
  if (buffer.length > MAX_UPLOAD_BYTES) {
    throw new Error('文件太大，超过 1.5GB 无法上传');
  }

  const customFile = new CustomFile(file.name, buffer.length, '', buffer);

  const mime = String(file.mimeType || '').toLowerCase();
  const isImage = mime.startsWith('image/') && !file.asFile;
  const isVideo = mime.startsWith('video/') && !file.asFile;

  const sent: any = await tg.sendFile(peer, {
    file: customFile,
    caption: options.caption,
    replyTo: options.replyToId ? Number(options.replyToId) : undefined,
    // 图片走压缩上传（Telegram 会当照片处理），其余按文档发送
    forceDocument: !!file.asFile || (!isImage && !isVideo),
    // 视频带上时长/尺寸，对方才有正确的预览框
    attributes:
      isVideo && (file.duration || file.width)
        ? [
            new Api.DocumentAttributeVideo({
              duration: Math.round(file.duration || 0),
              w: Math.round(file.width || 0),
              h: Math.round(file.height || 0),
              supportsStreaming: true,
            }),
          ]
        : undefined,
  });

  return sent;
}

/**
 * 下载媒体到内存（RN 里没有落盘路径，返回 base64 data uri 供 <Image> 直接用）。
 *
 * 只对图片/贴纸这类小文件调用；视频/大文件应改用 getMediaBytes + 其它方案。
 */
export async function downloadMediaAsDataUri(
  peerKey: string,
  messageId: string,
): Promise<string | null> {
  const tg = getClient();
  const peer: any = await (tg as any).getEntity(peerKey);
  const messages: any[] = await tg.getMessages(peer, { ids: [Number(messageId)] });
  const message = messages?.[0];
  if (!message || !message.media) return null;

  const buffer: any = await (tg as any).downloadMedia(message, {});
  if (!buffer) return null;

  const media = parseMedia(message);
  const mime = media?.mimeType || (media?.kind === 'photo' ? 'image/jpeg' : 'application/octet-stream');
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  return `data:${mime};base64,${bytes.toString('base64')}`;
}

/** 下载媒体为 Buffer（调用方决定怎么用） */
export async function downloadMediaBytes(
  peerKey: string,
  messageId: string,
): Promise<{ buffer: Buffer; media: MediaInfo | null } | null> {
  const tg = getClient();
  const peer: any = await (tg as any).getEntity(peerKey);
  const messages: any[] = await tg.getMessages(peer, { ids: [Number(messageId)] });
  const message = messages?.[0];
  if (!message || !message.media) return null;

  const raw: any = await (tg as any).downloadMedia(message, {});
  if (!raw) return null;
  return {
    buffer: Buffer.isBuffer(raw) ? raw : Buffer.from(raw),
    media: parseMedia(message),
  };
}

/** 平台是否支持"保存到相册"这类能力（Android 需要额外权限，这里只做提示用） */
export const CAN_SAVE_TO_ALBUM = Platform.OS === 'android' || Platform.OS === 'ios';
