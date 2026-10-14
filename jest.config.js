module.exports = {
  preset: 'react-native',
  // 时区固定为 UTC：runner 默认 UTC，本机常在 UTC+8，
  // 不统一的话时间相关用例会「本地绿、CI 红」。
  // 注意：时区敏感的用例正确写法是用「本地时间构造 + 本地时间断言」，
  // 而不是硬编码某个时区的字面结果。
  setupFiles: ['<rootDir>/test-utils/setup.js'],
  // 只把 *.test.* / *.spec.* 当测试文件。
  // 否则 __tests__/ 下的辅助文件（如 setup）会被当作空测试套件，
  // 报 "Your test suite must contain at least one test"。
  testMatch: ['<rootDir>/__tests__/**/*.(test|spec).(js|jsx|ts|tsx)'],
};
