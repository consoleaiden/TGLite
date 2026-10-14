/**
 * `util` 模块的最小实现。
 * GramJS 的 inspect.js 只用到 util.inspect（用于控制台美化输出）。
 */
function inspect(value, options) {
  const opts = options || {};
  try {
    if (typeof value === 'string') return opts.depth === 0 ? value : `'${value}'`;
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';
    if (typeof value !== 'object') return String(value);
    return JSON.stringify(value, (key, val) => (typeof val === 'bigint' ? `${val}n` : val), 2);
  } catch (err) {
    return String(value);
  }
}

inspect.custom = Symbol.for('nodejs.util.inspect.custom');
inspect.defaultOptions = { depth: 3, colors: false };
inspect.format = (...args) => args.map((arg) => inspect(arg)).join(' ');
inspect.promisify = (fn) => (...args) =>
  new Promise((resolve, reject) => fn(...args, (err, res) => (err ? reject(err) : resolve(res))));
inspect.types = { isDate: (v) => v instanceof Date, isRegExp: (v) => v instanceof RegExp };

module.exports = inspect;
module.exports.inspect = inspect;
module.exports.default = inspect;
