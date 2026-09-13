// 充电屏模型：SOC 文本与充电完成判定（与参考的 `%02u`/100 规则一致）。

import type { Signal } from "../../platform/protocol";
import { usable } from "../main/format";

/** SOC 文本：0-99 补零两位，100 显示三位；无数据 `00`。 */
export function chargingSocText(signal: Signal<number> | undefined): string {
  if (!usable(signal)) return "00";
  const value = Math.min(100, Math.max(0, Math.round(signal.value)));
  return value >= 100 ? "100" : String(value).padStart(2, "0");
}

/** 充电完成：SOC 达到 100（与参考一致）。 */
export function chargingComplete(signal: Signal<number> | undefined): boolean {
  return usable(signal) && signal.value >= 100;
}
