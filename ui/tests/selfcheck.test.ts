// 自检模型测试：状态判定、进度与完成条件（不依赖渲染）。

import { describe, expect, test } from "bun:test";

import type { VehicleState } from "../src/platform/protocol";
import { SELF_CHECK_ITEMS, allPassed, checkProgress, checkStatuses } from "../src/screens/selfcheck/model";

/** 构造测试用车辆状态（默认全部在线）。 */
function state(overrides: Partial<VehicleState> = {}): VehicleState {
  const signal = <T,>(value: T): { value: T; timestampMs: number; quality: "valid" } => ({
    value,
    timestampMs: Date.now(),
    quality: "valid",
  });
  return {
    timestampMs: Date.now(),
    speedKph: signal(0),
    direction: signal("neutral"),
    parkingBrake: signal(true),
    steerAngleDeg: signal(0),
    runMode: signal("s"),
    socPercent: signal(80),
    voltageV: signal(51.2),
    currentA: signal(0),
    charging: signal(false),
    motorRpm: signal(0),
    motorTemperatureC: signal(30),
    pressureMpa: signal(0),
    seatSwitch: signal(false),
    seatbelt: signal(false),
    keyOn: signal(true),
    canOnline: true,
    cameraOnline: true,
    odometerKm: signal(0),
    workHours: signal(0),
    controllerOnline: [true, true, true],
    ...overrides,
  };
}

describe("自检模型", () => {
  test("无数据时全部等待，进度 0", () => {
    const statuses = checkStatuses(undefined);
    expect(statuses.length).toBe(6);
    expect(statuses.every((status) => status === "pending")).toBe(true);
    expect(checkProgress(statuses)).toBe(0);
    expect(allPassed(statuses)).toBe(false);
  });

  test("在线项通过，雷达等待（数据源未接入）", () => {
    const statuses = checkStatuses(state());
    expect(statuses.slice(0, 5).every((status) => status === "pass")).toBe(true);
    expect(statuses[5]).toBe("pending");
    expect(checkProgress(statuses)).toBe(83);
    expect(allPassed(statuses)).toBe(false);
  });

  test("控制器离线为失败，转向角无效为失败", () => {
    const offline = checkStatuses(state({ controllerOnline: [false, true, true] }));
    expect(offline[1]).toBe("fail");
    expect(offline[2]).toBe("pass");

    const invalid = checkStatuses(
      state({ steerAngleDeg: { value: 0, timestampMs: 0, quality: "invalid" } }),
    );
    expect(invalid[4]).toBe("fail");
  });

  test("全部通过时完成", () => {
    expect(allPassed(["pass", "pass", "pass", "pass", "pass", "pass"])).toBe(true);
    expect(checkProgress(["pass", "pass", "pass", "pass", "pass", "pass"])).toBe(100);
  });

  test("条目顺序与布局一致（6 项）", () => {
    expect(SELF_CHECK_ITEMS.length).toBe(6);
    expect(SELF_CHECK_ITEMS[0]?.labelKey).toBe("JCLIB_LAN_CAN_COMMUNICATION");
    expect(SELF_CHECK_ITEMS[5]?.labelKey).toBe("JCLIB_LAN_ULTRASONIC_RADAR");
  });
});
