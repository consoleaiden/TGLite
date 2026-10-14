/** 时间显示工具 */
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** 会话列表里的时间：今天显示时分，昨天显示「昨天」，一周内显示周几，更早显示日期 */
export function formatDialogTime(seconds: number, now = Date.now()): string {
  if (!seconds) return '';
  const date = new Date(seconds * 1000);
  const diffDays = Math.round((startOfDay(new Date(now)) - startOfDay(date)) / 86400000);
  if (diffDays <= 0) return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  if (diffDays === 1) return '昨天';
  if (diffDays < 7) return WEEKDAYS[date.getDay()];
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

/** 气泡里的时间戳：HH:mm */
export function formatMessageTime(seconds: number): string {
  if (!seconds) return '';
  const date = new Date(seconds * 1000);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 会话列表的日期分组标题 */
export function formatMessageDay(seconds: number, now = Date.now()): string {
  if (!seconds) return '';
  const date = new Date(seconds * 1000);
  const diffDays = Math.round((startOfDay(new Date(now)) - startOfDay(date)) / 86400000);
  if (diffDays <= 0) return '今天';
  if (diffDays === 1) return '昨天';
  if (diffDays < 7) return WEEKDAYS[date.getDay()];
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
}

/** 把用户输入的手机号标准化成 Telegram 需要的 E.164 形式 */
export function normalizePhone(input: string): string {
  const trimmed = (input || '').trim();
  const digits = trimmed.replace(/[^\d]/g, '');
  if (!digits) return '';
  return `+${digits}`;
}

export function looksLikePhone(input: string): boolean {
  return /^\+\d{6,15}$/.test(normalizePhone(input));
}

/**
 * 判断一个错误是不是「连不上网」这一类。
 *
 * 用途：登录页在建连失败时，如果确认是网络问题，
 * 就额外提示用户去配置代理——因为在直连不通的网络里，
 * 只告诉用户"连接超时"帮不上任何忙。
 *
 * 这里刻意只认网络层的关键字，不认 Telegram 的业务错误码
 * （比如 PHONE_NUMBER_INVALID 不该引导去配代理）。
 */
export function looksLikeNetworkError(err: unknown): boolean {
  // 把下划线统一成空格再比对：
  // 同一类错误在不同层可能写成 NETWORK_REQUEST_FAILED（常量）
  // 或 "Network request failed"（RN 的报错文案），只留一种写法会漏判。
  const text = errorToText(err).toUpperCase().replace(/_/g, ' ');
  if (!text) return false;

  const NETWORK_HINTS = [
    'TIMEOUT',
    'ETIMEDOUT',
    'ECONNREFUSED',
    'ECONNRESET',
    'EHOSTUNREACH',
    'ENETUNREACH',
    'NETWORK IS UNREACHABLE',
    'NETWORK REQUEST FAILED',
    'CONNECTION CLOSED',
    'CONNECTION RESET',
    'CONNECTION REFUSED',
    'SOCKET HANG UP',
    'SOCKET CLOSED',
    'CLIENT NETWORK ERROR',
    'UNDERLYING NETWORK',
    'FAILED TO CONNECT',
    'CANNOT CONNECT',
    'COULD NOT CONNECT',
    '代理',
    '隧道',
    '超时',
  ];
  return NETWORK_HINTS.some((hint) => text.includes(hint));
}

/** 从各种形态的错误里抽出一段可搜索的文本 */
function errorToText(err: unknown): string {
  if (!err) return '';
  if (typeof err === 'string') return err;
  const anyErr = err as { errorMessage?: unknown; message?: unknown };
  if (typeof anyErr.errorMessage === 'string') return anyErr.errorMessage;
  if (typeof anyErr.message === 'string') return anyErr.message;
  try {
    return String(err);
  } catch {
    return '';
  }
}
