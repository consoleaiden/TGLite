# tdeeeg 移植为 Android App —— 可行性评估

> 评估对象：`https://github.com/CatMoeCircle/tdeeeg`
> 目标：移植为 Android 手机 App
> 结论先行：**技术上可行，但不是「移植」，是「重做外壳 + 重写原生层」。**
> 其中约 40% 的代码（前端 UI）可复用，约 60%（Rust 桌面层）必须重写。

---

## 一、先看清 tdeeeg 是什么

| 层 | 技术 | 代码量 |
| --- | --- | --- |
| 桌面外壳 | **Tauri 2 (Rust)** | Rust 8372 行 |
| UI | Vue 3 + TS + Vite + Tailwind 4 + TDesign | 20863 行（173 个 .vue + 148 个 .ts） |
| 状态 | Pinia | 40 个 store 文件 |
| 协议 | **TDLib via Rust FFI**（动态加载） | `tdlib.rs` 单文件 2831 行 |

**关键事实：它是一个 Windows 桌面应用。** 22 处 `cfg(windows)` / `cfg(target_os)`，
以及这些只在 Windows 存在的东西：

- `smtc.rs`（371 行）—— Windows 系统媒体控件（SMTC）/ 锁屏播放卡片，用 `windows` crate + WinRT
- `toast_identity.rs`（208 行）—— Windows 进程 AUMID + 注册表名，让通知显示正确应用名
- `update_manager.rs`（205 行）—— 但它其实是 TDLib 的 update 分类器（这个名字有歧义，跟自动更新无关）
- `Cargo.toml` 里 `[target.'cfg(windows)'.dependencies]`：`winreg`、`windows` crate、`tauri-winrt-notification`、`tauri-plugin-updater`、`tauri-plugin-single-instance`
- `tauri.conf.json` bundle targets 是 `["nsis"]`（Windows 安装包）

它的 CI 也只在 `windows-latest` 上跑。

---

## 二、四个方案，先排除两个

| 方案 | 可行性 |
| --- | --- |
| A. 直接用 Tauri 2 的 Android 目标编译 | ⚠️ 理论可行，实际撞墙（见下） |
| B. 保留 Vue 前端，只重写 Rust 原生层为 Android | ✅ **推荐路线** |
| C. 放弃 Tauri，把 UI 重写成 Android 原生 / Compose | ❌ 等于重做，20k 行 UI 全废 |
| D. 直接用现成的 Android Telegram 客户端二次开发 | ⚠️ 完全不同的路（见文末） |

### 为什么 A 不行：Tauri 2 移动端支持是真的，但这个项目用不了

Tauri 2.0 确实在 2024-10 加入了 iOS/Android 支持，官方说法是
"you can develop production ready mobile applications with Tauri NOW"。
但官方同时明确列出**桌面特性在移动端不可用**，而 tdeeeg 恰好把这些都用上了：

| Tauri 桌面特性 | tdeeeg 是否使用 | 移动端 |
| --- | --- | --- |
| 无边框窗口 / `decorations: false` | ✅ `tauri.conf.json` | ❌ 不支持 |
| 透明窗口 / `transparent: true` | ✅ | ❌ 不支持 |
| 多窗口 | ✅ `WebviewWindow` 用在 4 个文件里 | ❌ 不支持 |
| 系统托盘 `tray-icon` | ✅ `Cargo.toml` features | ❌ 不支持 |
| 自动更新器 | ✅ `tauri-plugin-updater` | ❌ 移动端走应用商店 |
| 任意文件系统访问 | ✅ `fs:scope allow "**"` | ❌ 移动端沙箱，只能访问自己容器和用户选的文件 |
| 单实例 `single-instance` | ✅ | ❌ 不支持 |
| 自定义标题栏（`TitleBar.vue`） | ✅ | ❌ 无意义 |
| 窗口拖拽 / 最小化 / 最大化 API | ✅ capabilities 里 13 个窗口权限 | ❌ 不支持 |

`capabilities/default.json` 里那一整串 `core:window:allow-*` 在 Android 上**全都不存在**。

**结论**：这不是"改个配置就能编译"的问题。前端 152 处 `invoke()` 调用、
大量 `@tauri-apps/plugin-fs` / `plugin-dialog` / `plugin-opener` 的用法，
在移动端语义完全不同（移动端不用"打开文件对话框"，用系统文件选择器和分享 Intent）。

---

## 三、逐层评估工作量

### 3.1 前端（20863 行 / 173 个 .vue）—— 可复用约 60-70%

**能直接留的：**
- 消息气泡渲染、富文本（`MessageRichMessage`、`RichText`）
- 贴纸/Lottie 动画（`tlottie` 是纯 web 的）
- 会话列表、消息列表的布局逻辑
- Pinia store 的**数据结构与业务逻辑**（40 个文件）
- i18n（5 个 locale 文件）
- 大部分 Tailwind 样式

**必须改的：**

| 问题 | 涉及范围 | 说明 |
| --- | --- | --- |
| 152 处 `invoke()` | 全局 | 命令名不变可以保留，但底层实现要换 |
| `plugin-fs` 用法 | 约 10+ 文件 | 移动端要改成 SAF（Storage Access Framework） |
| `plugin-dialog`（打开/保存文件） | 约 6 文件 | 移动端改成系统文件选择器 + 分享 Intent |
| `plugin-opener`（用系统程序打开文件） | 约 8 文件 | 改成 Android `Intent.ACTION_VIEW` |
| `WebviewWindow` / `getCurrentWindow` | 4 文件 | 移动端单窗口，逻辑要删 |
| 桌面布局 | 全局 | 现在是 1000×500 的桌面窗口布局（侧边栏+主区），手机要改成单页导航 + 手势 |
| 鼠标交互 | 全局 | hover、右键菜单、拖拽（`vue-draggable-plus`）在触屏上要重做 |
| 快捷键 / 缩放 | `zoomHotkeysEnabled: false` | 移动端无键盘快捷键 |

**注意：布局是最大的一块隐性工作。** 从 1000×500 桌面双栏改成手机单栏 + 底部/侧边抽屉，
几乎每个页面都要过一遍。

### 3.2 Rust 原生层（8372 行）—— 必须重写约 70%

| 文件 | 行数 | 移植难度 | 说明 |
| --- | --- | --- | --- |
| `tdlib.rs` | 2831 | 🟡 中 | FFI 加载逻辑要改（见下），但**业务逻辑可保留** |
| `download_store.rs` | 1680 | 🟡 中 | 逻辑可留，但"保存到哪"要改成 SAF/媒体库 |
| `chat_store.rs` | 521 | 🟢 低 | 纯 Rust 逻辑，几乎可直接用 |
| `accounts.rs` | 230 | 🟡 中 | 依赖 `tauri-plugin-keyring-store`，Android 上要换 Keystore |
| `notifications.rs` | 538 | 🔴 高 | 依赖 `notify-rust` + `tauri-winrt-notification`，要换成 Android Notification |
| `smtc.rs` | 371 | 🔴 重写 | Windows SMTC，Android 对应的是 MediaSession + 通知栏播放器 |
| `toast_identity.rs` | 208 | 🔴 删除 | Windows AUMID / 注册表，Android 无对应物 |
| `update_manager.rs` | 205 | 🟢 低 | 其实是 TDLib update 分类器，逻辑可留 |
| `ai_translate.rs` | 319 | 🟢 低 | `llmsdk` 调 OpenAI/Anthropic，`reqwest` 跨平台 |
| `lang_detect.rs` + `langdetect/` | 291 | 🟡 中 | 依赖 **TFLite C 运行时**，要换 Android 版 `.so` |
| `media_stream.rs` | 191 | 🟡 中 | 自定义 `tdstream:` 协议，Tauri 移动端 asset protocol 行为不同 |
| `file_gate.rs` | 304 | 🟢 低 | 纯逻辑 |
| `lib.rs` | 388 | 🟡 中 | Tauri 插件注册，要删掉桌面专属的 |
| `device_info.rs` | 152 | 🟡 中 | 设备信息采集，要改成 Android Build 属性 |
| `data_loc.rs` | 111 | 🟢 低 | 路径处理 |
| `main.rs` | 32 | 🟡 中 | WebView2 启动参数是 Windows 专属 |

**相对乐观的一点**：Rust 侧的**业务逻辑**（TDLib 调用、数据分类、下载管理）本质是跨平台的。
真正要重写的是"外壳"——窗口、通知、媒体控制、文件路径。

### 3.3 TDLib FFI 加载（决定性技术点）

tdeeeg 用的是 **`libloading` 运行时动态加载** `tdjson.{dll,dylib,so}`：

```rust
lib.get(b"td_json_client_create")
lib.get(b"td_json_client_send")
lib.get(b"td_json_client_receive")
lib.get(b"td_json_client_execute")
lib.get(b"td_json_client_destroy")
```

**好消息**：这套 `td_json_client_*` C 接口是 TDLib 的通用接口，**Android 上完全一样**。
只需要把库名从 `tdjson.dll` 改成 `libtdjson.so`（代码里第 960 行已经处理了 `so` 分支）。

**但有个前提问题**：Tauri 的 Android 构建把 Rust 编成 `.so` 由 Kotlin 加载。
在里面再用 `libloading` 去 `dlopen` 另一个 `.so`，需要：
- 确保 `libtdjson.so` 被正确打进 APK 的 `jniLibs/`
- 处理 Android 的 `dlopen` 限制（API 24+ 对非公开 NDK 库的限制，不过 `libtdjson.so` 是自带依赖的不受影响）
- 处理 `android:extractNativeLibs` 配置

**这条能走通，但是最需要先做原型验证的地方。**

**TDLib 本身对 Android 是官方支持的**，甚至有社区预编译好的产物
（如 `up9cloud/android-libtdjson`，提供 armeabi-v7a / arm64-v8a / x86 / x86_64）。
官方也提供 `-DTD_ENABLE_JNI=ON` 的 Java 绑定。

---

## 四、工作量估算

按"一个熟悉 Rust + Vue + Android 的开发者"计：

| 阶段 | 内容 | 相对工作量 |
| --- | --- | --- |
| 0. 原型验证 | TDLib `.so` 在 Tauri Android 里跑通（login + 收一条消息） | 小，但**决定成败** |
| 1. 构建体系 | Android 打包、TDLib 交叉编译/集成、CI | 中 |
| 2. Rust 桌面层替换 | 通知 / 媒体会话 / 文件路径 / 密钥存储 / 删除 Windows 模块 | **大** |
| 3. 前端适配 | 152 处 invoke 的移动端语义、布局改单页、触屏交互 | **大** |
| 4. 平台能力 | 分享 Intent、相机、相册、通知权限、后台保活 | 中 |
| 5. 打磨 | 性能、内存、电量、机型适配 | 中 |

**大致量级**：这是一次**数月级的工程**（不是几周），且中途会遇到 Tauri 移动端的
"年轻生态"问题——官方自己都说 "mobile is stable but young… you might hit edge cases
that don't have answers yet"。

---

## 五、⚠️ 一个必须先想清楚的问题：这个项目的目标是手机吗？

tdeeeg 的整个设计假设是**桌面**：

- 1000×500 双栏布局（会话列表 + 聊天区并排）
- 右键菜单、hover 态、拖拽
- 系统托盘、多窗口、桌面通知
- 桌面文件系统访问（打开任意路径的文件）

**手机端的交互范式完全不同**：单页导航、手势、底部 Tab、分享 Intent、媒体库。
把桌面 UI 硬塞进手机，产物会是"一个能在手机上跑的桌面应用"——能用但别扭。

**这引出一个更根本的问题**：如果目标是手机 App，为什么不用手机优先的架构？

---

## 六、替代方案：可能比"移植"更划算

### 方案 D1：GramJS + React Native（你已有的 TGLite）

你已经有一个在跑的 RN 项目。它天然是移动优先的，且已经解决了：
- RN 下让 GramJS 跑起来的 shim 层
- SOCKS5/SOCKS4a/HTTP 自研隧道
- MTProxy fake-TLS（`ee`）自研传输
- 178 个测试 + 三套 verify 门

**TDLib 能给的（本地数据库、增量同步、下载管理、多代理列表）**，
在 RN 里加 SQLite + 自己写下载队列的代价，**低于**把 tdeeeg 搬过来。

### 方案 D2：Tauri 2 Android（本文评估的路线）

适合的场景：**你就是要 TDLib 的能力，且愿意接受数月工程量**。
那么建议**不要"移植 tdeeeg"**，而是**用 tdeeeg 当参考**，从
`tauri android init` 起一个干净的移动优先项目，把 tdeeeg 的：
- TDLib FFI 封装（`tdlib.rs` 的接口层）
- TDLib update 分类器（`update_manager.rs`）
- 消息/富文本渲染组件（`MessageRichMessage` 等）
- Pinia store 的数据结构

**作为参考搬过去**，而不是整仓 fork 然后修。

### 方案 D3：直接用现成的 Android 客户端

如 Nagram / Momogram（你之前研究过，是官方 Android 客户端的 fork）。
它们**本来就是 Android**，功能比 tdeeeg 全得多。如果你的目标是"一个功能齐全的
无广告 Android Telegram 客户端"，**基于它们二次开发比自己移植快得多**——
只是它们的语言是 Java/Kotlin，不是 Vue/Rust。

---

## 七、最终建议

| 你的真实目标 | 建议 |
| --- | --- |
| 想在手机上用 tdeeeg 的功能 | 方案 D3（Nagram/Momogram）最快 |
| 想要手机 App 且继续用 RN 技术栈 | 方案 D1（继续投 TGLite），别碰 TDLib |
| 必须用 TDLib，且接受数月工程量 | 方案 D2，**新起项目 + 参考 tdeeeg**，不要整仓移植 |
| 只是好奇技术上能不能 | 能，但"移植"这个词低估了工作量——这是重做 |

**如果决定走 D2，第一步只做一件事**：
在 `cargo tauri android init` 出来的空项目里，把 `libtdjson.so` 集成进去，
用 `libloading` 调 `td_json_client_create` 跑通 login。
**这一步不通，整个方案不成立**；这一步通了，后面的都是体力活。

---

## 附：本次评估的依据

- 克隆 tdeeeg 实测：Rust 8372 行 / 17 个 `.rs`；前端 20863 行 / 173 `.vue` + 148 `.ts`；总计 59MB
- `src-tauri/Cargo.toml`：`[target.'cfg(windows)'.dependencies]` 含 `winreg` / `windows` / `tauri-winrt-notification`
- `src-tauri/src/`：`smtc.rs`（Windows SMTC）、`toast_identity.rs`（Windows AUMID）、`device_info.rs`
- `src-tauri/tauri.conf.json`：`decorations:false`、`transparent:true`、`bundle.targets:["nsis"]`、`resources:["./bin/*"]`
- `src-tauri/capabilities/default.json`：13 个 `core:window:allow-*` 权限
- `src-tauri/build.rs`：TFLite 运行时按平台选 `tensorflowlite_c.{dll,dylib,so}`
- `src-tauri/langdetect/Cargo.toml`：`edgefirst-tflite`（MediaPipe LangID 模型）
- 前端：152 处 `invoke()`；`@tauri-apps/plugin-{fs,dialog,opener,notification,updater,window-state}`
- `.github/workflows/release.yml`：`runs-on: windows-latest`
- `AGENTS.md`：官方自述 "Windows is the primary verified platform; macOS/Linux may lack build support"
- Tauri 2 移动端限制：官方文档 + 社区实践（tray/window/updater/shell 在移动端不可用）
- TDLib：官方支持 Android，提供 `-DTD_ENABLE_JNI=ON`；社区有预编译 `libtdjson.so`
