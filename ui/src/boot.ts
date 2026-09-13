// 开机阶段决策：充电优先由外壳处理；其余按“自检 → 授权 → 主界面”的顺序，
// 与参考工程 `LvglBoostScreen.c` 的设置条件一致（自检默认关闭、授权默认开启）。

/** 开机阶段。 */
export type BootStage = "selfcheck" | "authorization" | "main";

/** 由设置决定首个开机阶段：自检优先，其次授权，最后主界面。 */
export function initialBootStage(selfCheck: boolean, authorization: boolean): BootStage {
  if (selfCheck) return "selfcheck";
  if (authorization) return "authorization";
  return "main";
}

/** 自检结束后的阶段：授权开启则进入授权，否则主界面。 */
export function stageAfterSelfCheck(authorization: boolean): BootStage {
  return authorization ? "authorization" : "main";
}
