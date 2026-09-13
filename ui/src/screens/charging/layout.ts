// 充电屏布局常量：对应参考 LvglChargingScreen.c 的元素坐标。
// 圆环动画素材按内容区 (180,0)-(624,478) 裁切，SOC 为 90px 数字贴图。

/** 充电屏布局。 */
export const CHARGING = {
  /** 圆环动画贴图（原始帧裁切后的位置与内容尺寸）。 */
  ring: { x: 180, y: 0, w: 445, h: 479 },
  /** SOC 数字显示区（参考 317,108 180×89）。 */
  soc: { x: 317, y: 108, w: 180, h: 89 },
  /** 数字间距（比例字宽 + 间距，整体居中）。 */
  digitGap: 8,
  /** 状态文字（正在充电 / 充电完成）。 */
  status: { x: 350, y: 265, w: 101, h: 36 },
  /** 动画帧间隔（毫秒，参考 100ms 定时分频后为 200ms）。 */
  frameMs: 200,
} as const;

/** 动画帧素材名（按参考帧序采样）。 */
export const CHARGING_FRAMES = ["charging-01"] as const;

export type ChargingFrame = (typeof CHARGING_FRAMES)[number];
