// 密码校验模型：与参考一致，超级密码优先，其次是管理员密码。

import { SUPER_PASSWORD } from "../../settings";

/** 校验结果：无权限 / 管理员 / 超级管理员。 */
export type PasswordRole = "none" | "admin" | "super";

/** 校验输入密码；空管理员密码视为未设置。 */
export function checkPassword(input: string, adminPassword: string): PasswordRole {
  if (input === "") return "none";
  if (input === SUPER_PASSWORD) return "super";
  if (adminPassword !== "" && input === adminPassword) return "admin";
  return "none";
}
