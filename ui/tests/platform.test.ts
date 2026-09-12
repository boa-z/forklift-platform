// 平台 API 单元测试：MockTransport 下的握手、状态、命令与 PING。

import { describe, expect, test } from "bun:test";

import { createPlatform, MockTransport, type VehicleState } from "../src/platform";

/** 轮询等待条件成立。 */
async function waitFor<T>(probe: () => T | undefined, timeoutMs = 2_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = probe();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error("等待超时");
    await Bun.sleep(10);
  }
}

describe("平台 API（MockTransport）", () => {
  test("连接后收到车辆状态，命令与 PING 正常", async () => {
    const platform = createPlatform(new MockTransport());
    await platform.connect();

    const state = await waitFor<VehicleState>(() => platform.vehicle.snapshot());
    expect(state.speedKph.value).toBeGreaterThan(12);
    expect(state.direction.value).toBe("reverse");
    expect(state.socPercent.value).toBeCloseTo(56, 3);
    expect(state.canOnline).toBe(true);

    const updates: VehicleState[] = [];
    const unsubscribe = platform.vehicle.subscribe((next) => updates.push(next));
    await Bun.sleep(120);
    expect(updates.length).toBeGreaterThan(0);
    unsubscribe();

    expect(await platform.ping(0x1122_3344)).toBe(0x1122_3344);

    platform.audio.play("button");
    platform.audio.setVolume(50);
    platform.system.setBrightness(80);
    await Bun.sleep(10);

    platform.close();
  });
});
