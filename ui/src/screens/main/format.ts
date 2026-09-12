// 主屏数值格式化：质量非 Valid 时统一显示 `--`，与参考仪表的空数据规则一致。

import type { Signal, SignalQuality } from "../../platform/protocol";

/** 质量可用性判断（Valid 才显示数值）。 */
export function usable<T>(signal: Signal<T> | undefined): boolean {
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

/** SOC 电量条素材状态：0 绿 / 1 黄 / 2 红 / 3 空。 */
export function socBarState(signal: Signal<number> | undefined): number {
  if (!usable(signal)) return 3;
  if (signal.value >= 50) return 0;
  if (signal.value >= 20) return 1;
  return 2;
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
