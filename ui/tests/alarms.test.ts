// 报警引擎测试：与参考 LvglMeter 的门限、节奏与优先级对齐。

import { describe, expect, test } from "bun:test";

import { AlarmEngine, ALARM, type AlarmInputs } from "../src/platform/alarms";
import type { SoundId } from "../src/platform/protocol";

/** 基础输入（无报警）。 */
function inputs(overrides: Partial<AlarmInputs> = {}): AlarmInputs {
  return {
    faultActive: false,
    speedKph: 0,
    direction: "neutral",
    seatbelt: true,
    seatSwitch: true,
    parkingBrake: true,
    ...overrides,
  };
}

/** 按 50ms 推进 n 拍并收集请求。 */
function run(engine: AlarmEngine, values: AlarmInputs, ticks: number): SoundId[] {
  const emitted: SoundId[] = [];
  for (let index = 0; index < ticks; index += 1) {
    engine.tick(50, values, (id) => emitted.push(id));
  }
  return emitted;
}

describe("报警引擎", () => {
  test("超速三档门限：基准 5 × 12/13/15", () => {
    expect(run(new AlarmEngine(), inputs({ speedKph: 60.1 }), 1)).toEqual(["overspeed"]);
    expect(run(new AlarmEngine(), inputs({ speedKph: 65.1 }), 1)).toEqual(["overspeedHigh"]);
    expect(run(new AlarmEngine(), inputs({ speedKph: 75.1 }), 1)).toEqual(["overspeedCritical"]);
    expect(run(new AlarmEngine(), inputs({ speedKph: 59.9 }), 1)).toEqual([]);
  });

  test("故障：首发后每 5 秒重复", () => {
    const engine = new AlarmEngine();
    const active = inputs({ faultActive: true });
    expect(run(engine, active, 1)).toEqual(["fault"]);
    expect(run(engine, active, ALARM.repeatTicks - 1)).toEqual([]);
    expect(run(engine, active, 1)).toEqual(["fault"]);
  });

  test("倒车：逐拍请求（通道忙时丢弃）", () => {
    expect(run(new AlarmEngine(), inputs({ direction: "reverse" }), 3)).toEqual([
      "reverse",
      "reverse",
      "reverse",
    ]);
  });

  test("安全带/离座：手刹松开时报警，两个条件交替且 5 秒一次", () => {
    const engine = new AlarmEngine();
    const both = inputs({ seatbelt: false, seatSwitch: false, parkingBrake: false });
    expect(run(engine, both, 1)).toEqual(["seatbelt"]);
    expect(run(engine, both, ALARM.repeatTicks - 1)).toEqual([]);
    expect(run(engine, both, 1)).toEqual(["seatOff"]);
    // 只有一个条件时固定播对应语音。
    expect(run(new AlarmEngine(), inputs({ seatbelt: false, parkingBrake: false }), 1)).toEqual([
      "seatbelt",
    ]);
    expect(run(new AlarmEngine(), inputs({ seatSwitch: false, parkingBrake: false }), 1)).toEqual([
      "seatOff",
    ]);
    // 手刹拉起不报警。
    expect(run(new AlarmEngine(), inputs({ seatbelt: false, parkingBrake: true }), 1)).toEqual([]);
  });
});
