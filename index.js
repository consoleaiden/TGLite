/**
 * App 入口。
 *
 * ⚠️ 第一行必须是 polyfills，它会补齐 Buffer / WebCrypto / TCP 等 GramJS 的运行前提，
 *    并且必须在任何模块 import `telegram` 之前执行完。
 */
require('./src/polyfills');

const { AppRegistry } = require('react-native');
const App = require('./App').default;
const { name: appName } = require('./app.json');

AppRegistry.registerComponent(appName, () => App);
