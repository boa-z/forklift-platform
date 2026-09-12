// 主屏数值格式化：质量非 Valid 时统一显示 `--`，与参考仪表的空数据规则一致。

import type { Signal, SignalQuality } from "../../platform/protocol";

/** 质量可用性判断（Valid 才显示数值）。 */
export function usable<T>(signal: Signal<T> | undefined): signal is Signal<T> {
  return signal !== undefined && signal.quality === "valid";
}

/** 速度：`12.5`。 */
export function formatSpeed(signal: Signal<number> | undefined): string {
  return usable(signal) ? signal.value.toFixed(1) : "--";
}

/** 电量：`56%`。 */
export function formatSoc(signal: Signal<number> | undefined): string {
  return usable(signal) ? `${Math.round(signal.value)}%` : "--%";
}

/** 工时：`12.5h`。 */
export function formatWorkhour(signal: Signal<number> | undefined): string {
  return usable(signal) ? `${signal.value.toFixed(1)}h` : "--h";
}

/** 里程：`123km`。 */
export function formatOdometer(signal: Signal<number> | undefined): string {
  return usable(signal) ? `${Math.round(signal.value)}km` : "--km";
}

/** 转向角：`-45°`。 */
export function formatSteerAngle(signal: Signal<number> | undefined): string {
  return usable(signal) ? `${Math.round(signal.value)}°` : "--°";
}

/** 倒车距离：`0.8m`。 */
export function formatDistance(signal: Signal<number> | undefined): string {
  return usable(signal) ? `${signal.value.toFixed(1)}m` : "--m";
}

/** 时钟：`HH:MM`。 */
export function formatClock(date: Date): string {
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

/** 电量条分段形状（宽度公式与分段贴图边界参照参考实现）。 */
export interface SocBarShape {
  /** 完整分段数。 */
  full: number;
  /** 末尾不足一个分段的像素宽度。 */
  partial: number;
}

/** 分段间距（每 10% 一个分段）。 */
export const SOC_SEGMENT_PITCH = 67;
/** 单个分段内容宽度。 */
export const SOC_SEGMENT_WIDTH = 62;

/** 由电量百分比计算分段形状；无效值返回全空。 */
export function socBarShape(percent: number | undefined): SocBarShape {
  if (percent === undefined) return { full: 0, partial: 0 };
  const soc = Math.min(100, Math.max(0, Math.round(percent)));
  let width = soc >= 10 ? Math.floor((67 * soc) / 10) - 6 : Math.floor((soc * 61) / 10);
  if (soc === 11 || soc === 21 || soc === 31) width += 1;
  for (let index = 0; index < 10; index += 1) {
    const start = index * SOC_SEGMENT_PITCH;
    if (width >= start + SOC_SEGMENT_WIDTH) continue;
    return { full: index, partial: Math.max(0, width - start) };
  }
  return { full: 10, partial: 0 };
}

/** 电量条分段贴图：高于 20% 绿色，10%~20% 黄色，其余红色。 */
export function socSegmentAsset(percent: number | undefined): "soc_seg_green" | "soc_seg_yellow" | "soc_seg_red" {
  const value = percent ?? 0;
  if (value > 20) return "soc_seg_green";
  if (value > 10) return "soc_seg_yellow";
  return "soc_seg_red";
}

/** 档位枚举（素材名由组件映射到烘焙表）。 */
export type Gear = "D" | "R" | "N";

/** 由方向信号得到档位，未知返回 null。 */
export function gear(direction: Signal<string> | undefined): Gear | null {
  if (!usable(direction)) return null;
  switch (direction.value) {
    case "forward":
      return "D";
    case "reverse":
      return "R";
    case "neutral":
      return "N";
    default:
      return null;
  }
}

/** 质量用于颜色分级：valid 正常，stale 警告，其余严重。 */
export function qualityKind(quality: SignalQuality | undefined): "normal" | "warning" | "critical" {
  switch (quality) {
    case "valid":
      return "normal";
    case "stale":
      return "warning";
    default:
      return "critical";
  }
}
