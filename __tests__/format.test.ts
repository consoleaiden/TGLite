import { formatDialogTime, formatMessageDay, formatMessageTime, normalizePhone } from '../src/utils/format';

const NOW = new Date('2026-10-14T12:00:00+08:00').getTime();

describe('formatMessageTime', () => {
  it('输出 HH:mm', () => {
    const seconds = Math.floor(new Date('2026-10-14T09:05:00+08:00').getTime() / 1000);
    expect(formatMessageTime(seconds)).toBe('09:05');
  });

  it('空值返回空字符串', () => {
    expect(formatMessageTime(0)).toBe('');
  });
});

describe('formatDialogTime', () => {
  it('今天显示时分', () => {
    const seconds = Math.floor(new Date('2026-10-14T08:30:00+08:00').getTime() / 1000);
    expect(formatDialogTime(seconds, NOW)).toBe('08:30');
  });

  it('昨天显示「昨天」', () => {
    const seconds = Math.floor(new Date('2026-10-13T20:00:00+08:00').getTime() / 1000);
    expect(formatDialogTime(seconds, NOW)).toBe('昨天');
  });
});

describe('formatMessageDay', () => {
  it('跨天时给出日期分组', () => {
    const seconds = Math.floor(new Date('2026-10-01T10:00:00+08:00').getTime() / 1000);
    expect(formatMessageDay(seconds, NOW)).toBe('2026/10/1');
  });
});

describe('normalizePhone', () => {
  it('去掉分隔符并补 +', () => {
    expect(normalizePhone('861 3800-138000')).toBe('+8613800138000');
  });

  it('空输入返回空字符串', () => {
    expect(normalizePhone('   ')).toBe('');
  });
});
