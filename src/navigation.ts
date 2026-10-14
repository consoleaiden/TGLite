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
  /**
   * 网络与代理。
   * preLogin 为 true 表示从登录页进来的：此时还没有客户端，
   * 保存只落盘配置，不能触发重连（否则会报"会话已失效"）。
   */
  Network: { preLogin?: boolean } | undefined;
  /** 转发目标选择；messageIds 为要转发的消息，grouped 表示是否整组转发 */
  Forward: { peerKey: string; messageIds: string[]; grouped: boolean };
  /** 频道帖子的评论区 */
  Comments: { peerKey: string; msgId: string; title: string };
  /** 切换 API 凭据 */
  ApiCredentials: undefined;
};
