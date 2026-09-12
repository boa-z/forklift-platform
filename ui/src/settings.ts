// 本地设置存储：管理员密码等随会话保存（持久化随 M3 的 daemon 设置存储）。
// 超级管理员密码与参考实现一致（"32431"）。

/** 超级管理员密码（参考实现硬编码）。 */
export const SUPER_PASSWORD = "32431";

let adminPassword = "";
const listeners = new Set<() => void>();

/** 当前管理员密码（可为空 = 未设置）。 */
export function getAdminPassword(): string {
  return adminPassword;
}

/** 设置管理员密码。 */
export function setAdminPassword(password: string): void {
  adminPassword = password;
  for (const listener of listeners) listener();
}

/** 订阅设置变化，返回取消函数。 */
export function subscribeSettings(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
