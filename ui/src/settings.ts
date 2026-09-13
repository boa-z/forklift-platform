// 会话设置与开机行为开关。管理员密码由 daemon 持久化管理（platform.auth），
// 本地只保存本次会话的权限级别与开机行为开关；开关的持久化随 daemon 设置存储。

/** 超级管理员密码（参考实现硬编码）。 */
export const SUPER_PASSWORD = "32431";

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

/** 订阅设置变化，返回取消函数。 */
export function subscribeSettings(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
