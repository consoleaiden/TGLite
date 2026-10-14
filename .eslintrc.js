module.exports = {
  root: true,
  extends: '@react-native',
  overrides: [
    {
      // polyfill 层与构建脚本运行在 Node 语义下（会用到 Buffer / process / globalThis），
      // 和 App 运行时的 RN 环境不同，所以单独放开 Node 全局变量。
      //
      // fake-TLS 模块同理：它按字节拼 ClientHello、算 HMAC，
      // 在 RN 里跑时 Buffer 由 metro 的 node 内置模块 shim 提供；
      // 测试文件则跑在真实 Node 上。
      files: [
        'src/shims/**/*.js',
        'src/polyfills.js',
        'src/net/mtproxy-faketls.js',
        'scripts/**/*.js',
        '__tests__/**/*.ts',
        'metro.config.js',
      ],
      env: { node: true, es2022: true },
    },
    {
      // fake-TLS 是逐字节拼装 TLS 记录的协议代码，
      // 位运算（掩码、大小端、XOR 时间戳）是它的本意，不是笔误。
      files: ['src/net/mtproxy-faketls.js', '__tests__/faketls.test.ts'],
      rules: { 'no-bitwise': 'off' },
    },
    {
      files: ['*.js', '*.ts', '*.tsx'],
      rules: {
        curly: 'off',
      },
    },
  ],
};
