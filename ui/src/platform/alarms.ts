// 报警引擎：按参考工程 LvglMeter 的报警处理逻辑生成语音请求。
//
// 与参考一致的规则（50ms 一拍）：
// - 超速：速度 > 基准 × 12/13/15 分别请求 v8/v9/v10（每拍都请求，播放中由
//   语音通道丢弃；参考默认基准 5 km/h，即 60/65/75）；
// - 倒车：方向为倒车时请求 v5（参考在雷达处理里播「倒车请注意」）；
// - 故障：有活动故障时每 5 秒请求一次 v4；
// - 安全带 / 离座：手刹松开且未系安全带 → v6，手刹松开且离座 → v7，
//   两个条件同时存在时按类型交替，间隔 5 秒。
//
// 请求顺序即优先级：超速 → 倒车 → 故障 → 安全带/离座（与参考定时器调用顺序
// 一致），语音通道忙时后面的请求被丢弃。

import type { SoundId } from "./protocol";

/** 报警输入（无效信号传 undefined）。 */
export interface AlarmInputs {
  /** 是否存在活动故障。 */
  faultActive: boolean;
  /** 车速（km/h）。 */
  speedKph: number | undefined;
  /** 行驶方向。 */
  direction: "neutral" | "forward" | "reverse" | undefined;
  /** 安全带开关（true = 已系）。 */
  seatbelt: boolean | undefined;
  /** 座椅开关（true = 有人）。 */
  seatSwitch: boolean | undefined;
  /** 手刹（true = 拉起）。 */
  parkingBrake: boolean | undefined;
}

/** 报警参数（与参考一致）。 */
export const ALARM = {
  /** 超速基准（km/h）：参考设置为 5 + 档位选择，默认 5。 */
  overspeedBaseKph: 5,
  /** 超速三档倍率。 */
  overspeedLevels: [12, 13, 15] as const,
  /** 重复播报间隔（拍数，50ms/拍 → 100 拍 = 5 秒）。 */
  repeatTicks: 100,
  /** 安全带报警开关（设置项未实现，默认启用，与参考默认开启一致）。 */
  seatbeltSwitchEnabled: true,
} as const;

/** 报警引擎。 */
export class AlarmEngine {
  private tickMs = 0;
  private faultCounter = 0;
  private seatCounter = 0;
  /** 交替类型：0 = 安全带优先，1 = 离座优先。 */
  private seatType = 0;

  /** 推进一拍（50ms）并发出语音请求。 */
  private step(inputs: AlarmInputs, emit: (id: SoundId) => void): void {
    // 1) 超速（三档，逐拍请求，播放中由通道丢弃）。
    if (inputs.speedKph !== undefined) {
      const base = ALARM.overspeedBaseKph;
      if (inputs.speedKph > base * ALARM.overspeedLevels[2]) emit("overspeedCritical");
      else if (inputs.speedKph > base * ALARM.overspeedLevels[1]) emit("overspeedHigh");
      else if (inputs.speedKph > base * ALARM.overspeedLevels[0]) emit("overspeed");
    }

    // 2) 倒车提示（雷达数据未接入：无探头时参考播 v5，本实现按倒车档播）。
    if (inputs.direction === "reverse") emit("reverse");

    // 3) 故障：5 秒一次（先减后判，间隔精确等于 repeatTicks 拍）。
    if (inputs.faultActive) {
      this.faultCounter -= 1;
      if (this.faultCounter <= 0) {
        emit("fault");
        this.faultCounter = ALARM.repeatTicks;
      }
    } else {
      this.faultCounter = 0;
    }

    // 4) 安全带 / 离座：手刹松开时才报警；两个条件交替，5 秒一次。
    const handbrakeOff = inputs.parkingBrake !== undefined && inputs.parkingBrake === false;
    const seatbeltActive =
      ALARM.seatbeltSwitchEnabled && handbrakeOff && inputs.seatbelt !== undefined && inputs.seatbelt === false;
    const seatOffActive = handbrakeOff && inputs.seatSwitch !== undefined && inputs.seatSwitch === false;
    if (!seatbeltActive && !seatOffActive) {
      this.seatCounter = 0;
    } else {
      this.seatCounter -= 1;
      if (this.seatCounter <= 0) {
        const preferSeatbelt = this.seatType === 0;
        if (seatbeltActive && (preferSeatbelt || !seatOffActive)) emit("seatbelt");
        else if (seatOffActive) emit("seatOff");
        this.seatType = this.seatType === 0 ? 1 : 0;
        this.seatCounter = ALARM.repeatTicks;
      }
    }
  }

  /** 按经过时间推进（帧率无关，内部按 50ms 补拍）。 */
  tick(deltaMs: number, inputs: AlarmInputs, emit: (id: SoundId) => void): void {
    this.tickMs += deltaMs;
    while (this.tickMs >= 50) {
      this.tickMs -= 50;
      this.step(inputs, emit);
    }
  }
}
