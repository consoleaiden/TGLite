import { create } from 'zustand';

import type { DialogItem, MeInfo } from './tg/telegram';

export type AppStage = 'booting' | 'needs_credentials' | 'login' | 'ready';

interface AppState {
  stage: AppStage;
  me: MeInfo | null;
  dialogs: DialogItem[];
  dialogsLoading: boolean;
  dialogsError: string | null;
  /** 每个会话的未读数本地快照，用于收到新消息时即时更新红点 */
  unread: Record<string, number>;

  setStage: (stage: AppStage) => void;
  setMe: (me: MeInfo | null) => void;
  setDialogs: (dialogs: DialogItem[]) => void;
  setDialogsLoading: (loading: boolean) => void;
  setDialogsError: (error: string | null) => void;
  bumpUnread: (peerKey: string) => void;
  clearUnread: (peerKey: string) => void;
  /** 收到新消息时把对应会话顶到最前面并更新预览 */
  applyIncoming: (peerKey: string, previewText: string, previewDate: number) => void;
  reset: () => void;
}

const initialState = {
  stage: 'booting' as AppStage,
  me: null,
  dialogs: [] as DialogItem[],
  dialogsLoading: false,
  dialogsError: null as string | null,
  unread: {} as Record<string, number>,
};

export const useAppStore = create<AppState>((set) => ({
  ...initialState,

  setStage: (stage) => set({ stage }),
  setMe: (me) => set({ me }),
  setDialogs: (dialogs) =>
    set(() => {
      const unread: Record<string, number> = {};
      dialogs.forEach((dialog) => {
        unread[dialog.key] = dialog.unreadCount || 0;
      });
      return { dialogs, unread };
    }),
  setDialogsLoading: (dialogsLoading) => set({ dialogsLoading }),
  setDialogsError: (dialogsError) => set({ dialogsError }),

  bumpUnread: (peerKey) =>
    set((state) => ({ unread: { ...state.unread, [peerKey]: (state.unread[peerKey] || 0) + 1 } })),

  clearUnread: (peerKey) =>
    set((state) => ({ unread: { ...state.unread, [peerKey]: 0 } })),

  applyIncoming: (peerKey, previewText, previewDate) =>
    set((state) => {
      const target = state.dialogs.find((dialog) => dialog.key === peerKey);
      if (!target) return state;
      const updated: DialogItem = {
        ...target,
        previewText,
        previewDate,
        // 未读数以 unread 快照为准（自己发的消息不会让红点增加）
        unreadCount: state.unread[peerKey] ?? target.unreadCount,
      };
      const rest = state.dialogs.filter((dialog) => dialog.key !== peerKey);
      return { dialogs: [updated, ...rest] };
    }),

  reset: () => set({ ...initialState, stage: 'login' }),
}));
