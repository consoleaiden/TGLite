#!/usr/bin/env node
/**
 * 构建前把 api_id / api_hash 写入 src/config.generated.ts。
 *
 * 取值来源：环境变量 TG_API_ID / TG_API_HASH
 *   - CI：从 GitHub Secrets 注入
 *   - 本地：TG_API_ID=123 TG_API_HASH=abc node scripts/gen-config.js
 *
 * 两个变量都没有提供时，会写入空值：App 里改用手动填写，仓库依旧不含任何凭据。
 */
const fs = require('fs');
const path = require('path');

const apiId = (process.env.TG_API_ID || '').trim();
const apiHash = (process.env.TG_API_HASH || '').trim();

const target = path.resolve(__dirname, '..', 'src', 'config.generated.ts');

const file = `/**
 * 本文件由 scripts/gen-config.js 自动生成，请勿手动修改。
 * 生成时间: ${new Date().toISOString()}
 * 凭据来源: ${apiId && apiHash ? '构建环境变量' : '未提供（App 内手动填写）'}
 */
export const GENERATED = {
  apiId: '${apiId.replace(/'/g, "\\'")}',
  apiHash: '${apiHash.replace(/'/g, "\\'")}',
};
`;

fs.writeFileSync(target, file, 'utf8');

if (apiId && apiHash) {
  console.log(`[gen-config] 已写入内置凭据 api_id=${apiId}（api_hash 已隐藏）`);
} else {
  console.log('[gen-config] 未提供 TG_API_ID / TG_API_HASH，App 将要求手动填写凭据。');
}
