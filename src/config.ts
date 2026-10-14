import { GENERATED } from './config.generated';

/** 构建期注入的 api_id（可为空，此时由用户在登录页手填） */
export const BUILTIN_API_ID = Number(GENERATED.apiId) || 0;

/** 构建期注入的 api_hash（可为空） */
export const BUILTIN_API_HASH = GENERATED.apiHash || '';

/** 官方申请 api_id / api_hash 的地址 */
export const API_CREDENTIALS_URL = 'https://my.telegram.org/apps';

/** 会话列表单次拉取上限 */
export const DIALOG_FETCH_LIMIT = 100;

/** 聊天页单次拉取消息条数 */
export const MESSAGE_FETCH_LIMIT = 50;

/**
 * 首次登录时的引导 DC。
 * 账号真实所在 DC 会在 auth.SendCode 返回 PHONE_MIGRATE_x 时自动切换。
 * 这几个是 Telegram 生产环境 DC 的固定 IPv4 地址。
 */
export const BOOTSTRAP_DC = { id: 2, ip: '149.154.167.51', port: 443 };

/** 首次登录默认连接的 DC 地址表（切 DC 时会配合 help.getConfig 返回的真实地址） */
export const TELEGRAM_DC_IPV4: Record<number, string> = {
  1: '149.154.175.53',
  2: '149.154.167.51',
  3: '149.154.175.100',
  4: '149.154.167.91',
  5: '91.108.56.130',
};

export const APP_NAME = 'TG Lite';
export const APP_VERSION = '1.0.0';
