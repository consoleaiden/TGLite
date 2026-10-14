import {
  AD_PLACEHOLDER,
  classifyText,
  compileRule,
  maskPreviewText,
  matchKeyword,
  shouldDropMessage,
  splitKeywords,
} from '../src/filters';

describe('splitKeywords', () => {
  it('按换行与常见分隔符拆分', () => {
    expect(splitKeywords('加微信\n优惠券，领取,免费;抽奖|推广')).toEqual([
      '加微信',
      '优惠券',
      '领取',
      '免费',
      '抽奖',
      '推广',
    ]);
  });

  it('忽略空白与重复项（大小写不敏感去重）', () => {
    expect(splitKeywords('  Spam \n spam \n\n 推广 ')).toEqual(['Spam', '推广']);
  });

  it('空输入返回空数组', () => {
    expect(splitKeywords('')).toEqual([]);
    expect(splitKeywords('   \n ,, ')).toEqual([]);
  });
});

describe('compileRule', () => {
  it('开关关闭时永不生效', () => {
    const rule = compileRule(false, '广告');
    expect(rule.active).toBe(false);
    expect(rule.keywords).toEqual(['广告']);
  });

  it('开关打开但没填关键词时也不生效', () => {
    expect(compileRule(true, '   ').active).toBe(false);
  });

  it('开关打开且有词时生效', () => {
    expect(compileRule(true, '广告').active).toBe(true);
  });
});

describe('matchKeyword', () => {
  it('子串匹配且不区分大小写', () => {
    expect(matchKeyword('快来加VX领取', ['加vx'])).toBe('加vx');
    expect(matchKeyword('HELLO WORLD', ['hello'])).toBe('hello');
  });

  it('没命中返回 null', () => {
    expect(matchKeyword('正常的聊天内容', ['广告'])).toBeNull();
    expect(matchKeyword('', ['广告'])).toBeNull();
    expect(matchKeyword('内容', [])).toBeNull();
  });
});

describe('classifyText', () => {
  const ad = compileRule(true, '优惠券');
  const minor = compileRule(true, '赌博');

  it('未成年保护优先级高于广告', () => {
    expect(classifyText('优惠券 赌博 都有', ad, minor)).toBe('minor');
  });

  it('分别命中各自的规则', () => {
    expect(classifyText('领取优惠券', ad, minor)).toBe('ad');
    expect(classifyText('赌博网站', ad, minor)).toBe('minor');
    expect(classifyText('今天天气不错', ad, minor)).toBeNull();
  });

  it('规则未启用时即使命中也不算', () => {
    expect(classifyText('领取优惠券', compileRule(false, '优惠券'), compileRule(false, '赌博'))).toBeNull();
  });

  it('命中空关键词列表不会误判', () => {
    expect(classifyText('任意文本', compileRule(true, ''), compileRule(true, ''))).toBeNull();
  });
});

describe('shouldDropMessage', () => {
  it('只有未成年命中才整条丢弃', () => {
    expect(shouldDropMessage('minor')).toBe(true);
    expect(shouldDropMessage('ad')).toBe(false);
    expect(shouldDropMessage(null)).toBe(false);
  });
});

describe('maskPreviewText', () => {
  it('会话列表里两套规则用不同文案遮盖', () => {
    expect(maskPreviewText('原文', 'minor')).toBe('［已被未成年保护过滤］');
    expect(maskPreviewText('原文', 'ad')).toBe('［广告消息已过滤］');
    expect(maskPreviewText('原文', null)).toBe('原文');
  });

  it('广告占位文案与消息气泡保持一致', () => {
    expect(AD_PLACEHOLDER).toBe('广告消息已过滤');
  });
});
