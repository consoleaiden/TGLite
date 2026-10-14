/**
 * 群组 / 频道的管理与加入退出。
 *
 * 所有写操作都要区分两套接口，这是 Telegram 的历史包袱，绕不开：
 *   · 频道 / 超级群（Api.Channel）→ channels.* 命名空间，参数是 InputChannel
 *   · 基础群（Api.Chat）        → messages.* 命名空间，参数是 chatId
 * 判断错了会直接拿到 `PEER_ID_INVALID`，所以下面每个分支都显式分流。
 */
import { Api, utils } from 'telegram';

import {
  getClient,
  getInputEntity,
  peerKeyOfEntity,
  rememberPeer,
  resolveEntity,
} from './telegram';
import type { JoinTarget } from './links';
import { describeJoinTarget } from './links';

export type ChatKind = 'user' | 'group' | 'channel';

export interface JoinPreview {
  kind: ChatKind;
  /** 超级群也是 channel，用这个字段区分「广播频道」和「超级群」 */
  isBroadcast: boolean;
  title: string;
  about: string;
  membersCount: number;
  username: string;
  alreadyJoined: boolean;
  /** 需要管理员审批才能加入 */
  requestNeeded: boolean;
  verified: boolean;
  /** 已知时直接给 peerKey（已经加入的情况） */
  peerKey: string;
}

export interface ChatInfo {
  peerKey: string;
  kind: ChatKind;
  title: string;
  about: string;
  username: string;
  membersCount: number;
  isBroadcast: boolean;
  isMegagroup: boolean;
  creator: boolean;
  admin: boolean;
  canEditTitle: boolean;
  canEditAbout: boolean;
  canLeave: boolean;
  canDelete: boolean;
  slowmodeSeconds: number;
}

export interface ParticipantItem {
  key: string;
  name: string;
  username: string;
  role: 'creator' | 'admin' | 'member';
}

export interface JoinResult {
  peerKey: string;
  title: string;
}

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------
function classNameOf(value: any): string {
  return String((value && value.className) || '');
}

function displayNameOf(entity: any): string {
  if (!entity) return '';
  const full = [entity.firstName, entity.lastName].filter(Boolean).join(' ').trim();
  return entity.title || full || entity.username || '';
}

/** 群名从 @xxx 链接里取回来时可能是空的，给个兜底 */
function fallbackTitle(entity: any, fallback: string): string {
  return displayNameOf(entity) || fallback || '未命名会话';
}

function peerKeyFallback(entity: any): string {
  const name = classNameOf(entity);
  const id = entity && entity.id != null ? String(entity.id) : '';
  if (!id) return '';
  if (name === 'Channel' || name === 'ChannelForbidden') return `-100${id}`;
  if (name === 'Chat' || name === 'ChatForbidden') return `-${id}`;
  if (name === 'User') return id;
  return '';
}

async function peerKeyOf(entity: any): Promise<string> {
  const key = await peerKeyOfEntity(entity);
  return key || peerKeyFallback(entity);
}

async function inputChannelOf(entity: any): Promise<any> {
  try {
    return utils.getInputChannel(entity);
  } catch (err) {
    throw new Error(
      `该会话不是频道/超级群，无法用 channels.* 接口操作（${err instanceof Error ? err.message : err}）`,
    );
  }
}

/** 统一把服务端错误码翻成人话 */
function friendly(err: unknown): Error {
  const raw = err instanceof Error ? err.message : String((err as any)?.errorMessage || err);
  const map: Array<[RegExp, string]> = [
    [/CHANNEL_PRIVATE/i, '这个群组/频道是私有的，需要有效的邀请链接才能加入。'],
    [/INVITE_HASH_EXPIRED/i, '邀请链接已失效，请让管理员重新生成。'],
    [/INVITE_HASH_INVALID/i, '邀请链接无效，请重新复制。'],
    [/USER_ALREADY_PARTICIPANT/i, '你已经在这个群组/频道里了。'],
    [/CHANNEL_INVALID|PEER_ID_INVALID/i, '找不到这个会话，可能已被解散或你已被移出。'],
    [/CHAT_ADMIN_REQUIRED/i, '需要管理员权限才能执行这个操作。'],
    [/CHAT_WRITE_FORBIDDEN/i, '当前会话不允许这个操作。'],
    [/USER_NOT_PARTICIPANT/i, '你不在这个会话里。'],
    [/CHANNELS_TOO_MUCH/i, '加入的群组/频道太多，请先退出一些。'],
    [/INVITE_REQUEST_SENT/i, '已提交加入申请，等待管理员审批。'],
    [/CHAT_ID_INVALID/i, '不是有效的基础群。'],
    [/USERNAME_INVALID/i, '用户名不存在或格式不对。'],
    [/USERNAME_NOT_OCCUPIED/i, '这个用户名还没有被使用。'],
    [/FLOOD_WAIT_(\d+)/i, '操作太频繁，请稍后重试。'],
    [/CHAT_TITLE_EMPTY/i, '标题不能为空。'],
    [/QUERY_TOO_SHORT/i, '搜索词太短。'],
  ];
  for (const [pattern, message] of map) {
    if (pattern.test(raw)) return new Error(message);
  }
  return new Error(raw || '操作失败，请重试。');
}

// ---------------------------------------------------------------------------
// 加入：预览
// ---------------------------------------------------------------------------
export async function previewJoinTarget(target: JoinTarget): Promise<JoinPreview> {
  if (target.kind === 'error') throw new Error(target.reason);
  const tg = getClient();

  if (target.kind === 'invite') {
    const invite: any = await tg.invoke(new Api.messages.CheckChatInvite({ hash: target.hash }));

    if (invite instanceof Api.ChatInviteAlready || invite instanceof Api.ChatInvitePeek) {
      const chat: any = invite.chat;
      return {
        kind: chatKindOf(chat),
        isBroadcast: !!chat.broadcast,
        title: fallbackTitle(chat, '' as string),
        about: '',
        membersCount: Number(chat.participantsCount || 0),
        username: chat.username ? `@${chat.username}` : '',
        alreadyJoined: true,
        requestNeeded: false,
        verified: !!chat.verified,
        peerKey: await peerKeyOf(chat),
      };
    }

    return {
      kind: invite.channel ? (invite.broadcast ? 'channel' : 'group') : 'group',
      isBroadcast: !!invite.broadcast,
      title: invite.title || '未命名会话',
      about: invite.about || '',
      membersCount: Number(invite.participantsCount || 0),
      username: '',
      alreadyJoined: false,
      requestNeeded: !!invite.requestNeeded,
      verified: !!invite.verified,
      peerKey: '',
    };
  }

  const resolved: any = await tg.invoke(new Api.contacts.ResolveUsername({ username: target.username }));
  const chat = (resolved.chats || [])[0];
  const user = (resolved.users || [])[0];

  if (chat) {
    return {
      kind: chatKindOf(chat),
      isBroadcast: !!chat.broadcast,
      title: fallbackTitle(chat, target.username),
      about: '',
      membersCount: Number(chat.participantsCount || 0),
      username: chat.username ? `@${chat.username}` : `@${target.username}`,
      alreadyJoined: !chat.left,
      requestNeeded: !!chat.joinRequest,
      verified: !!chat.verified,
      peerKey: await peerKeyOf(chat),
    };
  }

  if (user) {
    throw new Error(`@${target.username} 是一个用户账号，不是群组或频道，无法「加入」。`);
  }

  throw new Error(`找不到 ${describeJoinTarget(target)}，请检查用户名是否正确。`);
}

function chatKindOf(chat: any): ChatKind {
  const name = classNameOf(chat);
  if (name === 'Channel' || name === 'ChannelForbidden') {
    return chat.broadcast ? 'channel' : 'group';
  }
  if (name === 'Chat' || name === 'ChatForbidden') return 'group';
  if (name === 'User') return 'user';
  return 'group';
}

// ---------------------------------------------------------------------------
// 加入：执行
// ---------------------------------------------------------------------------
export async function joinByTarget(target: JoinTarget): Promise<JoinResult> {
  if (target.kind === 'error') throw new Error(target.reason);
  const tg = getClient();

  try {
    let result: any;
    if (target.kind === 'invite') {
      result = await tg.invoke(new Api.messages.ImportChatInvite({ hash: target.hash }));
    } else {
      const resolved: any = await tg.invoke(
        new Api.contacts.ResolveUsername({ username: target.username }),
      );
      const chat = (resolved.chats || [])[0];
      if (!chat) {
        throw new Error(`@${target.username} 不是群组或频道，无法加入。`);
      }
      if (chat.left === false) {
        // 已经在里面了，直接把 peerKey 还给调用方，省一次无谓的请求
        return { peerKey: await peerKeyOf(chat), title: fallbackTitle(chat, target.username) };
      }
      result = await tg.invoke(
        new Api.channels.JoinChannel({ channel: await inputChannelOf(chat) }),
      );
    }

    const joined = pickJoinedChat(result, target);
    if (!joined) {
      throw new Error('加入请求已发出，但服务端没有返回会话信息，请到会话列表手动刷新。');
    }
    const peerKeyValue = await peerKeyOf(joined);
    // 立刻把 inputEntity 塞进缓存，随后进入聊天页就不用再解析一次
    try {
      rememberPeer(peerKeyValue, await getInputEntity(peerKeyValue));
    } catch {
      // 缓存失败不影响加入结果
    }
    return { peerKey: peerKeyValue, title: fallbackTitle(joined, '新的会话') };
  } catch (err) {
    throw friendly(err);
  }
}

function pickJoinedChat(updates: any, target: JoinTarget): any {
  const chats: any[] = (updates && updates.chats) || [];
  if (!chats.length) return null;
  if (target.kind === 'username') {
    const matched = chats.find(
      (chat) => String(chat.username || '').toLowerCase() === target.username.toLowerCase(),
    );
    return matched || chats[0];
  }
  return chats[0];
}

// ---------------------------------------------------------------------------
// 群信息
// ---------------------------------------------------------------------------
export async function loadChatInfo(peerKey: string): Promise<ChatInfo> {
  const tg = getClient();
  const entity: any = await resolveEntity(peerKey);
  const name = classNameOf(entity);

  if (name === 'User') {
    return {
      peerKey,
      kind: 'user',
      title: displayNameOf(entity) || '用户',
      about: entity.about || '',
      username: entity.username ? `@${entity.username}` : '',
      membersCount: 0,
      isBroadcast: false,
      isMegagroup: false,
      creator: false,
      admin: false,
      canEditTitle: false,
      canEditAbout: false,
      canLeave: false,
      canDelete: false,
      slowmodeSeconds: 0,
    };
  }

  if (name === 'Channel' || name === 'ChannelForbidden') {
    let about = '';
    let membersCount = Number(entity.participantsCount || 0);
    let slowmodeSeconds = 0;
    try {
      const full: any = await tg.invoke(
        new Api.channels.GetFullChannel({ channel: await inputChannelOf(entity) }),
      );
      const detail = full.fullChat || {};
      about = detail.about || '';
      membersCount = Number(detail.participantsCount ?? membersCount);
      slowmodeSeconds = Number(detail.slowmodeSeconds || 0);
    } catch {
      // 拿不到详细信息时退化成列表里的粗略数据
    }

    const rights = await selfAdminRights(entity);
    const creator = rights.isCreator || !!entity.creator;
    return {
      peerKey,
      kind: entity.broadcast ? 'channel' : 'group',
      title: entity.title || '未命名会话',
      about,
      username: entity.username ? `@${entity.username}` : '',
      membersCount,
      isBroadcast: !!entity.broadcast,
      isMegagroup: !!entity.megagroup,
      creator,
      admin: rights.isAdmin || creator,
      canEditTitle: rights.changeInfo || creator,
      canEditAbout: rights.changeInfo || creator,
      canLeave: true,
      canDelete: creator,
      slowmodeSeconds,
    };
  }

  // 基础群
  let about = '';
  let membersCount = Number(entity.participantsCount || 0);
  try {
    const full: any = await tg.invoke(new Api.messages.GetFullChat({ chatId: entity.id }));
    const detail = full.fullChat || {};
    about = detail.about || '';
    const participants = detail.participants;
    if (participants && Array.isArray(participants.participants)) {
      membersCount = participants.participants.length;
    }
  } catch {
    // 同上
  }

  const rights = entity.adminRights;
  const creator = !!entity.creator;
  const canChangeInfo = creator || !!(rights && rights.changeInfo);

  return {
    peerKey,
    kind: 'group',
    title: entity.title || '未命名群组',
    about,
    username: '',
    membersCount,
    isBroadcast: false,
    isMegagroup: false,
    creator,
    admin: creator || !!(entity.adminRights && (entity.adminRights.deleteMessages || entity.adminRights.banUsers)),
    canEditTitle: canChangeInfo,
    canEditAbout: canChangeInfo,
    canLeave: true,
    canDelete: false,
    slowmodeSeconds: 0,
  };
}

/** 用 channels.getParticipant('me') 拿自己在频道里的权限位 */
async function selfAdminRights(
  entity: any,
): Promise<{ isCreator: boolean; isAdmin: boolean; changeInfo: boolean }> {
  const tg = getClient();
  const empty = { isCreator: false, isAdmin: false, changeInfo: false };
  try {
    const result: any = await tg.invoke(
      new Api.channels.GetParticipant({
        channel: await inputChannelOf(entity),
        participant: new Api.InputPeerSelf(),
      }),
    );
    const participant = result && result.participant;
    const cls = classNameOf(participant);
    if (cls === 'ChannelParticipantCreator') {
      return { isCreator: true, isAdmin: true, changeInfo: true };
    }
    if (cls === 'ChannelParticipantAdmin') {
      const rights = participant.adminRights || {};
      return { isCreator: false, isAdmin: true, changeInfo: !!rights.changeInfo };
    }
    return empty;
  } catch {
    return empty;
  }
}

// ---------------------------------------------------------------------------
// 成员列表
// ---------------------------------------------------------------------------
export async function loadParticipants(
  peerKey: string,
  limit = 50,
  search = '',
): Promise<ParticipantItem[]> {
  const tg = getClient();
  const entity: any = await resolveEntity(peerKey);
  const name = classNameOf(entity);

  if (name === 'User') {
    return [
      {
        key: peerKey,
        name: displayNameOf(entity) || '用户',
        username: entity.username ? `@${entity.username}` : '',
        role: 'member',
      },
    ];
  }

  const users: any[] = await (tg as any).getParticipants(entity, {
    limit,
    search: search.trim() || undefined,
    showTotal: false,
  });

  return users
    .map((user) => {
      const participant = user.participant;
      return {
        key: String(user.id),
        name: displayNameOf(user) || '未知用户',
        username: user.username ? `@${user.username}` : '',
        role: roleOf(participant),
      };
    })
    .filter((item) => item.key);
}

function roleOf(participant: any): 'creator' | 'admin' | 'member' {
  const cls = classNameOf(participant);
  if (cls === 'ChannelParticipantCreator' || cls === 'ChatParticipantCreator') return 'creator';
  if (cls === 'ChannelParticipantAdmin' || cls === 'ChatParticipantAdmin') return 'admin';
  return 'member';
}

// ---------------------------------------------------------------------------
// 退出 / 解散 / 改名
// ---------------------------------------------------------------------------
export async function leaveChat(peerKey: string): Promise<void> {
  const tg = getClient();
  const entity: any = await resolveEntity(peerKey);
  const name = classNameOf(entity);
  try {
    if (name === 'Channel') {
      await tg.invoke(new Api.channels.LeaveChannel({ channel: await inputChannelOf(entity) }));
    } else if (name === 'Chat' || name === 'ChatForbidden') {
      await tg.invoke(new Api.messages.DeleteChatUser({ chatId: entity.id, userId: 'me' }));
    } else {
      throw new Error('私聊没有「退出」这个操作。');
    }
  } catch (err) {
    throw friendly(err);
  }
}

/** 解散并退出，只有创建者能用；基础群 Telegram 本身不提供解散接口 */
export async function deleteChat(peerKey: string): Promise<void> {
  const tg = getClient();
  const entity: any = await resolveEntity(peerKey);
  const name = classNameOf(entity);
  try {
    if (name === 'Channel') {
      await tg.invoke(new Api.channels.DeleteChannel({ channel: await inputChannelOf(entity) }));
      return;
    }
    throw new Error('基础群不支持解散，请先手动把成员移出，或升级为超级群。');
  } catch (err) {
    throw friendly(err);
  }
}

export async function editChatTitle(peerKey: string, title: string): Promise<void> {
  const clean = title.trim();
  if (!clean) throw new Error('标题不能为空。');
  const tg = getClient();
  const entity: any = await resolveEntity(peerKey);
  try {
    if (classNameOf(entity) === 'Channel') {
      await tg.invoke(new Api.channels.EditTitle({ channel: await inputChannelOf(entity), title: clean }));
    } else {
      await tg.invoke(new Api.messages.EditChatTitle({ chatId: entity.id, title: clean }));
    }
  } catch (err) {
    throw friendly(err);
  }
}

export async function editChatAbout(peerKey: string, about: string): Promise<void> {
  const tg = getClient();
  const peer = await getInputEntity(peerKey);
  try {
    await tg.invoke(new Api.messages.EditChatAbout({ peer, about }));
  } catch (err) {
    throw friendly(err);
  }
}
