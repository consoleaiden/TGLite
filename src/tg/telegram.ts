import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { Api, TelegramClient } from 'telegram';
import { NewMessage } from 'telegram/events';
import { ConnectionTCPObfuscated } from 'telegram/network/connection';
import { computeCheck } from 'telegram/Password';
import { StringSession } from 'telegram/sessions';

import { APP_VERSION, BOOTSTRAP_DC, DIALOG_FETCH_LIMIT, MESSAGE_FETCH_LIMIT } from '../config';
import { applyTransportSettings, type TransportPlan } from '../net/transport';
import { currentSettings } from '../settings';
import {
  groupedIdOf,
  parseMedia,
  pickDiscussionAnchorId,
  pickDiscussionChat,
  type MediaInfo,
} from './media';

const SESSION_KEY = '@tglite/session_v1';
const CREDENTIALS_KEY = '@tglite/credentials_v1';

export interface StoredCredentials {
  apiId: number;
  apiHash: string;
}

export interface MeInfo {
  id: string;
  name: string;
  username: string;
  phone: string;
}

export interface DialogItem {
  key: string;
  title: string;
  isUser: boolean;
  isGroup: boolean;
  isChannel: boolean;
  unreadCount: number;
  pinned: boolean;
  previewText: string;
  previewDate: number;
  verified: boolean;
}

export interface ChatMessage {
  id: string;
  out: boolean;
  text: string;
  date: number;
  kind: 'text' | 'media' | 'service';
  pending?: boolean;
  failed?: boolean;
  /** 媒体信息（图片/视频/文件/贴纸等），纯文本消息为 null */
  media?: MediaInfo | null;
  /** 被回复的那条消息（引用块要展示的内容） */
  replyTo?: ReplyPreview | null;
  /** 消息组（相册）ID，同一批多图/多视频共享，用于整体转发 */
  groupedId?: string | null;
  /** 转发来源（转发消息才有的"转自 xxx"） */
  forwardFrom?: string | null;
  /** 该消息所在讨论组里的评论条数（频道帖子） */
  replyCount?: number;
  /** 频道帖子是否有评论区（有则显示"查看评论"入口） */
  commentsPeer?: { peerKey: string; msgId: string } | null;
  /** 发送者显示名（群聊里需要区分人） */
  senderName?: string;
}

/** 引用块展示所需的最小信息 */
export interface ReplyPreview {
  id: string;
  /** 被回复消息的正文（可能为空，比如对方发的是图片） */
  text: string;
  /** 被回复消息的发送者 */
  senderName: string;
  /** 被回复的是不是自己发的 */
  out: boolean;
}

let client: TelegramClient | null = null;
let credentials: StoredCredentials | null = null;

/** 本次连接实际采用的传输方案，设置页要展示「代理到底有没有生效」 */
let lastTransportPlan: TransportPlan | null = null;

/** peerKey -> InputPeer，避免每次操作都走网络解析 accessHash */
const peerCache = new Map<string, any>();

// ---------------------------------------------------------------------------
// 凭据
// ---------------------------------------------------------------------------
export async function saveCredentials(next: StoredCredentials): Promise<void> {
  credentials = next;
  await AsyncStorage.setItem(CREDENTIALS_KEY, JSON.stringify(next));
}

export async function loadCredentials(): Promise<StoredCredentials | null> {
  if (credentials) return credentials;
  const raw = await AsyncStorage.getItem(CREDENTIALS_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredCredentials;
    if (!parsed || !parsed.apiId || !parsed.apiHash) return null;
    credentials = parsed;
    return parsed;
  } catch {
    return null;
  }
}

export function getCredentials(): StoredCredentials | null {
  return credentials;
}

// ---------------------------------------------------------------------------
// 会话
// ---------------------------------------------------------------------------
export async function readSessionString(): Promise<string> {
  return (await AsyncStorage.getItem(SESSION_KEY)) || '';
}

async function persistSession(): Promise<void> {
  if (!client) return;
  const value = (client.session as any).save?.() || '';
  if (value) await AsyncStorage.setItem(SESSION_KEY, value);
}

// ---------------------------------------------------------------------------
// 客户端实例
// ---------------------------------------------------------------------------
export function getClient(): TelegramClient {
  if (!client) throw new Error('客户端尚未初始化，请先登录。');
  return client;
}

export function isClientReady(): boolean {
  return client !== null;
}

export function lastTransport(): TransportPlan | null {
  return lastTransportPlan;
}

export async function createClient(
  creds: StoredCredentials,
  sessionString = '',
): Promise<TelegramClient> {
  if (client) {
    try {
      await client.disconnect();
    } catch {
      // 忽略旧连接清理失败
    }
    client = null;
  }
  peerCache.clear();

  // 代理 / 通道必须在 new TelegramClient 之前落到 shim 层：
  // GramJS 会在构造函数里就把 networkSocket 定下来，之后再改是无效的。
  const plan = applyTransportSettings(currentSettings());
  lastTransportPlan = plan;

  const session = new StringSession(sessionString);

  const instance = new TelegramClient(session, creds.apiId, creds.apiHash, {
    // 走 obfuscated2 裸 TCP，与官方客户端同款传输层，抗 DPI 且比明文 TCP 稳
    connection: ConnectionTCPObfuscated,
    // 备用通道：MTProto over WebSocket。wss 走系统网络栈，需要 DC 端口为 443。
    networkSocket: plan.networkSocket,
    useWSS: plan.useWSS,
    // 必须显式关闭 IPv6：Client.getDC 会按这个字段过滤 DC 列表
    useIPV6: false,
    connectionRetries: 10,
    retryDelay: 1000,
    autoReconnect: true,
    requestRetries: 3,
    timeout: 20,
    floodSleepThreshold: 60,
    deviceModel: 'TG Lite',
    systemVersion: Platform.OS === 'android' ? `Android ${Platform.Version}` : `iOS ${Platform.Version}`,
    appVersion: APP_VERSION,
    langCode: 'zh',
    systemLangCode: 'zh-CN',
  } as any);

  if (!(session as any).serverAddress) {
    // 新会话：先落到一个真实 DC 的 443 端口。
    // 如果账号在别的 DC，auth.SendCode 会回 PHONE_MIGRATE_x，我们再自动切过去。
    (session as any).setDC(BOOTSTRAP_DC.id, BOOTSTRAP_DC.ip, BOOTSTRAP_DC.port);
  }

  await instance.connect();

  client = instance;
  credentials = creds;
  return instance;
}

/**
 * 按当前设置重建连接。
 * 代理与通道都是「拨号期」参数，改完必须重连才会生效，
 * 这里把旧的实时监听也一并换掉，避免事件挂在已销毁的连接上。
 */
export async function reconnectClient(): Promise<TransportPlan> {
  const creds = credentials ?? (await loadCredentials());
  if (!creds) throw new Error('缺少 api_id / api_hash，请重新登录。');

  const sessionString = await readSessionString();
  await createClient(creds, sessionString);
  const authorized = await isAuthorized();
  if (!authorized) throw new Error('会话已失效，请重新登录。');
  await persistSession();

  return lastTransportPlan as TransportPlan;
}

export async function isAuthorized(): Promise<boolean> {
  if (!client) return false;
  try {
    return await (client as any).checkAuthorization();
  } catch {
    return false;
  }
}

export async function closeClient(): Promise<void> {
  if (!client) return;
  try {
    await client.disconnect();
  } catch {
    // 忽略
  }
  client = null;
}

// ---------------------------------------------------------------------------
// 错误处理工具
// ---------------------------------------------------------------------------
function errorText(err: unknown): string {
  if (!err) return '';
  if (typeof err === 'string') return err;
  const anyErr = err as any;
  return String(anyErr.errorMessage || anyErr.message || anyErr);
}

/** 从 PHONE_MIGRATE_x / NETWORK_MIGRATE_x 之类的错误里取出目标 DC */
function migrateTarget(err: unknown): number | null {
  const anyErr = err as any;
  if (anyErr && typeof anyErr.newDc === 'number' && anyErr.newDc > 0) return anyErr.newDc;
  const matched = /\b(?:PHONE|NETWORK|USER|FILE)_MIGRATE_(\d+)\b/.exec(errorText(err));
  return matched ? Number(matched[1]) : null;
}

/** 把 GramJS 的英文错误码翻译成用户看得懂的话 */
export function humanizeAuthError(err: unknown): string {
  const raw = errorText(err);
  if (!raw) return '操作失败，请重试。';
  if (raw.includes('PHONE_NUMBER_INVALID')) return '手机号格式不正确，请带上国家码（例如 +8613800138000）。';
  if (raw.includes('PHONE_NUMBER_BANNED')) return '该手机号已被 Telegram 封禁。';
  if (raw.includes('API_ID_INVALID') || raw.includes('API_ID_PUBLISHED_FLOOD')) {
    return 'api_id / api_hash 无效，或该组合已被滥用。请到 my.telegram.org 重新申请。';
  }
  if (raw.includes('PHONE_CODE_INVALID')) return '验证码错误，请重新输入。';
  if (raw.includes('PHONE_CODE_EXPIRED')) return '验证码已过期，请重新发送。';
  if (raw.includes('PHONE_CODE_EMPTY')) return '验证码不能为空。';
  if (raw.includes('PASSWORD_HASH_INVALID')) return '两步验证密码错误。';
  if (raw.includes('FLOOD_WAIT')) {
    const seconds = /FLOOD_WAIT_(\d+)/.exec(raw);
    return `操作太频繁，请等待 ${seconds ? seconds[1] : '一会儿'} 秒后重试。`;
  }
  if (raw.includes('NETWORK') || raw.includes('ECONN') || raw.includes('TIMEOUT') || raw.includes('timeout')) {
    return '网络连接失败，请检查网络或代理后重试。';
  }
  if (raw.includes('SESSION_PASSWORD_NEEDED')) return '该账号开启了两步验证，需要输入密码。';
  return raw;
}

// ---------------------------------------------------------------------------
// 登录流程：手机号 -> 验证码 -> （可选）两步验证密码
// ---------------------------------------------------------------------------
export interface CodeRequestResult {
  phoneCodeHash: string;
  isCodeViaApp: boolean;
}

export async function requestLoginCode(phoneNumber: string): Promise<CodeRequestResult> {
  const tg = getClient();
  const creds = credentials;
  if (!creds) throw new Error('缺少 api_id / api_hash。');

  let lastError: unknown = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const result: any = await tg.invoke(
        new Api.auth.SendCode({
          phoneNumber,
          apiId: creds.apiId,
          apiHash: creds.apiHash,
          settings: new Api.CodeSettings({}),
        }),
      );

      if (result instanceof Api.auth.SentCodeSuccess) {
        // 极少数情况：会话仍然有效，直接登录成功
        await persistSession();
        return { phoneCodeHash: '', isCodeViaApp: false };
      }

      return {
        phoneCodeHash: result.phoneCodeHash,
        isCodeViaApp: result.type instanceof Api.auth.SentCodeTypeApp,
      };
    } catch (err) {
      lastError = err;
      const target = migrateTarget(err);
      if (target !== null) {
        // 手机号归属的 DC 和我们当前连的不是同一个，切过去重试
        await (tg as any)._switchDC(target);
        continue;
      }
      if (errorText(err) === 'AUTH_RESTART') continue;
      throw err;
    }
  }
  throw lastError ?? new Error('验证码发送失败。');
}

export async function submitLoginCode(
  phoneNumber: string,
  phoneCodeHash: string,
  phoneCode: string,
): Promise<'ok' | 'need_password'> {
  const tg = getClient();
  try {
    const result: any = await tg.invoke(
      new Api.auth.SignIn({ phoneNumber, phoneCodeHash, phoneCode }),
    );

    if (result instanceof Api.auth.AuthorizationSignUpRequired) {
      throw new Error('该手机号还未注册 Telegram，请先用官方客户端完成注册。');
    }

    await persistSession();
    return 'ok';
  } catch (err) {
    const text = errorText(err);
    if (text.includes('SESSION_PASSWORD_NEEDED')) return 'need_password';
    throw err;
  }
}

export async function fetchPasswordHint(): Promise<string> {
  const tg = getClient();
  try {
    const pwd: any = await tg.invoke(new Api.account.GetPassword());
    return pwd?.hint || '';
  } catch {
    return '';
  }
}

export async function submitTwoFactorPassword(password: string): Promise<void> {
  const tg = getClient();
  const pwd: any = await tg.invoke(new Api.account.GetPassword());
  const check = await computeCheck(pwd, password);
  await tg.invoke(new Api.auth.CheckPassword({ password: check as any }));
  await persistSession();
}

export async function fetchMe(): Promise<MeInfo> {
  const tg = getClient();
  const me: any = await tg.getMe();
  const name = [me.firstName, me.lastName].filter(Boolean).join(' ').trim();
  return {
    id: String(me.id),
    name: name || me.username || '我',
    username: me.username ? `@${me.username}` : '',
    phone: me.phone ? `+${me.phone}` : '',
  };
}

export async function logout(revokeOnServer: boolean): Promise<void> {
  if (client && revokeOnServer) {
    try {
      await client.connect();
      await client.invoke(new Api.auth.LogOut());
    } catch {
      // 服务端登出失败也要清掉本地会话
    }
  }
  await closeClient();
  peerCache.clear();
  await AsyncStorage.multiRemove([SESSION_KEY]);
}

export async function forgetAll(): Promise<void> {
  await closeClient();
  peerCache.clear();
  credentials = null;
  await AsyncStorage.multiRemove([SESSION_KEY, CREDENTIALS_KEY]);
}

// ---------------------------------------------------------------------------
// 会话列表
// ---------------------------------------------------------------------------
export async function loadDialogs(limit = DIALOG_FETCH_LIMIT): Promise<DialogItem[]> {
  const tg = getClient();
  const raw: any[] = await tg.getDialogs({ limit });

  const items: DialogItem[] = [];
  for (const dialog of raw) {
    if (!dialog || !dialog.entity) continue;
    const key = String(dialog.id);
    peerCache.set(key, dialog.inputEntity);
    items.push({
      key,
      title: dialog.name || dialog.title || '未命名会话',
      isUser: !!dialog.isUser,
      isGroup: !!dialog.isGroup,
      isChannel: !!dialog.isChannel,
      unreadCount: dialog.unreadCount || 0,
      pinned: !!dialog.pinned,
      previewText: previewOf(dialog.message),
      previewDate: Number(dialog.message?.date || dialog.date || 0),
      verified: !!(dialog.entity && dialog.entity.verified),
    });
  }
  return items;
}

export function rememberPeer(key: string, inputEntity: any): void {
  if (key && inputEntity) peerCache.set(key, inputEntity);
}

export function forgetPeer(key: string): void {
  peerCache.delete(key);
}

async function resolvePeer(peerKey: string): Promise<any> {
  const cached = peerCache.get(peerKey);
  if (cached) return cached;
  // 兜底：让 GramJS 用带 mark 的字符串 id 去解析（会走 session / 网络）
  return peerKey;
}

/** 解析出完整实体（自己/用户/群/频道），会走网络并自动进 GramJS 的实体缓存 */
export async function resolveEntity(peerKey: string): Promise<any> {
  const tg = getClient();
  return tg.getEntity(await resolvePeer(peerKey));
}

/** 实体 -> peerKey，与 loadDialogs / 实时消息里的 key 保持同一套规则 */
export async function peerKeyOfEntity(entity: any): Promise<string> {
  const tg = getClient();
  try {
    return String(await (tg as any).getPeerId(entity));
  } catch {
    return '';
  }
}

/** InputChannel / InputChat 之类的 InputPeer，群组管理接口要的就是它 */
export async function getInputEntity(peerKey: string): Promise<any> {
  const tg = getClient();
  return tg.getInputEntity(await resolvePeer(peerKey));
}

// ---------------------------------------------------------------------------
// 消息
// ---------------------------------------------------------------------------
export async function loadMessages(
  peerKey: string,
  limit = MESSAGE_FETCH_LIMIT,
): Promise<ChatMessage[]> {
  const tg = getClient();
  const peer = await resolvePeer(peerKey);
  const messages: any[] = await tg.getMessages(peer, { limit });
  // GramJS 返回顺序是「新 -> 旧」，聊天列表用 inverted FlatList 正好匹配
  return messages
    .map((message) => toChatMessage(message))
    .filter((message): message is ChatMessage => message !== null);
}

export async function loadOlderMessages(
  peerKey: string,
  beforeMessageId: string,
  limit = MESSAGE_FETCH_LIMIT,
): Promise<ChatMessage[]> {
  const tg = getClient();
  const peer = await resolvePeer(peerKey);
  const messages: any[] = await tg.getMessages(peer, { limit, maxId: Number(beforeMessageId) });
  return messages
    .map((message) => toChatMessage(message))
    .filter((message): message is ChatMessage => message !== null);
}

export async function sendTextMessage(
  peerKey: string,
  text: string,
  replyToId?: string,
): Promise<ChatMessage | null> {
  const tg = getClient();
  const peer = await resolvePeer(peerKey);
  const sent: any = await tg.sendMessage(peer, {
    message: text,
    // 传数字 id 才会被当成 reply_to；传 undefined 表示普通消息
    replyTo: replyToId ? Number(replyToId) : undefined,
  });
  return toChatMessage(sent);
}

// ---------------------------------------------------------------------------
// 消息操作：编辑 / 删除 / 转发
// ---------------------------------------------------------------------------

/** 编辑自己发过的文本消息 */
export async function editMessageText(
  peerKey: string,
  messageId: string,
  text: string,
): Promise<ChatMessage | null> {
  const tg = getClient();
  const peer = await resolvePeer(peerKey);
  const edited: any = await tg.editMessage(peer, {
    message: Number(messageId),
    text,
  });
  return toChatMessage(edited);
}

/**
 * 删除消息。
 * revoke=true 会对所有人生效（仅自己发的或自己是管理员时可用）；
 * revoke=false 只删自己这边的记录。
 */
export async function deleteMessages(
  peerKey: string,
  messageIds: string[],
  revoke = true,
): Promise<void> {
  const tg = getClient();
  const peer = await resolvePeer(peerKey);
  await tg.deleteMessages(peer, messageIds.map(Number), { revoke });
}

/**
 * 转发消息到一个或多个目标会话。
 * 传入多个 messageId 时，Telegram 会把它们作为一组转发；
 * 相册（消息组）整体转发就是靠这个：把同一 groupedId 的所有 id 一起传。
 */
export async function forwardMessages(
  fromPeerKey: string,
  messageIds: string[],
  toPeerKeys: string[],
): Promise<void> {
  if (!messageIds.length || !toPeerKeys.length) return;
  const tg = getClient();
  const from = await resolvePeer(fromPeerKey);
  const ids = messageIds.map(Number);

  for (const targetKey of toPeerKeys) {
    const to = await resolvePeer(targetKey);
    await tg.forwardMessages(to, {
      messages: ids,
      fromPeer: from,
    });
  }
}

// 「消息组整体转发」需要挑出同相册的全部 id，
// 实现放在 media.ts（纯函数）以便脱离 RN 环境单测，这里转发出去
export { collectGroupedIds } from './media';

// ---------------------------------------------------------------------------
// 评论（频道帖子的关联讨论组）
// ---------------------------------------------------------------------------

export interface CommentItem {
  id: string;
  text: string;
  date: number;
  senderName: string;
  out: boolean;
  media?: MediaInfo | null;
}

/**
 * 找到频道帖子对应的「讨论组」以及帖子在讨论组里的消息 id。
 *
 * 这里有个容易踩的坑：频道帖子本身只存在于频道里，
 * 而它的评论线程存在于关联讨论组（一个 megagroup）里，
 * 两者是两套 id。GetDiscussionMessage 返回的 messages 里那条
 * 「讨论组中的起始消息」的 id 才是后续要用到的 id，
 * 直接拿频道帖子的 id 去 getReplies / commentTo 都会失败。
 *
 * 这段逻辑与 GramJS 内部 client/messages.js 的 getCommentData 保持一致。
 */
async function resolveDiscussion(
  peerKey: string,
  msgId: string,
): Promise<{ peer: any; msgId: number } | null> {
  const tg = getClient();
  const result: any = await tg.invoke(
    new Api.messages.GetDiscussionMessage({
      peer: await getInputEntity(peerKey),
      msgId: Number(msgId),
    }),
  );

  const messages: any[] = result?.messages || [];
  const chats: any[] = result?.chats || [];

  const anchorId = pickDiscussionAnchorId(messages);
  if (anchorId === null) return null;

  const anchor = messages.find((m: any) => Number(m?.id) === anchorId);
  const chat = pickDiscussionChat(chats, anchor);
  if (!chat) return null;

  return { peer: await tg.getInputEntity(chat), msgId: anchorId };
}

/**
 * 拉取某个频道帖子的评论。
 *
 * 评论存放在帖子的「关联讨论组」里，所以先解析出讨论组，
 * 再用 messages.getReplies 按讨论组里的消息 id 拉取。
 */
export async function loadComments(
  peerKey: string,
  msgId: string,
  limit = 50,
): Promise<CommentItem[]> {
  const tg = getClient();
  const discussion = await resolveDiscussion(peerKey, msgId);
  if (!discussion) {
    // 帖子没开评论，或不是频道帖子 —— 当成「暂无评论」，不当作错误
    return [];
  }

  const result: any = await tg.invoke(
    new Api.messages.GetReplies({
      peer: discussion.peer,
      msgId: discussion.msgId,
      offsetId: 0,
      offsetDate: 0,
      addOffset: 0,
      limit,
      maxId: 0,
      minId: 0,
      hash: BigInt(0) as any,
    }),
  );

  const rawList: any[] = (result as any)?.messages || [];
  const users: any[] = (result as any)?.users || [];
  const userById = new Map<string, any>();
  for (const user of users) userById.set(String(user.id), user);

  const items: CommentItem[] = [];
  for (const message of rawList) {
    // getReplies 会把讨论组里那条「起始消息」（即帖子本身）也放进来，跳过它
    if (String(message?.id) === String(discussion.msgId)) continue;
    if (!message || message.className === 'MessageEmpty') continue;

    const senderId = String(message.fromId?.userId ?? '');
    const sender = userById.get(senderId);
    const name = sender
      ? [sender.firstName, sender.lastName].filter(Boolean).join(' ').trim() || sender.username
      : '';

    const text = String(message.message || '').trim();
    const media = parseMedia(message);
    items.push({
      id: String(message.id),
      text: text || mediaLabel(message),
      date: Number(message.date || 0),
      senderName: name || '未知用户',
      out: !!message.out,
      media,
    });
  }
  return items;
}

/**
 * 判断一个会话是否是「频道」——只有频道帖子才有评论区。
 */
export async function isChannelPeer(peerKey: string): Promise<boolean> {
  try {
    const entity: any = await resolveEntity(peerKey);
    return !!entity?.broadcast;
  } catch {
    return false;
  }
}

/**
 * 在频道帖子的评论区发一条评论。
 *
 * 评论要发到「关联讨论组」，并且 commentTo 必须指向
 * 帖子在讨论组里的那条起始消息 id（不是频道帖子的 id），
 * Telegram 才会把它正确归到该帖的评论线程里。
 */
export async function sendComment(
  peerKey: string,
  msgId: string,
  text: string,
): Promise<void> {
  const tg = getClient();
  const discussion = await resolveDiscussion(peerKey, msgId);
  if (!discussion) {
    throw new Error('这条帖子没有开放评论');
  }

  await tg.sendMessage(discussion.peer, {
    message: text,
    commentTo: discussion.msgId,
  });
}

export async function markPeerRead(peerKey: string): Promise<void> {
  const tg = getClient();
  try {
    const peer = await resolvePeer(peerKey);
    await tg.markAsRead(peer);
  } catch {
    // 已读回执失败不影响主流程
  }
}

export async function resolvePeerTitle(peerKey: string): Promise<string> {
  const tg = getClient();
  try {
    const entity: any = await tg.getEntity(await resolvePeer(peerKey));
    const name = [entity?.firstName, entity?.lastName].filter(Boolean).join(' ').trim();
    return entity?.title || name || entity?.username || '会话';
  } catch {
    return '会话';
  }
}

// ---------------------------------------------------------------------------
// 实时消息
// ---------------------------------------------------------------------------
export type NewMessageHandler = (peerKey: string, message: ChatMessage) => void;

export function subscribeNewMessages(handler: NewMessageHandler): () => void {
  const tg = getClient();
  const event = new NewMessage({});
  const listener = async (update: any) => {
    const raw = update?.message;
    if (!raw) return;
    const peerKey = await peerKeyOf(raw);
    if (!peerKey) return;
    const message = toChatMessage(raw);
    if (message) handler(peerKey, message);
  };
  tg.addEventHandler(listener as any, event);
  return () => {
    try {
      tg.removeEventHandler(listener as any, event);
    } catch {
      // 忽略
    }
  };
}

async function peerKeyOf(rawMessage: any): Promise<string> {
  const tg = client;
  try {
    if (tg) return String(await (tg as any).getPeerId(rawMessage.peerId));
  } catch {
    // 退回到手工解析
  }
  const peer = rawMessage.peerId;
  if (!peer) return '';
  if (peer.userId !== undefined) return String(peer.userId);
  if (peer.chatId !== undefined) return String(-Number(peer.chatId));
  if (peer.channelId !== undefined) return `-100${peer.channelId}`;
  return '';
}

// ---------------------------------------------------------------------------
// 消息 -> UI 结构
// ---------------------------------------------------------------------------
function previewOf(message: any): string {
  if (!message) return '';
  const text = String(message.message || message.text || '').replace(/\s+/g, ' ').trim();
  if (text) return text.slice(0, 90);
  return mediaLabel(message);
}

function mediaLabel(message: any): string {
  if (message?.action) return '[系统消息]';
  const media = message?.media;
  if (!media) return '';
  const name = String(media.className || '');
  if (name.includes('Photo') || name.includes('WebPage')) return '[图片]';
  if (name.includes('Document')) {
    const doc = media.document;
    const mime = String(doc?.mimeType || '');
    if (name.includes('Sticker') || mime.includes('webp')) return '[贴纸]';
    if (mime.includes('video')) return '[视频]';
    if (mime.includes('audio')) return '[音频]';
    return '[文件]';
  }
  if (name.includes('Poll')) return '[投票]';
  if (name.includes('Geo')) return '[位置]';
  if (name.includes('Contact')) return '[联系人]';
  return '[媒体]';
}

/** 从一个 peer 对象里取显示名，用于引用块里的「谁说了这句话」 */
function displayNameOfPeer(entity: any): string {
  if (!entity) return '';
  const name = [entity.firstName, entity.lastName].filter(Boolean).join(' ').trim();
  return entity.title || name || entity.username || '';
}

/** 解析被回复的那条消息，生成引用块需要的信息 */
function toReplyPreview(raw: any): ReplyPreview | null {
  const replied = raw?.replyTo;
  if (!replied) return null;
  const repliedMsg = replied.replyToMsgId !== undefined ? replied : null;
  const msgId = repliedMsg ? repliedMsg.replyToMsgId : replied.replyToTopId;
  if (!msgId) return null;

  // GramJS 的 replyTo 只带 id，正文要另外查。
  // 这里先给出占位，ChatScreen 拉到消息列表后会自动补全
  // （同一条消息通常已在当前列表里）。
  return {
    id: String(msgId),
    text: '',
    senderName: '',
    out: false,
  };
}

/** 转发来源：频道/用户 的显示名 */
function toForwardFrom(raw: any): string | null {
  const fwd = raw?.fwdFrom;
  if (!fwd) return null;
  // 隐藏转发来源时 Telegram 会给 fromName，优先用它
  if (fwd.fromName) return String(fwd.fromName);
  if (fwd.fromId) {
    const id = fwd.fromId;
    if (id.userId !== undefined) return '用户';
    if (id.channelId !== undefined) return '频道';
    if (id.chatId !== undefined) return '群组';
  }
  return '转发的消息';
}

function toChatMessage(raw: any): ChatMessage | null {
  if (!raw) return null;
  const text = String(raw.message || raw.text || '').trim();
  const media = parseMedia(raw);
  const label = text || mediaLabel(raw);
  // 纯文本为空的媒体消息也要显示，所以这里有 media 就放行
  if (!label && !media) return null;

  // 帖子开了评论区才有入口。真正的讨论组 peer 由 loadComments 内部解析，
  // 这里只用来判断"要不要显示评论入口"。
  const commentsPeer = raw.replies
    ? { peerKey: String(raw.replies.channelId ?? ''), msgId: String(raw.id) }
    : null;

  return {
    id: String(raw.id),
    out: !!raw.out,
    text: label,
    date: Number(raw.date || 0),
    kind: raw.action ? 'service' : media ? 'media' : 'text',
    media,
    replyTo: toReplyPreview(raw),
    groupedId: groupedIdOf(raw),
    forwardFrom: toForwardFrom(raw),
    replyCount: Number(raw.replies?.replies || 0) || undefined,
    commentsPeer,
    senderName: raw.sender ? displayNameOfPeer(raw.sender) : undefined,
  };
}
