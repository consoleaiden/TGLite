/** 极简事件总线：把全局的新消息事件分发给当前打开的聊天页 */
type IncomingListener = (peerKey: string, payload: any) => void;

const listeners = new Set<IncomingListener>();

export function emitIncoming(peerKey: string, payload: any): void {
  listeners.forEach((listener) => {
    try {
      listener(peerKey, payload);
    } catch {
      // 单个订阅者出错不影响其他订阅者
    }
  });
}

export function onIncoming(listener: IncomingListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
