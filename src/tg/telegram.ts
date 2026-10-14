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

export async function sendTextMessage(peerKey: string, text: string): Promise<ChatMessage | null> {
  const tg = getClient();
  const peer = await resolvePeer(peerKey);
  const sent: any = await tg.sendMessage(peer, { message: text });
  return toChatMessage(sent);
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

function toChatMessage(raw: any): ChatMessage | null {
  if (!raw) return null;
  const text = String(raw.message || raw.text || '').trim();
  const label = text || mediaLabel(raw);
  if (!label) return null;
  return {
    id: String(raw.id),
    out: !!raw.out,
    text: label,
    date: Number(raw.date || 0),
    kind: text ? 'text' : raw.action ? 'service' : 'media',
  };
}
