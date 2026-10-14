/**
 * `fs` 模块占位。
 * GramJS 只在「按文件路径上传/下载」时用到 fs，本客户端不涉及文件系统读写。
 * 保留导出避免打包失败；真被调用时抛出可读的错误。
 */
function notSupported(name) {
  return function () {
    throw new Error(`[tg-lite] fs.${name} 不可用：React Native 没有文件系统模块，本客户端也未使用文件上传/下载。`);
  };
}

module.exports = {
  readFile: notSupported('readFile'),
  readFileSync: notSupported('readFileSync'),
  writeFile: notSupported('writeFile'),
  writeFileSync: notSupported('writeFileSync'),
  createReadStream: notSupported('createReadStream'),
  createWriteStream: notSupported('createWriteStream'),
  promises: {
    readFile: notSupported('promises.readFile'),
    writeFile: notSupported('promises.writeFile'),
    stat: notSupported('promises.stat'),
  },
  existsSync: () => false,
  statSync: notSupported('statSync'),
  mkdirSync: notSupported('mkdirSync'),
};
