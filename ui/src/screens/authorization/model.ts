// 授权屏状态模型：由模组刷卡上报与 daemon 授权状态推导界面阶段。

import type { LanKey } from "../../i18n";

/** 模组刷卡状态码（与参考 CommonSerialParse 枚举一致）。 */
export const SWIPE_STATUS = {
  failed: 0,
  authorized: 1,
  duplicate: 2,
  otherCard: 3,
  powerOff: 4,
  silent: 5,
} as const;

/** 授权屏阶段。 */
export type AuthPhase = "waiting" | "licenseTail" | "success" | "failed";

/** 由刷卡上报推导下一阶段：静默期直接成功；授权成功且 daemon 未置授权 → 双重认证。 */
export function phaseForSwipe(status: number, authorizedByDaemon: boolean): AuthPhase {
  if (status === SWIPE_STATUS.silent) return "success";
  if (status === SWIPE_STATUS.authorized) {
    return authorizedByDaemon ? "success" : "licenseTail";
  }
  return "failed";
}

/** 刷卡结果对应的提示文案键。 */
export function swipeStatusKey(status: number): LanKey {
  switch (status) {
    case SWIPE_STATUS.authorized:
    case SWIPE_STATUS.silent:
      return "JCLIB_LAN_AUTH_SUCCESS";
    case SWIPE_STATUS.duplicate:
      return "JCLIB_LAN_AUTH_FAILED";
    default:
      return "JCLIB_LAN_CARD_UNAUTHORIZED";
  }
}

/** 蓝牙开机卡号（参考 `DD CC BB AA`）。 */
export const BLUETOOTH_CARD = "ddccbbaa";

/** 开机上报类型：0 密码/1 刷卡/4 蓝牙。 */
export function powerOnKindForCard(card: string): number {
  return card === BLUETOOTH_CARD ? 4 : 1;
}
