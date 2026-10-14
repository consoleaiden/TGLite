import { formatDialogTime, formatMessageDay, formatMessageTime, normalizePhone } from '../src/utils/format';

/**
 * 时间格式化的实现用的是本地时区（date.getHours()），
 * 这是刻意为之：聊天里该显示用户手机所在时区的时间。
 *
 * 所以测试不能写死 '+08:00' 再断言 '09:05' ——
 * 那只有跑在 UTC+8 的机器上才成立，CI runner 默认是 UTC，会全挂。
 *
 * 这里的做法是「用本地时间构造、用本地时间断言」，
 * 让用例在任何时区下都自洽，同时又真的验证了格式化逻辑。
 */

/** 用本地时间构造某一天的某个时刻，返回秒级时间戳 */
function localSeconds(
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
): number {
  return Math.floor(new Date(y, mo - 1, d, h, mi, 0, 0).getTime() / 1000);
}

/** 取本地「今天」，用于把用例锚定在当天，避免跨时区导致日期漂移 */
function localNow(): { y: number; mo: number; d: number; now: number } {
  const t = new Date();
  return {
    y: t.getFullYear(),
    mo: t.getMonth() + 1,
    d: t.getDate(),
    now: t.getTime(),
  };
}

const TODAY = localNow();
const NOW = TODAY.now;

describe('formatMessageTime', () => {
  it('输出本地时区的 HH:mm', () => {
    const seconds = localSeconds(TODAY.y, TODAY.mo, TODAY.d, 9, 5);
    expect(formatMessageTime(seconds)).toBe('09:05');
  });

  it('个位数时分补零', () => {
    const seconds = localSeconds(TODAY.y, TODAY.mo, TODAY.d, 7, 3);
    expect(formatMessageTime(seconds)).toBe('07:03');
  });

  it('午夜显示 00:00', () => {
    const seconds = localSeconds(TODAY.y, TODAY.mo, TODAY.d, 0, 0);
    expect(formatMessageTime(seconds)).toBe('00:00');
  });

  it('空值返回空字符串', () => {
    expect(formatMessageTime(0)).toBe('');
  });
});

describe('formatDialogTime', () => {
  it('今天显示时分', () => {
    const seconds = localSeconds(TODAY.y, TODAY.mo, TODAY.d, 8, 30);
    expect(formatDialogTime(seconds, NOW)).toBe('08:30');
  });

  it('昨天显示「昨天」', () => {
    // 用 Date 做日期减法，自动处理月末/年末借位，避免手算 13 号出错
    const yesterday = new Date(TODAY.y, TODAY.mo - 1, TODAY.d - 1, 20, 0, 0, 0);
    const seconds = Math.floor(yesterday.getTime() / 1000);
    expect(formatDialogTime(seconds, NOW)).toBe('昨天');
  });

  it('一周内显示周几', () => {
    const threeDaysAgo = new Date(TODAY.y, TODAY.mo - 1, TODAY.d - 3, 12, 0, 0, 0);
    const seconds = Math.floor(threeDaysAgo.getTime() / 1000);
    const expected = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][
      threeDaysAgo.getDay()
    ];
    expect(formatDialogTime(seconds, NOW)).toBe(expected);
  });

  it('更早显示 M/d', () => {
    const longAgo = new Date(TODAY.y, TODAY.mo - 1, TODAY.d - 30, 12, 0, 0, 0);
    const seconds = Math.floor(longAgo.getTime() / 1000);
    const expected = `${longAgo.getMonth() + 1}/${longAgo.getDate()}`;
    expect(formatDialogTime(seconds, NOW)).toBe(expected);
  });
});

describe('formatMessageDay', () => {
  it('当天给出「今天」', () => {
    const seconds = localSeconds(TODAY.y, TODAY.mo, TODAY.d, 10, 0);
    expect(formatMessageDay(seconds, NOW)).toBe('今天');
  });

  it('昨天给出「昨天」', () => {
    const yesterday = new Date(TODAY.y, TODAY.mo - 1, TODAY.d - 1, 10, 0, 0, 0);
    const seconds = Math.floor(yesterday.getTime() / 1000);
    expect(formatMessageDay(seconds, NOW)).toBe('昨天');
  });

  it('跨月更早的日子给出 年/月/日', () => {
    const longAgo = new Date(TODAY.y, TODAY.mo - 1, TODAY.d - 30, 12, 0, 0, 0);
    const seconds = Math.floor(longAgo.getTime() / 1000);
    const expected = `${longAgo.getFullYear()}/${longAgo.getMonth() + 1}/${longAgo.getDate()}`;
    expect(formatMessageDay(seconds, NOW)).toBe(expected);
  });

  it('空值返回空字符串', () => {
    expect(formatMessageDay(0)).toBe('');
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
