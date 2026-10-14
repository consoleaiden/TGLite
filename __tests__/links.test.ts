import { parseJoinTarget } from '../src/tg/links';

describe('parseJoinTarget', () => {
  it('识别 @用户名', () => {
    expect(parseJoinTarget('@telegram')).toEqual({ kind: 'username', username: 'telegram' });
  });

  it('识别没有 @ 的裸用户名', () => {
    expect(parseJoinTarget('telegram')).toEqual({ kind: 'username', username: 'telegram' });
    expect(parseJoinTarget('  my_channel_01  ')).toEqual({
      kind: 'username',
      username: 'my_channel_01',
    });
  });

  it('识别 t.me 分享链接及其各种写法', () => {
    const expected = { kind: 'username', username: 'telegram' };
    expect(parseJoinTarget('t.me/telegram')).toEqual(expected);
    expect(parseJoinTarget('https://t.me/telegram')).toEqual(expected);
    expect(parseJoinTarget('http://t.me/telegram')).toEqual(expected);
    expect(parseJoinTarget('https://telegram.me/telegram')).toEqual(expected);
    expect(parseJoinTarget('https://telegram.dog/telegram')).toEqual(expected);
    expect(parseJoinTarget('https://www.t.me/telegram')).toEqual(expected);
  });

  it('剥掉链接上的查询串', () => {
    expect(parseJoinTarget('https://t.me/telegram?single&comment=1')).toEqual({
      kind: 'username',
      username: 'telegram',
    });
  });

  it('识别 t.me/s/ 频道预览链接', () => {
    expect(parseJoinTarget('https://t.me/s/telegram')).toEqual({
      kind: 'username',
      username: 'telegram',
    });
  });

  it('识别 + 形式的邀请链接', () => {
    expect(parseJoinTarget('https://t.me/+AbCdEfGh1234')).toEqual({
      kind: 'invite',
      hash: 'AbCdEfGh1234',
    });
    expect(parseJoinTarget('t.me/+AbCdEfGh1234')).toEqual({
      kind: 'invite',
      hash: 'AbCdEfGh1234',
    });
  });

  it('识别 joinchat 形式的老邀请链接', () => {
    expect(parseJoinTarget('https://t.me/joinchat/AbCdEfGh1234')).toEqual({
      kind: 'invite',
      hash: 'AbCdEfGh1234',
    });
  });

  it('拒绝私有群消息链接', () => {
    const result = parseJoinTarget('https://t.me/c/123456789/45');
    expect(result.kind).toBe('error');
  });

  it('拒绝非法用户名', () => {
    const result = parseJoinTarget('@ab');
    expect(result.kind).toBe('error');
    if (result.kind === 'error') expect(result.reason).toContain('不是合法的用户名');
  });

  it('拒绝非 t.me 的链接', () => {
    const result = parseJoinTarget('https://example.com/foo');
    expect(result.kind).toBe('error');
    if (result.kind === 'error') expect(result.reason).toContain('只支持 t.me');
  });

  it('拒绝带空格的输入与空输入', () => {
    expect(parseJoinTarget('  ').kind).toBe('error');
    expect(parseJoinTarget('@a b').kind).toBe('error');
    expect(parseJoinTarget('https://t.me/').kind).toBe('error');
  });

  it('清理零宽字符', () => {
    expect(parseJoinTarget('t.me/\u200Btelegram')).toEqual({
      kind: 'username',
      username: 'telegram',
    });
  });
});
