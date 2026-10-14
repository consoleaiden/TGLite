export type RootStackParamList = {
  Login: undefined;
  Code: { phone: string; phoneCodeHash: string; isCodeViaApp: boolean };
  Password: undefined;
  Chats: undefined;
  Chat: { peerKey: string; title: string };
  ChatInfo: { peerKey: string; title: string };
  Join: undefined;
  Settings: undefined;
  Filters: { kind: 'ad' | 'minor' };
  Network: undefined;
  /** 转发目标选择；messageIds 为要转发的消息，grouped 表示是否整组转发 */
  Forward: { peerKey: string; messageIds: string[]; grouped: boolean };
  /** 频道帖子的评论区 */
  Comments: { peerKey: string; msgId: string; title: string };
  /** 切换 API 凭据 */
  ApiCredentials: undefined;
};
