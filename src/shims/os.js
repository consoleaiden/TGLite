/**
 * `os` 模块的最小实现。
 * GramJS 只在生成设备信息（deviceModel / systemVersion）和日志时用到。
 */
const os = {
  EOL: '\n',
  platform: () => 'android',
  type: () => 'Android',
  arch: () => 'arm64',
  release: () => '14',
  version: () => '',
  hostname: () => 'localhost',
  tmpdir: () => '/tmp',
  homedir: () => '/',
  endianness: () => 'LE',
  cpus: () => [],
  totalmem: () => 0,
  freemem: () => 0,
  loadavg: () => [0, 0, 0],
  uptime: () => 0,
  userInfo: () => ({ username: 'telegram', uid: -1, gid: -1, shell: null, homedir: '/', cpus: [] }),
  networkInterfaces: () => ({}),
};

module.exports = os;
module.exports.default = os;
