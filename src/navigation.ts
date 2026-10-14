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
};
