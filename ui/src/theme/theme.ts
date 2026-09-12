// 主题：完整 class 字面量集中定义。
// PocketJS v1 样式要求 class 是完整字面量（禁止模板拼接）；字号只支持
// 12/14/16/18/20/24/36/54px（text-xs/sm/base/lg/xl/2xl/4xl/5xl），
// 其他任意字号不会烘焙字库。

import type { Signal, SignalQuality } from "../platform/protocol";

/** 屏幕根容器（取色自参考 main_bg.png）。 */
export const SCREEN_CLASS = "w-full h-full bg-[#080304]";

/** 底部四个按钮槽（背景图上已有槽形，取色 #161717）。 */
export const SLOT_CLASS = "absolute left-0 top-0 rounded-[8] bg-[#161717]";

/** 电量条轨道。 */
export const SOC_TRACK_CLASS = "absolute left-0 top-0 rounded-[4] border border-[#595757] bg-[#1a1a1a]";

/** 子屏翻页按钮（透明槽，图标由 Image 绘制）。 */
export const PAGE_BUTTON_CLASS = "absolute left-0 top-0";

/** 子屏标题。 */
export const TITLE_CLASS = "absolute left-0 top-0 text-2xl text-[#f5f7fa]";

/** 数据行背景（取色自参考菜单项）。 */
export const ROW_CLASS = {
  /** 常规行。 */
  normal: "absolute left-0 top-0 rounded-[8] bg-[#2f3439]",
  /** 严重故障行。 */
  critical: "absolute left-0 top-0 rounded-[8] bg-[#c10706]",
  /** 选中行。 */
  selected: "absolute left-0 top-0 rounded-[8] bg-[#00a452]",
} as const;

/** 主屏文字 class（字号使用受支持的字库槽位）。 */
export const CLASS = {
  clock: "absolute left-0 top-0 text-2xl text-[#f5f7fa] font-bold",
  speedNormal: "absolute left-0 top-0 text-right text-5xl text-[#f5f7fa] font-bold",
  speedWarning: "absolute left-0 top-0 text-right text-5xl text-[#f59e0b] font-bold",
  speedCritical: "absolute left-0 top-0 text-right text-5xl text-[#ef4444] font-bold",
  speedUnit: "absolute left-0 top-0 text-2xl text-[#9aa4b2]",
  socLabel: "absolute left-0 top-0 text-lg text-[#9aa4b2]",
  socValue: "absolute left-0 top-0 text-right text-4xl text-[#f5f7fa] font-bold",
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
