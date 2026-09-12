// 主题：完整 class 字面量集中定义。
// PocketJS v1 样式要求 class 是完整字面量（禁止模板拼接），所以这里只提供
// 整段常量与“返回字面量”的选择函数。

import type { Signal, SignalQuality } from "../platform/protocol";

/** 屏幕根容器（取色自参考 main_bg.png）。 */
export const SCREEN_CLASS = "w-full h-full bg-[#080304]";

/** 底部四个按钮槽（背景图上已有槽形，取色 #161717）。 */
export const SLOT_CLASS = "absolute left-0 top-0 rounded-[8] bg-[#161717]";

/** 电量条轨道。 */
export const SOC_TRACK_CLASS = "absolute left-0 top-0 rounded-[4] border border-[#595757] bg-[#1a1a1a]";

/** 主屏文字 class（全部为完整字面量）。 */
export const CLASS = {
  clock: "absolute left-0 top-0 text-[22] text-[#f5f7fa] font-bold",
  speedNormal: "absolute left-0 top-0 text-right text-[78] text-[#f5f7fa] font-bold",
  speedWarning: "absolute left-0 top-0 text-right text-[78] text-[#f59e0b] font-bold",
  speedCritical: "absolute left-0 top-0 text-right text-[78] text-[#ef4444] font-bold",
  speedUnit: "absolute left-0 top-0 text-[22] text-[#9aa4b2]",
  socLabel: "absolute left-0 top-0 text-[18] text-[#9aa4b2]",
  socValue: "absolute left-0 top-0 text-right text-[32] text-[#f5f7fa] font-bold",
  counter: "absolute left-0 top-0 text-[24] text-[#f5f7fa] font-bold",
  counterLabel: "absolute left-0 top-0 text-[12] text-[#9aa4b2]",
  steerValue: "absolute left-0 top-0 text-[18] text-[#f5f7fa]",
} as const;

/** 电量条填充色（返回完整字面量）。 */
export function socFillClass(signal: Signal<number> | undefined): string {
  const value = signal !== undefined && signal.quality === "valid" ? signal.value : -1;
  if (value >= 50) return "absolute left-0 top-0 rounded-[4] bg-[#00a552]";
  if (value >= 20) return "absolute left-0 top-0 rounded-[4] bg-[#f8b62d]";
  if (value >= 0) return "absolute left-0 top-0 rounded-[4] bg-[#c10706]";
  return "absolute left-0 top-0 rounded-[4] bg-[#595757]";
}

/** 速度值颜色随信号质量切换（返回完整字面量）。 */
export function speedClass(quality: SignalQuality | undefined): string {
  switch (quality) {
    case "valid":
      return CLASS.speedNormal;
    case "stale":
      return CLASS.speedWarning;
    default:
      return CLASS.speedCritical;
  }
}
