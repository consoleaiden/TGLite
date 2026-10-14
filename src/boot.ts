import { useAppStore } from './store';
import {
  createClient,
  fetchMe,
  isAuthorized,
  loadCredentials,
  readSessionString,
  subscribeNewMessages,
} from './tg/telegram';
import { emitIncoming } from './tg/bus';

let unsubscribeRealtime: (() => void) | null = null;
let realtimeAttached = false;

/**
 * 启动流程：
 *   1. 有凭据 + 有可用会话 -> 直接进主界面
 *   2. 否则回到登录页
 */
export async function bootstrapApp(): Promise<void> {
  const store = useAppStore.getState();

  try {
    const creds = await loadCredentials();
    if (!creds) {
      store.setStage('login');
      return;
    }

    const sessionString = await readSessionString();
    if (!sessionString) {
      store.setStage('login');
      return;
    }

    await createClient(creds, sessionString);
    const authorized = await isAuthorized();
    if (!authorized) {
      store.setStage('login');
      return;
    }

    await completeLogin();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    store.setDialogsError(message);
    store.setStage('login');
  }
}

/** 登录成功后：拉取本人信息、切换路由、挂上实时消息监听 */
export async function completeLogin(): Promise<void> {
  const store = useAppStore.getState();
  const me = await fetchMe();
  store.setMe(me);
  store.setStage('ready');
  attachRealtime();
}

/**
 * 全局只挂一次新消息监听：
 *   - 更新会话列表的排序与预览
 *   - 通过事件总线通知当前打开的聊天页
 */
export function attachRealtime(): void {
  if (realtimeAttached) return;
  realtimeAttached = true;

  try {
    unsubscribeRealtime = subscribeNewMessages((peerKey, message) => {
      const store = useAppStore.getState();
      if (!message.out) store.bumpUnread(peerKey);
      store.applyIncoming(peerKey, message.text, message.date);
      emitIncoming(peerKey, message);
    });
  } catch {
    realtimeAttached = false;
  }
}

export function detachRealtime(): void {
  if (unsubscribeRealtime) {
    unsubscribeRealtime();
    unsubscribeRealtime = null;
  }
  realtimeAttached = false;
}
