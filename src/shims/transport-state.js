/**
 * 传输层共享状态。
 *
 * 为什么要有这么一个"全局小盒子"：
 *   Metro 把 `net` / `websocket` / `socks` 重定向到了本目录下的 shim，
 *   这些 shim 是被 GramJS **同步 require** 的，拿不到 React 的 store。
 *   而代理配置是用户在设置页异步改的，所以需要一个双方都能访问的可变状态。
 *
 * 写入方：src/net/transport.ts（在 new TelegramClient(...) 之前调用）
 * 读取方：src/shims/net.js / socks.js
 */
'use strict';

const DEFAULT_STATE = {
  proxy: null, // null | { kind, host, port, username, password, timeoutMs }
  revision: 0,
};

let state = { ...DEFAULT_STATE };

function normalizeProxy(proxy) {
  if (!proxy || !proxy.enabled) return null;
  const host = String(proxy.host || '').trim();
  const port = Number(proxy.port);
  if (!host || !Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`代理配置不完整：host=${host || '(空)'} port=${proxy.port}`);
  }
  const kind = String(proxy.kind || 'socks5').toLowerCase();
  if (!['socks5', 'socks4', 'http'].includes(kind)) {
    throw new Error(`不支持的代理类型：${proxy.kind}`);
  }
  return {
    kind,
    host,
    port,
    username: proxy.username ? String(proxy.username) : '',
    password: proxy.password ? String(proxy.password) : '',
    timeoutMs: 10000,
  };
}

/** @param {{enabled:boolean,kind:string,host:string,port:string|number,username?:string,password?:string}|null} proxy */
function setProxy(proxy) {
  state.proxy = normalizeProxy(proxy);
  state.revision += 1;
  return state.proxy;
}

/** @returns {null | {kind:string,host:string,port:number,username:string,password:string,timeoutMs:number}} */
function getProxy() {
  return state.proxy;
}

function hasProxy() {
  return state.proxy !== null;
}

function getRevision() {
  return state.revision;
}

function reset() {
  state = { ...DEFAULT_STATE, revision: state.revision + 1 };
}

module.exports = { setProxy, getProxy, hasProxy, getRevision, reset };
