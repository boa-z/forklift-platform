// 协议层交叉校验：解码 Rust 生成的金样帧，并回编码客户端消息逐字节比对。

import { describe, expect, test } from "bun:test";

import { decodeFrame, encodeClient, PROTOCOL_VERSION, toHex } from "../src/platform/protocol";

interface GoldenFrame {
  name: string;
  hex: string;
}

const golden: GoldenFrame[] = await Bun.file(
  new URL("./golden/protocol.json", import.meta.url),
).json();

/** 按名称取出金样帧。 */
function frame(name: string): Uint8Array {
  const entry = golden.find((item) => item.name === name);
  if (entry === undefined) throw new Error(`缺少金样：${name}`);
  return Uint8Array.from(Buffer.from(entry.hex, "hex"));
}

/** 按名称取出金样十六进制串。 */
function hex(name: string): string {
  const entry = golden.find((item) => item.name === name);
  if (entry === undefined) throw new Error(`缺少金样：${name}`);
  return entry.hex;
}

describe("协议金样（由 Rust protocol crate 生成）", () => {
  test("vehicle_state 解码出约定字段", () => {
    const { message } = decodeFrame(frame("vehicle_state"));
    if (message.type !== "vehicleState") throw new Error(`消息类型错误：${message.type}`);
    expect(message.state.timestampMs).toBe(123_456_789);
    expect(message.state.speedKph.value).toBeCloseTo(12.5, 3);
    expect(message.state.direction.value).toBe("reverse");
    expect(message.state.parkingBrake.value).toBe(true);
    expect(message.state.steerAngleDeg.value).toBeCloseTo(-15, 3);
    expect(message.state.socPercent.value).toBeCloseTo(56, 3);
    expect(message.state.voltageV.value).toBeCloseTo(51.2, 3);
    expect(message.state.canOnline).toBe(true);
    expect(message.state.cameraOnline).toBe(true);
    expect(message.state.controllerOnline).toEqual([false, false, false]);
    expect(message.state.speedKph.quality).toBe("valid");
  });

  test("faults 与 fault_raised 解码一致", () => {
    const snapshot = decodeFrame(frame("faults")).message;
    if (snapshot.type !== "faults") throw new Error("消息类型错误");
    expect(snapshot.snapshot.faults).toHaveLength(1);
    expect(snapshot.snapshot.faults[0]?.id).toBe(0x0001);
    expect(snapshot.snapshot.faults[0]?.severity).toBe("critical");

    const raised = decodeFrame(frame("fault_raised")).message;
    if (raised.type !== "faultRaised") throw new Error("消息类型错误");
    expect(raised.fault.id).toBe(0x0001);
    expect(raised.fault.active).toBe(true);
  });

  test("system 与 connectivity 解码", () => {
    const system = decodeFrame(frame("system")).message;
    if (system.type !== "system") throw new Error("消息类型错误");
    expect(system.state.rssKb).toBe(100);
    expect(system.state.memAvailableKb).toBe(200);
    expect(system.state.health[2]).toBe("degraded");

    const connectivity = decodeFrame(frame("connectivity")).message;
    if (connectivity.type !== "connectivity") throw new Error("消息类型错误");
    expect(connectivity.event.canOnline).toBe(true);
    expect(connectivity.event.cameraOnline).toBe(false);
  });

  test("error 解码出错误码与文本", () => {
    const { message } = decodeFrame(frame("error"));
    if (message.type !== "error") throw new Error("消息类型错误");
    expect(message.code).toBe(7);
    expect(message.message).toBe("bad frame");
  });

  test("客户端消息回编码与金样逐字节一致", () => {
    expect(toHex(encodeClient({ type: "hello", clientVersion: PROTOCOL_VERSION }, 1))).toBe(
      hex("hello"),
    );
    expect(toHex(encodeClient({ type: "ping", nonce: 0x0102_0304 }, 2))).toBe(hex("ping"));
    expect(toHex(encodeClient({ type: "playSound", sound: "button" }, 4))).toBe(
      hex("play_sound"),
    );
    expect(toHex(encodeClient({ type: "setVolume", volume: 70 }, 5))).toBe(hex("set_volume"));
    expect(toHex(encodeClient({ type: "setBrightness", brightness: 80 }, 6))).toBe(
      hex("set_brightness"),
    );
  });
});
