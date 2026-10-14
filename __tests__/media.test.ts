import {
  collectGroupedIds,
  formatBytes,
  formatDuration,
  groupedIdOf,
  parseMedia,
  pickDiscussionAnchorId,
  pickDiscussionChat,
} from '../src/tg/media';

describe('formatBytes', () => {
  it('按单位换算并保留合适精度', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(1024 * 1024 * 3)).toBe('3 MB');
    expect(formatBytes(1536)).toBe('1.5 KB');
  });

  it('非法输入返回空字符串', () => {
    expect(formatBytes(0)).toBe('');
    expect(formatBytes(undefined)).toBe('');
    expect(formatBytes(-5)).toBe('');
  });
});

describe('formatDuration', () => {
  it('不足一小时用 m:ss', () => {
    expect(formatDuration(65)).toBe('1:05');
    expect(formatDuration(9)).toBe('0:09');
  });

  it('超过一小时用 h:mm:ss', () => {
    expect(formatDuration(3725)).toBe('1:02:05');
  });

  it('非法输入返回空字符串', () => {
    expect(formatDuration(0)).toBe('');
    expect(formatDuration(undefined)).toBe('');
  });
});

describe('parseMedia', () => {
  it('无媒体返回 null', () => {
    expect(parseMedia({ id: 1, message: 'hi' })).toBeNull();
    expect(parseMedia({ id: 1, media: { className: 'MessageMediaEmpty' } })).toBeNull();
  });

  it('识别图片并取最大尺寸', () => {
    const media = parseMedia({
      media: {
        className: 'MessageMediaPhoto',
        photo: {
          className: 'Photo',
          sizes: [
            { className: 'PhotoSize', w: 90, h: 60 },
            { className: 'PhotoSize', w: 800, h: 600 },
          ],
        },
      },
    });
    expect(media?.kind).toBe('photo');
    expect(media?.width).toBe(800);
    expect(media?.height).toBe(600);
    expect(media?.downloadable).toBe(true);
  });

  it('识别视频并读出时长与尺寸', () => {
    const media = parseMedia({
      media: {
        className: 'MessageMediaDocument',
        document: {
          className: 'Document',
          mimeType: 'video/mp4',
          size: 5 * 1024 * 1024,
          attributes: [
            { className: 'DocumentAttributeVideo', w: 1280, h: 720, duration: 42 },
          ],
        },
      },
    });
    expect(media?.kind).toBe('video');
    expect(media?.duration).toBe(42);
    expect(media?.width).toBe(1280);
    expect(formatBytes(media?.size)).toBe('5 MB');
  });

  it('识别语音消息', () => {
    const media = parseMedia({
      media: {
        className: 'MessageMediaDocument',
        document: {
          className: 'Document',
          mimeType: 'audio/ogg',
          attributes: [
            { className: 'DocumentAttributeAudio', voice: true, duration: 7 },
          ],
        },
      },
    });
    expect(media?.kind).toBe('voice');
    expect(media?.duration).toBe(7);
  });

  it('识别贴纸（webp）', () => {
    const media = parseMedia({
      media: {
        className: 'MessageMediaDocument',
        document: {
          className: 'Document',
          mimeType: 'image/webp',
          attributes: [{ className: 'DocumentAttributeSticker' }],
        },
      },
    });
    expect(media?.kind).toBe('sticker');
  });

  it('普通文件用文件名做标签', () => {
    const media = parseMedia({
      media: {
        className: 'MessageMediaDocument',
        document: {
          className: 'Document',
          mimeType: 'application/pdf',
          size: 1024,
          attributes: [{ className: 'DocumentAttributeFilename', fileName: '合同.pdf' }],
        },
      },
    });
    expect(media?.kind).toBe('file');
    expect(media?.label).toBe('合同.pdf');
  });

  it('文件没有名字时退回 MIME 类型，不显示空白', () => {
    const media = parseMedia({
      media: {
        className: 'MessageMediaDocument',
        document: {
          className: 'Document',
          mimeType: 'application/zip',
          attributes: [],
        },
      },
    });
    expect(media?.label).toBe('application/zip');
  });

  it('识别投票与位置', () => {
    expect(parseMedia({ media: { className: 'MessageMediaPoll' } })?.kind).toBe('poll');
    expect(parseMedia({ media: { className: 'MessageMediaGeo' } })?.kind).toBe('geo');
  });
});

describe('groupedIdOf', () => {
  it('没有 groupedId 返回 null', () => {
    expect(groupedIdOf({ id: 1 })).toBeNull();
    expect(groupedIdOf({ id: 1, groupedId: null })).toBeNull();
  });

  it('有 groupedId 时返回字符串（bigInt 转字符串）', () => {
    expect(groupedIdOf({ groupedId: 12345678901234567890n })).toBe('12345678901234567890');
  });

  it('零值视为无分组', () => {
    expect(groupedIdOf({ groupedId: 0 })).toBeNull();
  });
});

describe('collectGroupedIds（消息组整体转发的核心）', () => {
  const album = [
    { id: '30', groupedId: '999' },
    { id: '29', groupedId: '999' },
    { id: '28', groupedId: '999' },
    { id: '20', groupedId: null },
    { id: '19', groupedId: '888' },
  ];

  it('同一相册的消息全部收集，且按 id 升序', () => {
    expect(collectGroupedIds(album, '29')).toEqual(['28', '29', '30']);
  });

  it('锚点在相册里，从任意一条进入结果都相同', () => {
    expect(collectGroupedIds(album, '28')).toEqual(['28', '29', '30']);
    expect(collectGroupedIds(album, '30')).toEqual(['28', '29', '30']);
  });

  it('不属于相册的普通消息只返回自己', () => {
    expect(collectGroupedIds(album, '20')).toEqual(['20']);
  });

  it('不会把相邻但不同相册的消息混进来', () => {
    const result = collectGroupedIds(album, '19');
    expect(result).toEqual(['19']);
  });

  it('锚点不存在时退回只转发它自己', () => {
    expect(collectGroupedIds(album, '404')).toEqual(['404']);
  });

  it('空列表不炸', () => {
    expect(collectGroupedIds([], '1')).toEqual(['1']);
  });
});

describe('pickDiscussionAnchorId', () => {
  it('取 id 最小的那条作为讨论组里的起始消息', () => {
    const messages = [
      { id: 105, peerId: { channelId: '900' } },
      { id: 101, peerId: { channelId: '900' } },
      { id: 103, peerId: { channelId: '900' } },
    ];
    expect(pickDiscussionAnchorId(messages)).toBe(101);
  });

  it('顺序无关，结果一致', () => {
    const asc = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const desc = [{ id: 3 }, { id: 2 }, { id: 1 }];
    expect(pickDiscussionAnchorId(asc)).toBe(1);
    expect(pickDiscussionAnchorId(desc)).toBe(1);
  });

  it('空数组或非法输入返回 null', () => {
    expect(pickDiscussionAnchorId([])).toBeNull();
    expect(pickDiscussionAnchorId(null as any)).toBeNull();
    expect(pickDiscussionAnchorId(undefined as any)).toBeNull();
  });

  it('忽略 id 非法的条目', () => {
    const messages = [{ id: 'abc' }, { id: null }, { id: 7 }];
    expect(pickDiscussionAnchorId(messages)).toBe(7);
  });

  it('全部 id 非法时返回 null（而不是误取 Number(null) 得到的 0）', () => {
    expect(pickDiscussionAnchorId([{ id: null }, { id: undefined }])).toBeNull();
    expect(pickDiscussionAnchorId([{ id: 0 }, { id: -3 }])).toBeNull();
  });
});

describe('pickDiscussionChat', () => {
  const chats = [
    { id: '800', title: '其他群' },
    { id: '900', title: '评论区讨论组' },
  ];

  it('按起始消息的 peerId.channelId 匹配出讨论组', () => {
    const anchor = { id: 101, peerId: { channelId: '900' } };
    expect(pickDiscussionChat(chats, anchor)).toEqual(chats[1]);
  });

  it('channelId 是数字与字符串混用时也能匹配', () => {
    const anchor = { id: 101, peerId: { channelId: 900 } };
    expect(pickDiscussionChat(chats, anchor)).toEqual(chats[1]);
  });

  it('匹配不到时返回 null', () => {
    const anchor = { id: 101, peerId: { channelId: '999' } };
    expect(pickDiscussionChat(chats, anchor)).toBeNull();
  });

  it('没有 peerId.channelId 时返回 null（私聊/普通群）', () => {
    expect(pickDiscussionChat(chats, { id: 1, peerId: {} })).toBeNull();
    expect(pickDiscussionChat(chats, { id: 1 })).toBeNull();
  });

  it('chats 为空时返回 null', () => {
    expect(pickDiscussionChat([], { id: 1, peerId: { channelId: '900' } })).toBeNull();
    expect(pickDiscussionChat(null as any, { id: 1, peerId: { channelId: '900' } })).toBeNull();
  });
});
