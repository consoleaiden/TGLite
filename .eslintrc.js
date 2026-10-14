module.exports = {
  root: true,
  extends: '@react-native',
  overrides: [
    {
      // polyfill 层与构建脚本运行在 Node 语义下（会用到 Buffer / process / globalThis），
      // 和 App 运行时的 RN 环境不同，所以单独放开 Node 全局变量。
      files: ['src/shims/**/*.js', 'src/polyfills.js', 'scripts/**/*.js', 'metro.config.js'],
      env: { node: true, es2022: true },
    },
    {
      files: ['*.js', '*.ts', '*.tsx'],
      rules: {
        curly: 'off',
      },
    },
  ],
};
