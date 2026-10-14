export type RootStackParamList = {
  Login: undefined;
  Code: { phone: string; phoneCodeHash: string; isCodeViaApp: boolean };
  Password: undefined;
  Chats: undefined;
  Chat: { peerKey: string; title: string };
  Settings: undefined;
};
