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
- 会话字符串持久化（重启免登录）、退出登录（含服务端注销）

暂未实现（有意留白，避免引入文件系统 / 媒体下载带来的复杂度）：

- 图片、视频、文件、语音的收发与下载
- 群组管理、频道管理、转发、回复、编辑
- 多账号、代理设置、通话

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

# ★ 先跑一遍 polyfill 自检（不需要模拟器，2 秒）
npm run verify

# 单元测试
npm test

# Android 调试运行（需已连接设备/模拟器）
npm run android

# 本地打包 release APK
cd android && ./gradlew assembleRelease
# Windows: cd android && gradlew.bat assembleRelease

# 产物
# android/app/build/outputs/apk/release/app-release.apk
```

`npm run verify` 做的事（CI 里也会跑，用来在 Gradle 之前拦住回归）：

- 校验 `src/shims/crypto.js` 的 SHA-1 / SHA-256 / PBKDF2-HMAC-SHA512 输出与 Node 原生实现**逐字节一致**
- 校验 GramJS 的 AES-CTR（MTProto 加密底座）能正常加解密
- 用 GramJS 自己的 `PromisedNetSockets` 驱动我们的 `net` shim，跑一次完整的收发与错误路径

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
├── metro.config.js              # Node 内置模块 → src/shims 的重定向表
├── scripts/gen-config.js        # 构建期写入 api_id / api_hash
├── .github/workflows/android.yml# CI：编译 + 签名 + 产出 APK
└── src/
    ├── polyfills.js             # ⭐ 运行前提：Buffer / WebCrypto / 平台判定修正
    ├── shims/                   # Node 内置模块的 RN 实现（纯 JS）
    ├── config.ts                # 常量与 DC 地址表
    ├── store.ts                 # zustand 全局状态
    ├── boot.ts                  # 启动恢复 / 登录完成 / 实时消息挂载
    ├── navigation.ts
    ├── RootNavigator.tsx
    ├── tg/telegram.ts           # ⭐ MTProto 客户端封装（登录 / 会话 / 消息）
    ├── components/              # Avatar / Button / MessageBubble
    ├── screens/                 # Login / Code / Password / ChatList / Chat / Settings
    └── utils/format.ts
```

### 6.2 GramJS 在 React Native 上的三个坑（都已在代码里解决）

这本项目最花时间的地方，记录下来避免以后踩坑：

**① 没有 Node 内置模块。**
GramJS 会 `require('net' / 'crypto' / 'fs' / 'os' / 'path' / 'store2' / 'socks' / 'websocket' …)`。
解决方式：`metro.config.js` 里用 `resolver.extraNodeModules` 把它们重定向到 `src/shims/`。
（已验证 `metro-resolver` 的 `extraNodeModules` 支持把包名映射到**文件路径**。）

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

### 6.3 网络传输

- 使用 `ConnectionTCPObfuscated`（obfuscated2）+ 裸 TCP 443，和官方客户端同款传输层，抗 DPI
- TCP 由 `react-native-tcp-socket` 提供，`src/shims/net.js` 把它的 API 适配成 Node `net.Socket`
- 首次登录先连 DC2 的真实 IP；若账号在其它 DC，服务端返回 `PHONE_MIGRATE_x`，
  代码自动 `_switchDC` 后重试
- 未启用 WebSocket 备用通道与 SOCKS 代理（`src/shims/websocket.js` / `socks.js` 为占位实现）

---

## 7. 常见问题

**Q：打开就崩 / 提示「安全随机数不可用」**
A：`react-native-get-random-values` 是原生模块，改动原生代码后必须重新构建 APK，热重载不生效。

**Q：提示 `API_ID_INVALID` 或 `API_ID_PUBLISHED_FLOOD`**
A：api_id/api_hash 用错了，或者用的是网上公开的那一份。去 my.telegram.org 重新申请一份自用。

**Q：提示 `PHONE_NUMBER_INVALID`**
A：手机号要带国家码，例如 `+8613800138000`。

**Q：CI 编译失败在 Gradle 阶段**
A：先确认 JDK 是 17；再确认 `npm ci` 用的是仓库里的 `package-lock.json`。
工作流的 `Install JS dependencies` 步骤失败通常是 lockfile 与 `package.json` 不一致，本地执行一次 `npm install` 重新提交 lockfile 即可。

**Q：安装时提示「应用未安装 / 签名冲突」**
A：CI 未配置固定签名文件时会每次生成新签名，覆盖安装需要先卸载旧版本，
或者按 4.1 配置 `ANDROID_KEYSTORE_BASE64` 使用固定签名。

---

## 8. 免责声明

- 本项目仅供个人学习与自用，请遵守 [Telegram API Terms of Service](https://core.telegram.org/api/terms)。
- 使用他人 api_id 或滥用接口导致的一切后果由使用者自负。
- 会话字符串（session）等价于账号登录凭证，只保存在本机 AsyncStorage 中；请勿分享你的 session。
