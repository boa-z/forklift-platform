// 主题：完整 class 字面量集中定义。
// PocketJS v1 样式要求 class 是完整字面量（禁止模板拼接）；字号只支持
// 12/14/16/18/20/24/36/54px（text-xs/sm/base/lg/xl/2xl/4xl/5xl），
// 其他任意字号不会烘焙字库。

import type { Signal, SignalQuality } from "../platform/protocol";

/** 屏幕根容器（取色自参考 main_bg.png）。 */
export const SCREEN_CLASS = "w-full h-full bg-[#080304]";

/** 子屏翻页按钮（透明槽，图标由 Image 绘制）。 */
export const PAGE_BUTTON_CLASS = "absolute left-0 top-0";

/** 子屏标题。 */
export const TITLE_CLASS = "absolute left-0 top-0 text-2xl text-[#f5f7fa]";

/** 主屏文字 class（字号使用受支持的字库槽位）。 */
export const CLASS = {
  clock: "absolute left-0 top-0 text-2xl text-[#f5f7fa] font-bold",
  speedUnit: "absolute left-0 top-0 text-2xl text-[#9aa4b2]",
  socLabel: "absolute left-0 top-0 text-lg text-[#9aa4b2]",
  counter: "absolute left-0 top-0 text-2xl text-[#f5f7fa] font-bold",
  counterLabel: "absolute left-0 top-0 text-xs text-[#9aa4b2]",
  steerValue: "absolute left-0 top-0 text-lg text-[#f5f7fa]",
  screenTitle: "absolute left-0 top-0 text-2xl text-[#f5f7fa]",
  pageLabel: "absolute left-0 top-0 text-center text-base text-[#f5f7fa]",
  rowText: "absolute left-0 top-0 text-lg text-[#f5f7fa]",
  rowIndex: "absolute left-0 top-0 text-base text-[#9aa4b2]",
  rowValue: "absolute left-0 top-0 text-lg text-right text-[#f5f7fa]",
  emptyText: "absolute left-0 top-0 text-center text-xl text-[#9aa4b2]",
  menuItemText: "absolute left-0 top-0 text-center text-lg text-[#f5f7fa]",
  progressLabel: "absolute left-0 top-0 text-right text-base text-[#b3b2b3]",
  enterButtonText: "absolute left-0 top-0 text-center text-xl text-[#f5f7fa]",
  chargingStatus: "absolute left-0 top-0 text-center text-xl text-[#fcfcfc]",
  dialogLabel: "absolute left-0 top-0 text-base text-[#f5f7fa]",
  dialogLabelDisabled: "absolute left-0 top-0 text-base text-[#7c7c7c]",
  dialogValue: "absolute left-0 top-0 text-right text-xl text-[#f5f7fa]",
  passwordText: "absolute left-0 top-0 text-lg text-[#f5f7fa]",
  passwordKey: "absolute left-0 top-0 text-center text-2xl text-[#f5f7fa]",
} as const;

/** 电量条填充色（返回完整字面量；分段阈值与参考一致）。 */
export function socFillClass(signal: Signal<number> | undefined): string {
  const value = signal !== undefined && signal.quality === "valid" ? signal.value : -1;
  if (value > 20) return "absolute left-0 top-0 rounded-[6] bg-[#00a552]";
  if (value > 10) return "absolute left-0 top-0 rounded-[6] bg-[#f8b62d]";
  if (value >= 0) return "absolute left-0 top-0 rounded-[6] bg-[#c10706]";
  return "absolute left-0 top-0 rounded-[6] bg-[#595757]";
}

/** 速度数字贴图集合随信号质量切换。 */
export function speedDigitSet(quality: SignalQuality | undefined): "speed54" | "speed54w" | "speed54c" {
  switch (quality) {
    case "valid":
      return "speed54";
    case "stale":
      return "speed54w";
    default:
      return "speed54c";
  }
}
