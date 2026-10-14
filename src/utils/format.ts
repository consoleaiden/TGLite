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
