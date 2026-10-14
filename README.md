# TG Lite — 无广告的 Telegram 自用客户端

一个基于 **React Native + GramJS(MTProto)** 的 Telegram 第三方客户端，目标只有一个：**把官方 App 里的推广内容彻底去掉**。

推送代码到 GitHub 后，GitHub Actions 会自动编译出可直接安装的 `apk`。

---

## 1. 为什么它没有广告

官方客户端里的「广告」并不是本地插播的，而是 **服务端下发的推广内容**：

| 位置 | 服务端接口 |
| --- | --- |
| 会话列表顶部/中间的推广频道、机器人 | `contacts.getSponsoredPeers` / `channels.getSponsoredMessages` |
| 频道/群组消息流里穿插的赞助消息 | 同上 |
| 推荐频道、贴纸包推广、Premium 广告位 | 各类 `help.getPromoData` / `help.getAppConfig` 字段 |

这些接口**只有客户端主动请求才会返回内容**。本项目只实现收发消息所必需的最小接口集合，
从不请求也不渲染任何推广数据，所以从原理上就不存在广告位 —— 不是“拦截”或“屏蔽”，而是根本没有这条链路。

> 相关说明也内置在 App 的「设置 → 为什么没有广告」页面里。

---

## 2. 功能范围

已实现（够日常用）：

- 手机号 + 验证码 + **两步验证密码** 登录（含 `PHONE_MIGRATE_x` 自动切换 DC）
- 会话列表：置顶排序、未读数、最后一条消息预览、搜索、下拉刷新
- 聊天页：最近 50 条消息、上拉加载更早、发送文本、发送状态、已读回执
- 实时新消息推送（会话列表即时置顶 + 未读红点，聊天页即时上屏）
- **群组 / 频道管理**：查看基本信息与成员列表、改标题与简介、退出群组/频道、解散频道
- **加入群组 / 频道**：支持 `@username`、`t.me/<name>`、`t.me/+<邀请码>`、`t.me/joinchat/<码>`，加入前先预览
- **回复与引用**：长按消息回复，输入框上方显示回复条；收到的回复会渲染成引用块，点击可跳回原消息
- **媒体消息**：图片/视频/文件/语音/贴纸/网页预览的解析与渲染，图片按原始比例惰性加载
- **媒体发送**：从相册或文件里选图/选文件直接发送，可带文字说明、可回复某条消息
- **转发**：单条转发；多选批量转发；**整组（相册）转发**——选一条即把同相册的消息一起带走
- **消息操作**：长按菜单支持回复 / 转发 / 多选 / 删除（自己发的可撤回）
- **评论区**：频道帖子可查看评论列表并直接发评论
- **切换 API 凭据**：设置页可查看 / 修改 `api_id` 与 `api_hash`，改完引导重新登录
- **广告过滤**：本地关键词过滤，命中消息折叠为「广告消息已过滤」，点击可展开/收起，默认隐藏
- **未成年保护**：本地关键词过滤，命中消息彻底不显示（连折叠提示都不留）
- **SOCKS5 / SOCKS4 / HTTP 代理**：自研纯 JS 隧道，支持用户名密码 / Basic 认证，带连通性自检
- **WebSocket 备用通道**：TCP 被封锁时可切到 MTProto over `wss://<dc>:443/apiws`
- 会话字符串持久化（重启免登录）、退出登录（含服务端注销）

暂未实现（有意留白）：

- 视频/大文件的落盘下载与「保存到相册」（目前图片在内存里按需加载）
- 消息编辑、表情回应、投票
- 多账号、通话、MTProto 专用代理（MTProxy）

---

## 3. 前置条件

| 依赖 | 版本 |
| --- | --- |
| Node.js | >= 18（CI 用 22） |
| JDK | 17 |
| Android SDK | platform 34 / build-tools 34.0.0（CI 自动安装） |
| React Native | 0.75.5（旧架构，`newArchEnabled=false`） |

### 申请自己的 api_id / api_hash

1. 打开 <https://my.telegram.org/apps> 用你的手机号登录
2. 填一个 App title / short name，提交
3. 拿到 `api_id`（数字）和 `api_hash`（32 位十六进制）

> ⚠️ 不要用网上流传的公共 api_id/api_hash，很容易触发 `API_ID_PUBLISHED_FLOOD` 甚至封号。

凭据有两种用法，任选其一：

- **编译期注入**：配置下面的 GitHub Secrets，APK 装好即可直接登录
- **运行期填写**：什么都不配也行，登录页展开「使用自己的 api_id / api_hash」手填

---

## 4. 用 GitHub Actions 编译 APK

### 4.1 配置 Secrets（全部可选）

仓库 `Settings → Secrets and variables → Actions → New repository secret`：

| Secret | 必填 | 说明 |
| --- | --- | --- |
| `TG_API_ID` | 否 | 编译期内置 api_id |
| `TG_API_HASH` | 否 | 编译期内置 api_hash |
| `ANDROID_KEYSTORE_BASE64` | 否 | 正式签名文件（base64） |
| `ANDROID_KEYSTORE_PASSWORD` | 否 | 上面签名文件的密码 |
| `ANDROID_KEY_ALIAS` | 否 | 签名别名，默认 `tglite` |

**都不配也能跑通**：工作流会自动生成一个临时签名文件，产出可正常安装的 APK。

> 想用固定签名（覆盖安装不丢数据），本地生成后转 base64：
> ```bash
> keytool -genkeypair -v -keystore release.keystore -alias tglite \
>   -keyalg RSA -keysize 2048 -validity 10950 \
>   -storepass 你的密码 -keypass 你的密码 \
>   -dname "CN=TG Lite, O=Self Use, C=CN"
> # macOS / Linux
> base64 -i release.keystore | pbcopy      # macOS
> base64 -w0 release.keystore              # Linux
> # Windows PowerShell
> [Convert]::ToBase64String([IO.File]::ReadAllBytes("release.keystore")) | Set-Clipboard
> ```

### 4.2 触发构建

- 推送到 `main` / `master` → 构建并在 Artifacts 里产出 APK
- 打 tag（如 `git tag v1.0.0 && git push origin v1.0.0`）→ 额外创建 Release 并附上 APK
- 也可以在 Actions 页面手动 `Run workflow`

产物路径：Actions run 页面底部 **Artifacts → `tglite-apk-<sha>`**。

---

## 5. 本地开发与构建

```bash
npm install

# ★ 先跑一遍自检（不需要模拟器，几秒）
npm run verify          # = verify:shims + verify:transport
npm run typecheck       # tsc --noEmit
npm test                # jest 单元测试

# Android 调试运行（需已连接设备/模拟器）
npm run android

# 本地打包 release APK
cd android && ./gradlew assembleRelease
# Windows: cd android && gradlew.bat assembleRelease

# 产物
# android/app/build/outputs/apk/release/app-release.apk
```

`npm run verify` 做的事（CI 里也会跑，用来在 Gradle 之前拦住回归）：

- **`verify:shims`** — 校验 `src/shims/crypto.js` 的 SHA-1 / SHA-256 / PBKDF2-HMAC-SHA512 输出与 Node 原生实现**逐字节一致**；校验 GramJS 的 AES-CTR（MTProto 加密底座）能正常加解密；用 GramJS 自己的 `PromisedNetSockets` 驱动我们的 `net` shim，跑一次完整的收发与错误路径。
- **`verify:transport`** — 当场起真实的 SOCKS5（含认证）/ SOCKS4a / HTTP CONNECT 代理服务器，把数据真的穿过去：
  - 逐个校验协议字节（SOCKS5 的 ATYP=1/3、SOCKS4a 的占位 IP 与域名位置）
  - 验证每条隧道「握手 → 收发 → 拿到预期回应」
  - 验证 `GramJS PromisedNetSockets → net shim → 代理 → 目标` 的**全链路**，并断言代理端确实收到了 CONNECT **请求数**（否则说明是偷偷直连，属于假绿灯）
  - 验证认证失败、目标端口无服务、代理只连不答（超时）等错误路径给出的是可读中文

可选：用环境变量注入凭据后再构建

```bash
TG_API_ID=1234567 TG_API_HASH=yourhash node scripts/gen-config.js
```

---

## 6. 架构与关键实现

### 6.1 目录结构

```
TGLite/
├── index.js                     # 入口：第一行必须 require('./src/polyfills')
├── App.tsx
├── metro.config.js              # Node 内置模块 → src/shims 的强拦截表
├── scripts/
│   ├── gen-config.js            # 构建期写入 api_id / api_hash
│   ├── verify-shims.js          # 自检：哈希 / AES / TCP 适配层
│   └── verify-transport.js      # 自检：真实代理服务器的端到端隧道验证
├── .github/workflows/android.yml# CI：typecheck + verify + jest + 编译 + 签名 + 产出 APK
└── src/
    ├── polyfills.js             # ⭐ 运行前提：Buffer / WebCrypto / 平台判定修正
    ├── shims/                   # Node 内置模块的 RN 实现（纯 JS）
    │   ├── crypto.js            #   哈希 / HMAC / PBKDF2 / 安全随机数
    │   ├── net.js               #   Node net.Socket 适配 + 代理拨号
    │   ├── tunnel.js            #   ⭐ SOCKS5 / SOCKS4 / HTTP CONNECT 握手
    │   ├── socks.js             #   socks 包接口（复用 tunnel）
    │   ├── transport-state.js   #   代理配置的共享可变状态
    │   ├── proxy-probe.js       #   代理连通性探测
    │   ├── websocket.js         #   WebSocket 通道适配
    │   └── (events / util / os / fs / store2 …)
    ├── config.ts                # 常量与 DC 地址表
    ├── settings.ts              # ⭐ 设置持久化（过滤规则 / 通道 / 代理）
    ├── filters.ts               # ⭐ 关键词过滤纯逻辑（广告 / 未成年）
    ├── net/transport.ts         # ⭐ 传输层门面：把设置变成 GramJS 参数
    ├── store.ts                 # zustand 全局状态
    ├── boot.ts                  # 启动恢复 / 登录完成 / 实时消息挂载
    ├── navigation.ts
    ├── RootNavigator.tsx
    ├── tg/
    │   ├── telegram.ts          # ⭐ MTProto 客户端封装（登录 / 会话 / 消息 / 转发 / 评论）
    │   ├── media.ts             # ⭐ 媒体解析 + 相册 id + 讨论组定位（纯函数，可单测）
    │   ├── media-transfer.ts    # ⭐ 媒体上传 / 下载（RN 下走 buffer，不用 path）
    │   ├── pickers.ts           # ⭐ 相册 / 文件选择器封装
    │   ├── groups.ts            # ⭐ 群组与频道管理（加入 / 退出 / 成员 / 改名）
    │   ├── links.ts             # ⭐ 加入目标解析（@用户名 / 邀请链接）
    │   └── bus.ts               # 新消息事件总线
    ├── components/              # Avatar / Button / MessageBubble / MediaBlock /
    │                            # Switch / TextField
    ├── screens/                 # Login / Code / Password / ChatList / Chat /
    │                            # ChatInfo / Join / Settings / Filters / Network /
    │                            # Forward / Comments / ApiCredentials
    └── utils/format.ts
```

### 6.2 GramJS 在 React Native 上的三个坑（都已在代码里解决）

这本项目最花时间的地方，记录下来避免以后踩坑：

**① 没有 Node 内置模块。**
GramJS 会 `require('net' / 'crypto' / 'fs' / 'os' / 'path' / 'store2' / 'socks' / 'websocket' …)`。
解决方式：`metro.config.js` 里用 `resolver.resolveRequest` 把它们**强拦截**到 `src/shims/`。
（不能只配 `extraNodeModules`：metro-resolver 会把它拼在真 `node_modules` 之后，
于是 `telegram` 的传递依赖里真实存在的 `socks` / `websocket` / `store2` / `node-localstorage`
会盖掉我们的实现，还会把 `graceful-fs` 整套 Node 生态拖进依赖图，打包直接报 `Unable to resolve module assert`。）

**② 没有 WebCrypto。**
GramJS 内部 `crypto/crypto.js` 是纯 JS 实现，但它依赖 `crypto.getRandomValues` 与
`crypto.subtle.{digest, importKey, deriveBits}`（SHA-1/SHA-256/PBKDF2-HMAC-SHA512）。
解决方式：`react-native-get-random-values` 提供原生安全随机数，
`src/shims/crypto.js` 用 `@noble/hashes` 补齐哈希与 PBKDF2 —— **完全不引入原生加密库**，
APK 构建不会因为 `nitro-modules` / `quick-crypto` 之类的依赖翻车。

**③ React Native 里存在全局 `window`，GramJS 会把自己误判成浏览器。**
后果是 `Client.getDC()` 返回 `*.web.telegram.org` 这类 WebSocket 网关域名（而不是各 DC 的真实 IP），
并让媒体传输走错地址。
解决方式：`src/polyfills.js` 里在 `telegram` 被 `require` 之前把
`telegram/platform` 的 `isNode` 置为 `true`、`isBrowser` 置为 `false`。
**因此 polyfills 必须是整个 App 的第一个 import。**

### 6.3 网络传输与代理

**传输通道**（设置 → 网络与代理）可以在两者间切换，改完自动重连：

| 通道 | 实现 | 何时用 |
| --- | --- | --- |
| `TCP`（默认） | `ConnectionTCPObfuscated`（obfuscated2）+ 裸 TCP 443，与官方客户端同款，抗 DPI | 一般情况下 |
| `WebSocket` | `PromisedWebSockets` + `wss://<dc-ip>:443/apiws`，TLS 由系统网络栈（OkHttp）完成 | TCP 被封锁时 |

- TCP 由 `react-native-tcp-socket` 提供，`src/shims/net.js` 把它的 API 适配成 Node `net.Socket`
- 首次登录先连 DC2 的真实 IP；若账号在其它 DC，服务端返回 `PHONE_MIGRATE_x`，代码自动 `_switchDC` 后重试
- 通道切换走的是 GramJS 的 `clientParams.networkSocket` + `useWSS`，不是另写一套协议

**代理**支持 SOCKS5 / SOCKS4(4a) / HTTP CONNECT，可带用户名密码或 Basic 认证：

- 隧道在 `src/shims/tunnel.js` 里手写实现，socket 无关（只依赖 `on/write/destroy`），
  所以同一份代码在 App 里跑在 `react-native-tcp-socket` 上，在 CI 里跑在 Node `net.Socket` 上
- 生效点在 `src/shims/net.js` 的拨号阶段：**`'connect'` 事件推迟到隧道握手完成之后再 emit**。
  这一点是必须的 —— GramJS 一收到 `connect` 就会写出 MTProto 握手的第一个包，
  早一毫秒就会把二进制数据写进代理的 CONNECT 请求里
- 握手期间底层数据交给 tunnel 的读取器消费（`net.js` 用 `_handshaking` 标志吞掉自己那份转发），
  握手响应之后若还有残留字节，会补发成 socket 的第一段 `data`
- ⚠️ **WebSocket 通道不支持自建代理**：那条路走的是 OkHttp，插不进我们的隧道。
  设置页对这个组合有显式拦截（保存时提示二选一），`createClient` 里也会把代理置空并给出警告

### 6.4 内容过滤（广告 / 未成年保护）

两套规则共用一个匹配器（`src/filters.ts`，纯函数），但语义不同：

| | 广告设置 | 未成年设置 |
| --- | --- | --- |
| 命中后 | 折叠成「广告消息已过滤」，**点击可展开/收起**，默认隐藏 | **整条不渲染**，连折叠提示都不留 |
| 会话列表预览 | 显示「［广告消息已过滤］」 | 显示「［已被未成年保护过滤］」 |
| 优先级 | 低 | 高（同时命中时按未成年处理） |

- 关键词用换行 / 中英文逗号 / 分号 / 竖线分隔，自动去重、忽略大小写、子串匹配
- 开关打开但关键词为空时**不会生效**（避免「开了但没填词」被误判成过滤中）
- 过滤发生在**渲染层**而不是拉取层：改完关键词回到聊天页，历史消息立刻按新规则重新判定，无需重新拉取
- 只在本地生效，不删服务端消息，不上报任何内容

> ⚠️ 未成年保护是**关键词黑名单**，不是内容识别模型：它只能拦住你列出来的词，
> 识别不了同义改写、拼音谐音，也看不到图片/视频里的内容。请把它当作辅助手段，
> 不要当成完整的家长控制方案。

### 6.5 群组与频道管理

Telegram 的历史包袱在这里绕不开，`src/tg/groups.ts` 对每个写操作都做了分流：

| 操作 | 频道 / 超级群（`Api.Channel`） | 基础群（`Api.Chat`） |
| --- | --- | --- |
| 退出 | `channels.LeaveChannel` | `messages.DeleteChatUser(me)` |
| 解散 | `channels.DeleteChannel`（仅创建者） | 不支持（服务端本身没有这个接口） |
| 改标题 | `channels.EditTitle` | `messages.EditChatTitle` |
| 改简介 | `messages.EditChatAbout` | `messages.EditChatAbout` |
| 成员列表 | `channels.GetParticipants` | `messages.GetFullChat` |
| 我的权限 | `channels.GetParticipant('me')` 的 `adminRights` | `entity.adminRights` / `entity.creator` |

- 判断错了会直接拿到 `PEER_ID_INVALID`，所以走 `utils.getInputChannel()` 显式转换
- 所有服务端错误码都在 `friendly()` 里翻成中文（`CHANNEL_PRIVATE` / `INVITE_HASH_EXPIRED` / `CHAT_ADMIN_REQUIRED` …）
- 「加入」的入口有两条：`@username` 走 `contacts.ResolveUsername` + `channels.JoinChannel`；
  邀请链接走 `messages.CheckChatInvite`（先预览，能提前知道是否需要管理员审批）+ `messages.ImportChatInvite`

### 6.6 媒体、转发与评论区的几个暗坑

**① RN 里没有文件路径，上传只能走 buffer。**
GramJS 的 `CustomFile(name, size, path, buffer)` 支持两种模式，RN 拿不到稳定 `path`，
所以 `media-transfer.ts` 统一走：`fetch(uri)` → `arrayBuffer()` → `Buffer.from(...)` → `CustomFile`。
选择器那边用 `copyTo: 'cachesDirectory'`，因为 `content://` 这类 uri 不一定能被 `fetch` 读到。

**② 相册（消息组）转发要凑齐同一个 `groupedId`。**
Telegram 把一条消息组里每条消息都带上同一个 `groupedId`（bigInt）。
「整组转发」的做法是把同 `groupedId` 的 id 全部收集起来一次性传给 `messages.forwardMessages`
——只有一批 id 一起发过去，服务端才会还原成相册。
这段核心逻辑放在 `media.ts` 的 `collectGroupedIds()`（纯函数），有单测覆盖。

**③ 频道帖子的评论，id 是两套。**
这是最容易写错的一处：频道帖子（channel post）存在于**频道**里，
而它的评论线程存在于**关联讨论组**（一个 megagroup）里，两者消息 id 完全不同。

- `messages.GetDiscussionMessage({ peer: <频道>, msgId: <帖子 id> })` —— 这里的 `peer` 是**频道**，正确
- 它返回的 `messages` 里 id 最小的那条，就是帖子在讨论组中的「起始消息」
- 之后 `messages.GetReplies` 和 `sendMessage` 的 `commentTo`，要用的都是**这个** id 和**讨论组**的 peer

一开始我直接把频道帖子 id 当作讨论组 id 用，是错的（会拿不到评论、评论也发不进去）。
现在的实现放在 `telegram.ts` 的 `resolveDiscussion()`，
与 GramJS 内部 `client/messages.js` 的 `getCommentData` 保持一致，
拆出来的 `pickDiscussionAnchorId()` / `pickDiscussionChat()` 是纯函数，同样有单测。

> 💡 一个顺手发现的坑：`Number(null) === 0` 且 `Number.isFinite(0)` 为真。
> 如果只判 `isFinite`，一条 `{ id: null }` 就会让最小值变成 `0`，
> 于是 `msgId` 变成 0、请求必然失败。所以判定必须同时要求正整数。
> 这个是写测试时才发现的。

**④ 媒体权限只在旧系统上申请。**
`react-native-image-picker` / `react-native-document-picker` 自身都不声明存储权限，
需要我们在 `AndroidManifest.xml` 里补。Android 13（API 33）起系统用照片选择器和
SAF 文档选择器，**选文件不需要任何权限**，所以权限都加了 `maxSdkVersion` 限制：

| 权限 | maxSdkVersion | 原因 |
| --- | --- | --- |
| `READ_EXTERNAL_STORAGE` | 32 | Android ≤12 读相册媒体才需要 |
| `WRITE_EXTERNAL_STORAGE` | 28 | Android ≤9 额外需要 |

运行时申请放在 `pickers.ts` 的 `ensureMediaPermission()`：
API ≥33 直接返回 true，不弹窗；旧系统才真的去 request。

---

## 7. 常见问题

**Q：打开就崩 / 提示「安全随机数不可用」**
A：`react-native-get-random-values` 是原生模块，改动原生代码后必须重新构建 APK，热重载不生效。

**Q：提示 `API_ID_INVALID` 或 `API_ID_PUBLISHED_FLOOD`**
A：api_id/api_hash 用错了，或者用的是网上公开的那一份。去 my.telegram.org 重新申请一份自用。

**Q：装好的 APK 里可以直接换 api_id / api_hash 吗？**
A：可以。设置页 → 「接入信息」→「切换 API 凭据」可以查看和修改。
也可以一开始就不编译进 APK（不配 Secrets 即可），装好后在 App 内填。
注意：凭据代表「应用身份」，换掉之后旧会话在服务端就不再匹配，
所以保存后会引导重新用手机号登录一次。

**Q：提示 `PHONE_NUMBER_INVALID`**
A：手机号要带国家码，例如 `+8613800138000`。

**Q：CI 编译失败在 Gradle 阶段**
A：先确认 JDK 是 17；再确认 `npm ci` 用的是仓库里的 `package-lock.json`。
工作流的 `Install JS dependencies` 步骤失败通常是 lockfile 与 `package.json` 不一致，本地执行一次 `npm install` 重新提交 lockfile 即可。

**Q：安装时提示「应用未安装 / 签名冲突」**
A：CI 未配置固定签名文件时会每次生成新签名，覆盖安装需要先卸载旧版本，
或者按 4.1 配置 `ANDROID_KEYSTORE_BASE64` 使用固定签名。

**Q：开了代理但还是连不上 / 设置页显示「代理未生效」**
A：先确认通道选的是 TCP —— WebSocket 通道走系统网络栈，用不了自建代理。
再点一次「测试连通性」，它会真的把隧道建到 Telegram DC2，报错信息会直接说是
握手超时、认证失败、还是代理规则拒绝了目标地址。

**Q：切到 WebSocket 通道后连不上**
A：WebSocket 通道连的是 `wss://<dc-ip>:443/apiws`。部分网络会拦掉 443 上的 WebSocket 升级，
这种情况切回 TCP 更稳。另外这条通道的 TLS 由系统网络栈校验，如果所在环境信任链异常，
换 TCP 即可绕过。

**Q：过滤了关键词，但历史消息还是能看到**
A：过滤在渲染层做，改完关键词需要点「保存」（或直接返回聊天页）才会按新规则重新判定。
未成年保护命中时消息会整条消失，连「被过滤」的提示都不会留。

---

## 8. 免责声明

- 本项目仅供个人学习与自用，请遵守 [Telegram API Terms of Service](https://core.telegram.org/api/terms)。
- 使用他人 api_id 或滥用接口导致的一切后果由使用者自负。
- 会话字符串（session）等价于账号登录凭证，只保存在本机 AsyncStorage 中；请勿分享你的 session。
