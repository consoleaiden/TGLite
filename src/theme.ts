/** 全局配色与尺寸，跟随浅色主题 */
export const colors = {
  bg: '#FFFFFF',
  bgAlt: '#F2F4F7',
  card: '#FFFFFF',
  border: '#E4E7EC',
  text: '#111827',
  textMuted: '#667085',
  textFaint: '#98A2B3',
  primary: '#2AABEE',
  primaryDark: '#1C8DC7',
  primarySoft: '#E8F4FD',
  danger: '#F04438',
  dangerSoft: '#FEF3F2',
  bubbleIn: '#F2F4F7',
  bubbleOut: '#E1F3FE',
  overlay: 'rgba(16, 24, 40, 0.45)',
  badge: '#2AABEE',
  success: '#12B76A',
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
};

export const radius = {
  sm: 8,
  md: 12,
  lg: 18,
  pill: 999,
};

/** 头像背景色（按 peer id 稳定取色，保证同一会话颜色一致） */
export const avatarPalette = [
  '#F97066',
  '#FDB022',
  '#12B76A',
  '#2AABEE',
  '#7A5AF8',
  '#EE46BC',
  '#0EA5E9',
  '#F04438',
];

export function avatarColorFor(key: string): string {
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + key.charCodeAt(i)) % 100000007;
  }
  return avatarPalette[hash % avatarPalette.length];
}

export function initialsOf(title: string): string {
  const trimmed = (title || '').trim();
  if (!trimmed) return '#';
  const chars = Array.from(trimmed);
  // 中文取前 1 个字，英文取前 2 个字母
  if (/[\u4e00-\u9fa5]/.test(chars[0])) return chars[0];
  return chars.slice(0, 2).join('').toUpperCase();
}
