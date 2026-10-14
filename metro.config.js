const path = require('path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

const shim = (name) => path.resolve(__dirname, 'src/shims', name);

/**
 * Metro 解析配置。
 *
 * GramJS（npm 包 `telegram`）require 了一批 Node 内置模块，React Native 里没有。
 * 这里把它们重定向到 `src/shims/` 下的纯 JS 实现。
 *
 * ⚠️ 为什么不能只用 extraNodeModules：
 *   metro-resolver 会把 extraNodeModules 拼在真正的 node_modules 之后，
 *   于是 node_modules 里真实存在的 socks / websocket / store2 / node-localstorage
 *   （telegram 的传递依赖）会盖掉我们的实现，进而把 graceful-fs 之类的
 *   整个 Node 生态拖进依赖图，打包直接失败。
 *   所以这里用 resolveRequest 做「强拦截」：命中就直接返回 shim，否则透传给默认解析器。
 *
 * 已核对 metro-resolver 源码：context.resolveRequest 指向默认解析器（不是本函数），
 * 因此下面的透传不会造成递归。
 */
const nodeModuleShims = {
  // 安全随机数 / SHA / HMAC / PBKDF2 / WebCrypto（纯 JS，零原生依赖）
  crypto: shim('crypto.js'),

  // TCP 通道，底层是 react-native-tcp-socket（MTProto 需要裸 TCP）
  net: shim('net.js'),
  tls: shim('tls.js'),

  // GramJS 内部会做 path 拼接、以及按文件路径上传下载（本客户端不使用文件系统）
  path: require.resolve('path-browserify'),
  fs: shim('fs.js'),
  os: shim('os.js'),
  util: shim('util.js'),
  events: shim('events.js'),

  // 会话存储相关的 Node 专用包（我们用 StringSession + AsyncStorage）
  store2: shim('store2.js'),
  'node-localstorage': shim('node-localstorage.js'),

  // 代理隧道与通道选择：net 走 SOCKS5/SOCKS4/HTTP CONNECT（见 src/shims/tunnel.js），
  // websocket 在切到 WebSocket 通道时被 GramJS 用来做 MTProto over wss
  websocket: shim('websocket.js'),
  socks: shim('socks.js'),

  // 其余永远不会用到的 Node 模块，给空实现
  assert: shim('empty.js'),
  http: shim('empty.js'),
  https: shim('empty.js'),
  zlib: shim('empty.js'),
  stream: shim('empty.js'),
  dns: shim('empty.js'),
  child_process: shim('empty.js'),
  perf_hooks: shim('empty.js'),
  worker_threads: shim('empty.js'),
  readline: shim('empty.js'),
  vm: shim('empty.js'),
  constants: shim('empty.js'),
  module: shim('empty.js'),
  timers: shim('empty.js'),
  'graceful-fs': shim('empty.js'),

  // 兼容 node: 前缀写法
  'node:crypto': shim('crypto.js'),
  'node:net': shim('net.js'),
  'node:fs': shim('fs.js'),
  'node:os': shim('os.js'),
  'node:util': shim('util.js'),
  'node:events': shim('events.js'),
  'node:path': require.resolve('path-browserify'),
  'node:stream': shim('empty.js'),
  'node:assert': shim('empty.js'),
};

const intercepted = new Set(Object.keys(nodeModuleShims));

const config = {
  resolver: {
    extraNodeModules: nodeModuleShims,

    resolveRequest: (context, moduleName, platform) => {
      // 强拦截：Node 内置模块永远走我们的 shim，不让 node_modules 里的同名包抢先
      if (intercepted.has(moduleName)) {
        return { type: 'sourceFile', filePath: nodeModuleShims[moduleName] };
      }
      if (moduleName.startsWith('node:') && intercepted.has(moduleName.slice(5))) {
        return { type: 'sourceFile', filePath: nodeModuleShims[moduleName.slice(5)] };
      }
      return context.resolveRequest(context, moduleName, platform);
    },
  },
  transformer: {
    getTransformOptions: async () => ({
      transform: {
        inlineRequires: true,
      },
    }),
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
