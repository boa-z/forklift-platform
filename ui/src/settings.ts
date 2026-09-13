// 会话设置与开机行为开关。管理员密码由 daemon 持久化管理（platform.auth），
// 本地只保存本次会话的权限级别与开机行为开关；开关的持久化随 daemon 设置存储。

/** 超级管理员密码（参考实现硬编码）。 */
export const SUPER_PASSWORD = "32431";

/** 位域 bit0：开机自检。 */
export const SETTING_SELF_CHECK = 1 << 0;
/** 位域 bit1：开机授权（刷卡页）使能。 */
export const SETTING_AUTHORIZATION = 1 << 1;
/** 位域 bit2：密码开机使能。 */
export const SETTING_PASSWORD_BOOT = 1 << 2;
/** 位域 bit3：防拆使能（daemon/MCU 侧处理）。 */
export const SETTING_ANTI_DISMANTLE = 1 << 3;
/** 默认位域：授权使能开启，其余关闭（与参考一致）。 */
export const DEFAULT_SETTINGS_FLAGS = SETTING_AUTHORIZATION;

let selfCheckEnabled = false;
let authorizationEnabled = true;
let passwordBootEnabled = false;
let authLevel = 0;

const listeners = new Set<() => void>();

/** 通知设置订阅者。 */
function notify(): void {
  for (const listener of listeners) listener();
}

/** 开机自检开关（默认关闭）。 */
export function getSelfCheckEnabled(): boolean {
  return selfCheckEnabled;
}

/** 设置开机自检开关。 */
export function setSelfCheckEnabled(enabled: boolean): void {
  selfCheckEnabled = enabled;
  notify();
}

/** 开机授权（刷卡页）开关（默认开启）。 */
export function getAuthorizationEnabled(): boolean {
  return authorizationEnabled;
}

/** 设置开机授权开关。 */
export function setAuthorizationEnabled(enabled: boolean): void {
  authorizationEnabled = enabled;
  notify();
}

/** 密码开机开关（默认关闭，参考 `CommonWriteReadConfig.c`）。 */
export function getPasswordBootEnabled(): boolean {
  return passwordBootEnabled;
}

/** 设置密码开机开关。 */
export function setPasswordBootEnabled(enabled: boolean): void {
  passwordBootEnabled = enabled;
  notify();
}

/** 当前设置权限级别（0 用户/1 管理员/2 超级管理员）。 */
export function getAuthLevel(): number {
  return authLevel;
}

/** 记录本次会话的设置权限级别。 */
export function setAuthLevel(level: number): void {
  authLevel = level;
  notify();
}

/** 应用 daemon 下发的设置位域（防拆位由 daemon/MCU 维护，不在 UI 镜像）。 */
export function applySettingsFlags(flags: number): void {
  selfCheckEnabled = (flags & SETTING_SELF_CHECK) !== 0;
  authorizationEnabled = (flags & SETTING_AUTHORIZATION) !== 0;
  passwordBootEnabled = (flags & SETTING_PASSWORD_BOOT) !== 0;
  notify();
}

/** 汇总当前位域；防拆位由调用方传入平台状态。 */
export function currentSettingsFlags(antiDismantle: boolean): number {
  let flags = 0;
  if (selfCheckEnabled) flags |= SETTING_SELF_CHECK;
  if (authorizationEnabled) flags |= SETTING_AUTHORIZATION;
  if (passwordBootEnabled) flags |= SETTING_PASSWORD_BOOT;
  if (antiDismantle) flags |= SETTING_ANTI_DISMANTLE;
  return flags;
}

/** 订阅设置变化，返回取消函数。 */
export function subscribeSettings(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
