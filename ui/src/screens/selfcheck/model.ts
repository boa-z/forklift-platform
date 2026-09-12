// 自检项模型：每项的文案键与状态判定（数据来自平台 VehicleState）。
// 参考实现默认全 ✓、有问题才变 X；无数据源时保持 pending（不伪造通过）。

import type { LanKey } from "../../i18n";
import type { VehicleState } from "../../platform";

/** 单项状态：通过 / 失败 / 等待数据。 */
export type CheckStatus = "pass" | "fail" | "pending";

/** 一个自检项。 */
export interface CheckItem {
  /** 名称语言键。 */
  labelKey: LanKey;
  /** 由车辆状态判定状态；无数据返回 pending。 */
  status: (state: VehicleState | undefined) => CheckStatus;
}

/** 布尔信号的判定：状态存在即通过或失败。 */
function fromBoolean(state: VehicleState | undefined, pick: (value: VehicleState) => boolean): CheckStatus {
  if (state === undefined) return "pending";
  return pick(state) ? "pass" : "fail";
}

/** 6 个自检项（顺序与布局 itemPositions 一致）。 */
export const SELF_CHECK_ITEMS: readonly CheckItem[] = [
  { labelKey: "JCLIB_LAN_CAN_COMMUNICATION", status: (state) => fromBoolean(state, (value) => value.canOnline) },
  { labelKey: "JCLIB_LAN_TRACTION_CONTROLLER", status: (state) => fromBoolean(state, (value) => value.controllerOnline[0] === true) },
  { labelKey: "JCLIB_LAN_OIL_PUMP_CONTROLLER", status: (state) => fromBoolean(state, (value) => value.controllerOnline[1] === true) },
  { labelKey: "JCLIB_LAN_STEERING_CONTROLLER", status: (state) => fromBoolean(state, (value) => value.controllerOnline[2] === true) },
  {
    labelKey: "JCLIB_LAN_STEERING_ANGLE_CTRL",
    status: (state) => (state === undefined ? "pending" : state.steerAngleDeg.quality === "valid" ? "pass" : "fail"),
  },
  // 超声波雷达数据源随 M3 的 IO/CAN 后端接入；此前保持等待，不伪造通过。
  { labelKey: "JCLIB_LAN_ULTRASONIC_RADAR", status: () => "pending" },
];

/** 计算全部自检项的状态。 */
export function checkStatuses(state: VehicleState | undefined): CheckStatus[] {
  return SELF_CHECK_ITEMS.map((item) => item.status(state));
}

/** 进度百分比：通过项 / 总项数。 */
export function checkProgress(statuses: readonly CheckStatus[]): number {
  if (statuses.length === 0) return 0;
  const passed = statuses.filter((status) => status === "pass").length;
  return Math.round((passed * 100) / statuses.length);
}

/** 是否全部通过。 */
export function allPassed(statuses: readonly CheckStatus[]): boolean {
  return statuses.length > 0 && statuses.every((status) => status === "pass");
}
