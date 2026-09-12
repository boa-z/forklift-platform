// 充电屏模型测试：SOC 文本与完成判定。

import { describe, expect, test } from "bun:test";

import type { Signal } from "../src/platform/protocol";
import { chargingComplete, chargingSocText } from "../src/screens/charging/model";

/** 构造有效信号。 */
function valid(value: number): Signal<number> {
  return { value, timestampMs: Date.now(), quality: "valid" };
}

describe("充电屏模型", () => {
  test("SOC 文本两位补零，100 三位", () => {
    expect(chargingSocText(valid(7))).toBe("07");
    expect(chargingSocText(valid(56))).toBe("56");
    expect(chargingSocText(valid(99.6))).toBe("100");
    expect(chargingSocText(valid(100))).toBe("100");
    expect(chargingSocText(valid(-5))).toBe("00");
    expect(chargingSocText(undefined)).toBe("00");
    expect(chargingSocText({ value: 56, timestampMs: 0, quality: "invalid" })).toBe("00");
  });

  test("完成判定为 SOC >= 100", () => {
    expect(chargingComplete(valid(99))).toBe(false);
    expect(chargingComplete(valid(100))).toBe(true);
    expect(chargingComplete(undefined)).toBe(false);
  });
});
