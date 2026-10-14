# TDLib vs GramJS —— 协议选型分析

> 针对 TGLite（React Native + Telegram 第三方客户端）
> 结论先行：**协议能力上 TDLib 更齐全，但对这个项目而言，现在不该换。**

---

## 一、先纠正一个前提：tdeeeg 的「三种代理」TDLib 和 GramJS 都有

你的问题是「TDLib 包含了完整的 Telegram 官方三种代理模式」。这个说法**基本准确，但 GramJS 其实也有三种模式**——两者在"代理类型枚举"这一层是打平的。真正的差距在别处。

两边的代理类型对照：

| 代理类型 | TDLib | GramJS | 本项目 |
| --- | --- | --- | --- |
| SOCKS5 | `proxyTypeSocks5` | 通过 `socks` shim | ✅ 自研隧道 |
| HTTP (CONNECT) | `proxyTypeHttp` | —— | ✅ 自研隧道 |
| MTProto（明文 16 字节） | `proxyTypeMtproto` | `ConnectionTCPMTProxyAbridged` | ✅ |
| MTProto（`dd` 随机填充） | ✅ | ✅ | ✅ |
| MTProto（`ee` fake-TLS） | ✅ **原生** | ❌ **完全没有** | ✅ **我们自己实现了** |

所以「三种代理模式」这个卖点并没有拉开差距——本项目在上一轮已经把 fake-TLS 补齐了。

---

## 二、真正的差距：TDLib 是一个完整客户端，GramJS 只是一个协议库

这是两个东西的本质区别，不是"功能多几个少几个"。

### TDLib 负责什么

TDLib 官方自述：「a cross-platform, **fully functional** Telegram client. We designed it to help third-party developers create their own custom apps」——**它自己就是一个客户端**。它包办：

- 网络实现（含 DC 选路、连接池、backoff、DNS 兜底）
- 加密（MTProto 2.0 全套）
- **本地数据存储**（SQLite + binlog，消息/聊天/文件全表，支持增量同步）
- 数据一致性（保证 updates 顺序）
- 文件下载管理（分片、断点、优先级）

### GramJS 负责什么

GramJS 是**协议层库**：帮你把 MTProto 的 TL 对象、序列化、AuthKey 交换做完，然后给你一个 `client.invoke()`。**上面那一整层——本地数据库、离线缓存、增量同步、文件分片下载、连接池——全都没有，要自己写。**

这正是本项目 `src/tg/telegram.ts` 有 **31KB / 近千行**、`src/tg/` 整个目录 **2129 行**的原因：我们在自己实现很多 TDLib 里现成的东西。

---

## 三、逐项对比

| 维度 | TDLib | GramJS | 谁赢 |
| --- | --- | --- | --- |
| **fake-TLS (`ee`)** | 原生（`emulate_tls()`，域名上限 182 字节） | 无 | TDLib |
| **代理管理 API** | `addProxy`/`editProxy`/`enableProxy`/`removeProxy`/`getProxies`/`pingProxy`/`getProxyLink` | 只能传一个 `proxy` 对象 | TDLib |
| **多代理并存 + 自动切换** | ✅ 存一个代理列表，失败自动换下一个 | ❌ 单代理，切换要重建 client | TDLib |
| **代理连通性测试** | `pingProxy` 返回真实 RTT | 无（只能靠连上与否猜） | TDLib |
| **本地消息数据库** | ✅ SQLite，可离线读取 | ❌ 全在内存 / 自己存 | TDLib |
| **增量同步** | ✅ 只拉 diff | ❌ 自己算 | TDLib |
| **文件下载管理** | ✅ 分片/断点/优先级，Rust 侧持久化 | ❌ 自己做 | TDLib |
| **连接池 / backoff / DNS 兜底** | ✅ 成熟 | ⚠️ 基础 | TDLib |
| **功能覆盖（消息类型等）** | 全（官方同源） | 取决于你调了多少 TL 方法 | TDLib |
| **语言/生态** | C++ / Rust FFI | 纯 JS，npm 直接装 | GramJS |
| **打包体积** | 需带 `tdjson.dll/so`（约 30-80MB） | 纯 JS，几 MB | GramJS |
| **跨平台成本** | 每个平台都要编译/分发原生库 | 一次编写，RN 通吃 | GramJS |
| **RN 集成难度** | ⚠️ 需要 JSI/TurboModule 或原生模块桥 | ✅ 装包即用 | GramJS |
| **调试友好度** | ❌ 跨 FFI 边界，栈不连续 | ✅ 纯 JS，可断点 | GramJS |
| **社区/文档** | 官方维护，权威 | 社区，但活跃 | 平手 |

---

## 四、关键提醒：TDLib 的 fake-TLS 一样救不了你那个 A 代理

上一轮我们验出 A（`akenai.tg`）**根本不是 MTProxy**——它对任意 SNI 都返回自签的 `CN=meow-network.com` 证书，不持有那个密钥。50/50 次探测全部 `hmac=false`。

**换成 TDLib，A 一样连不上。** 因为问题在服务端，不在客户端协议实现。这一点必须先说清楚，避免你为了"让 A 能用"去做一次代价巨大的迁移。

TDLib 能带来的真实收益是：**如果将来你拿到一个合法的 `ee` 代理，TDLib 不需要你写代码**——而我们这边也已经写好了。这方面两边都"能用"。

---

## 五、为什么现在不该换（针对本项目）

### 1. 你已经把最难的部分做完了

上两轮的工作量分布：
- 整个 RN 下让 GramJS 跑起来（Node 内置模块 shim / WebCrypto / `window` 误判）→ **最大的一块**
- SOCKS5/SOCKS4a/HTTP 自研隧道 + 全链路自检
- fake-TLS（`ee`）传输层：官方算子模型 ClientHello + HMAC 校验 + 记录成帧
- 178 个测试、三套 verify 门（shims 10 / transport 29 / faketls 16）

**这些投资在换成 TDLib 后大部分会作废**——因为 TDLib 自己干掉了 shim 层、隧道层、传输层。

### 2. 迁移代价极高，且是"重写"不是"移植"

要换 TDLib，在 RN 里得走通：

```
RN (JS) ──JSI/TurboModule──> 原生桥 (Kotlin/ObjC) ──JNI/FFI──> tdjson
```

具体要做的：
- 为 Android 编译 / 分发 `libtdjson.so`（TDLib 全量编译很重，官方推荐 1.8.68）
- 写原生模块把 `td_send` / `td_receive` 包成 JS 可调（异步回调 + `@extra` 匹配）
- **重写整个 `src/tg/`（2129 行）**：GramJS 的 `client.invoke()` 模型和 TDLib 的「发请求收 updates」模型完全不同
- **重写 `src/screens/`（4156 行）**里所有依赖数据形态的地方（TDLib 的 chat/message 结构 ≠ GramJS 的）
- 失去 jest 直测能力（现在是 178 个纯逻辑测试，跨 FFI 后测不动）
- 打包体积从几 MB 涨到几十 MB

保守估计：**这是重做一个客户端，不是改一个模块。**

### 3. GramJS 的短板本项目已经补上了大半

- fake-TLS → 已实现
- 多代理/自动切换 → 现在也**不需要**：你的三个代理本质是手动切换场景，设置页已经能做
- 本地数据库 → 现阶段"广告过滤 + 最近会话"用内存 + AsyncStorage 够用；真要做，加 SQLite 比换协议便宜得多

### 4. 你的目标不是"复刻 TDLib"

项目定位是**轻量的无广告第三方客户端**（TG Lite）。GramJS 的"薄"在这个定位下是优点：包小、启动快、可控。TDLib 的"厚"是给需要完整离线体验的桌面客户端用的。

---

## 六、建议

### 当前：继续用 GramJS

理由：核心障碍已清除、迁移成本远大于收益、定位匹配。

**唯一值得马上做的**：如果确实需要「多个代理并存 + 自动挑一个能用的」，这在 GramJS 层也能实现，且成本很低——在 `transport.ts` 加一个代理列表 + 依次尝试的逻辑即可，不需要换协议。要不要做，看你对"三个代理都得能用"的真实诉求是「全部生效」还是「有一个能用就行」。

### 什么时候该认真考虑 TDLib

满足以下**任两条**时，迁移才划算：

1. 需要**完整的离线消息数据库**（断网能翻历史、启动秒开）
2. 需要**多账号**且要隔离（这个项目现在没有）
3. 需要**成熟的文件下载管理**（分片/断点/后台续传）
4. 有原生开发能力，愿意维护每个平台的 TDLib 构建产物
5. 目标是桌面端（Tauri/Electron 的 FFI 远比 RN 好接——tdeeeg 选 Tauri 正是这个原因）

**特别注意**：tdeeeg 是 **Tauri（Rust）**，它调 TDLib 走的是 Rust FFI，在桌面上是"顺路"的。你是 **RN/Android**，走的是 JNI + JSI，难度和它**不在一个量级**。不能因为它用 TDLib 好，就推断 RN 用 TDLib 也好。

### 如果一定要迁移

建议顺序：
1. 先用**最小原型**验证 tdjson 在 RN 里跑通（只做 login + 收一条消息），这是最大的技术风险点
2. 原型通了再评估 `src/tg/` 重写量
3. **不要**一上来就动现有代码——保留 GramJS 版本作为可回退分支

---

## 附：本次分析的证据来源

- TDLib 源码 `td/mtproto/ProxySecret.h` / `.cpp`：
  - `emulate_tls()` → `secret_.size() >= 17 && secret_[0] == 0xee`
  - `MAX_DOMAIN_LENGTH = 182`
  - `from_link()` 依次尝试 `hex_decode` → `base64url_decode` → `base64_decode`
  - `from_binary()` 接受：16 字节 / 17 字节且首字节 `0xdd` / ≥18 字节且首字节 `0xee`
- TDLib 源码 `td/telegram/net/Proxy.cpp` → `mtproto::ProxySecret::from_link(type->secret_)`
- TDLib 源码 `td/telegram/net/ConnectionCreator.h` → `prepare_connection()` 里有 `TlsInit`（"Actor emulating TLS handshake for obfuscation"）
- TDLib CHANGELOG 1.3.0：新增 `addProxy`/`editProxy`/`enableProxy`/`disableProxy`/`removeProxy`/`getProxies`/`pingProxy`/`getProxyLink`，以及 `proxyTypeMtproto`
- tdeeeg README：Tauri 2 + Vue 3 + TDLib(via Rust FFI)，代理设置为其 Settings 功能之一
