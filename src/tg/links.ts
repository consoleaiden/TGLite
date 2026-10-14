/**
 * 加入目标的解析：把用户在输入框里粘贴的一坨东西变成可执行的指令。
 *
 * 支持的形式（这是用户真正会碰到的全部）：
 *   @telegram                     裸用户名
 *   telegram                      裸用户名（没有 @ 也认）
 *   t.me/telegram                 分享链接
 *   https://telegram.me/telegram  老域名
 *   https://t.me/s/telegram       频道预览页链接
 *   https://t.me/+AbCdEf123456    邀请链接（+ 形式）
 *   https://t.me/joinchat/AbCdEf  邀请链接（老形式）
 *
 * 纯函数，无任何网络/平台依赖，直接可测。
 */

export type JoinTarget =
  | { kind: 'username'; username: string }
  | { kind: 'invite'; hash: string }
  | { kind: 'error'; reason: string };

const LINK_HOSTS = ['t.me', 'telegram.me', 'telegram.dog', 'www.t.me', 'www.telegram.me'];

const USERNAME_PATTERN = /^[A-Za-z0-9_]{4,32}$/;
const INVITE_PATTERN = /^[A-Za-z0-9_-]{12,64}$/;

function stripQuery(segment: string): string {
  return segment.split('?')[0].split('#')[0];
}

/** 把输入里的零宽字符、URL 编码的空格等清理掉 */
function sanitize(input: string): string {
  return String(input || '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/%20/g, ' ')
    .trim();
}

function parsePath(path: string, original: string): JoinTarget {
  const segments = path.split('/').filter((segment) => segment.length > 0);

  if (!segments.length) {
    return { kind: 'error', reason: `链接 ${original} 里没有用户名或邀请码。` };
  }

  const [first, second] = segments;

  // t.me/s/<username> —— 频道预览页
  if (first === 's' && second) {
    return parseUsername(stripQuery(second));
  }

  // t.me/c/<id>/<msg> —— 私有群消息链接，无法用来加入
  if (first === 'c') {
    return { kind: 'error', reason: '这是私有群的消息链接，需要用群主发出的邀请链接。' };
  }

  if (first === 'joinchat' && second) {
    return parseInvite(stripQuery(second));
  }

  if (first.startsWith('+')) {
    return parseInvite(stripQuery(first).slice(1));
  }

  return parseUsername(stripQuery(first));
}

function parseUsername(value: string): JoinTarget {
  const username = value.replace(/^@/, '');
  if (!username) {
    return { kind: 'error', reason: '用户名为空。' };
  }
  if (!USERNAME_PATTERN.test(username)) {
    return {
      kind: 'error',
      reason: `「${username}」不是合法的用户名：只能包含字母、数字、下划线，长度 4 - 32。`,
    };
  }
  return { kind: 'username', username };
}

function parseInvite(value: string): JoinTarget {
  const hash = value.replace(/^\+/, '');
  if (!hash) {
    return { kind: 'error', reason: '邀请码为空。' };
  }
  if (!INVITE_PATTERN.test(hash)) {
    return { kind: 'error', reason: `「${hash}」不是合法的邀请码，请重新复制完整的邀请链接。` };
  }
  return { kind: 'invite', hash };
}

export function parseJoinTarget(input: string): JoinTarget {
  const value = sanitize(input);
  if (!value) {
    return { kind: 'error', reason: '请输入 @用户名 或 t.me 邀请链接。' };
  }

  if (value.includes(' ')) {
    return { kind: 'error', reason: '输入里含有空格，请检查是否只粘贴了链接本身。' };
  }

  // 带协议的链接
  const withScheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\/(.*)$/.exec(value);
  if (withScheme) {
    const rest = withScheme[2];
    const slash = rest.indexOf('/');
    const host = (slash >= 0 ? rest.slice(0, slash) : rest).toLowerCase();
    const path = slash >= 0 ? rest.slice(slash + 1) : '';
    if (!LINK_HOSTS.includes(host)) {
      return { kind: 'error', reason: `只支持 t.me / telegram.me 链接，收到的是 ${host}。` };
    }
    return parsePath(path, value);
  }

  // 不带协议但有域名，例如 t.me/xxx
  const bare = value.split('/');
  if (LINK_HOSTS.includes(bare[0].toLowerCase()) && bare.length > 1) {
    return parsePath(bare.slice(1).join('/'), value);
  }

  // 以 @ 开头的裸用户名
  if (value.startsWith('@')) {
    return parseUsername(value);
  }

  // 形如 foo/bar 的东西肯定不是用户名
  if (value.includes('/')) {
    return {
      kind: 'error',
      reason: '无法识别这个链接，请使用 t.me/<用户名>、t.me/+<邀请码> 或直接输入 @用户名。',
    };
  }

  // 最后按裸用户名试一把
  return parseUsername(value);
}

/** 展示用：把解析结果还原成规范写法 */
export function describeJoinTarget(target: JoinTarget): string {
  if (target.kind === 'username') return `@${target.username}`;
  if (target.kind === 'invite') return `邀请码 ${target.hash.slice(0, 8)}…`;
  return target.reason;
}
