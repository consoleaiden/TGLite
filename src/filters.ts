/**
 * 关键词过滤：纯逻辑，零 React / React Native 依赖，可以直接被 jest 覆盖。
 *
 * 两套规则共用一个匹配器，但语义不同：
 *   - 广告过滤（ad）  ：命中后消息**折叠**成一条提示，点一下还能展开看原文
 *   - 未成年保护（minor）：命中后消息**彻底不渲染**，连折叠提示都不给
 *
 * 未成年保护优先级更高：同一条消息同时命中两套关键词时，按未成年处理。
 */

export type FilterKind = 'ad' | 'minor' | null;

export interface FilterRule {
  /** 开关打开 **且** 至少有一个有效关键词时才是 true，避免「开了但没填词」的误判 */
  active: boolean;
  keywords: string[];
}

export const INACTIVE_RULE: FilterRule = { active: false, keywords: [] };

/**
 * 把输入框里的原始文本拆成关键词。
 *
 * 支持换行、中英文逗号、分号、竖线分隔，自动去重去空白。
 * 大小写不敏感（匹配时统一转小写），所以这里不额外处理。
 */
export function splitKeywords(raw: string): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const piece of String(raw).split(/[\n\r,，、;；|]+/)) {
    const word = piece.trim();
    if (!word) continue;
    const key = word.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(word);
  }
  return out;
}

export function compileRule(enabled: boolean, raw: string): FilterRule {
  const keywords = splitKeywords(raw);
  return { active: Boolean(enabled) && keywords.length > 0, keywords };
}

/** 返回命中的关键词（用于提示用户是哪一条规则生效），没有命中返回 null */
export function matchKeyword(text: string, keywords: string[]): string | null {
  if (!text || !keywords.length) return null;
  const haystack = text.toLowerCase();
  for (const keyword of keywords) {
    if (haystack.includes(keyword.toLowerCase())) return keyword;
  }
  return null;
}

export function classifyText(text: string, ad: FilterRule, minor: FilterRule): FilterKind {
  if (minor.active && matchKeyword(text, minor.keywords)) return 'minor';
  if (ad.active && matchKeyword(text, ad.keywords)) return 'ad';
  return null;
}

/** 命中未成年保护的消息整条不渲染，广告消息折叠渲染 */
export function shouldDropMessage(kind: FilterKind): boolean {
  return kind === 'minor';
}

export const AD_PLACEHOLDER = '广告消息已过滤';
export const MINOR_PLACEHOLDER = '［已被未成年保护过滤］';
export const AD_PREVIEW_PLACEHOLDER = '［广告消息已过滤］';

/** 会话列表预览文案的遮盖处理 */
export function maskPreviewText(text: string, kind: FilterKind): string {
  if (kind === 'minor') return MINOR_PLACEHOLDER;
  if (kind === 'ad') return AD_PREVIEW_PLACEHOLDER;
  return text;
}
