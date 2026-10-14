/**
 * 构建期生成的 API 凭据。
 *
 * - 仓库里提交的默认值是空的，不会泄露任何凭据；
 * - 构建前执行 `node scripts/gen-config.js` 会用
 *   `TG_API_ID` / `TG_API_HASH` 环境变量（CI 里来自 GitHub Secrets）覆盖这个文件；
 * - 也可以完全留空，改在 App 登录页手动填写。
 */
export const GENERATED = {
  apiId: '',
  apiHash: '',
};
