// 设备效果：把平台的音频/亮度命令落到 PocketJS 宿主模块。
//
// - 声音：`@pocketjs/framework/audio` 的 WAV 播放器（pak 里的 audio:wav.btn），
//   pump() 由应用逐帧调用；宿主没有 audio 模块时播放器是静默空操作。
// - 亮度：宿主模块 `globalThis.backlight`（0-100）；未挂载时忽略。
//
// 这是 daemon 后端接通前的设备直连路径；协议与平台 API 不变。

import { createWavPlayer, type WavPlayer } from "@pocketjs/framework/audio";

/** 设备效果接口。 */
export interface DeviceEffects {
  /** 播放按钮提示音（重触发）。 */
  playButton(): void;
  /** 设置音量（0-100）。 */
  setVolume(percent: number): void;
  /** 设置亮度（0-100）。 */
  setBrightness(percent: number): void;
  /** 每帧驱动音频环形缓冲。 */
  pump(): void;
}

/** 钳取 0-100。 */
function clampPercent(percent: number): number {
  return Math.min(100, Math.max(0, Math.round(percent)));
}

/** 构造设备效果；无宿主模块时全部降级为空操作。 */
export function createDeviceEffects(): DeviceEffects {
  let player: WavPlayer | undefined;
  let ready = false;
  try {
    player = createWavPlayer();
    ready = player.load("btn");
  } catch {
    ready = false;
  }
  return {
    playButton(): void {
      if (!ready || player === undefined) return;
      player.stop();
      player.play();
    },
    setVolume(percent: number): void {
      if (!ready || player === undefined) return;
      player.setVolume(clampPercent(percent) / 100);
    },
    setBrightness(percent: number): void {
      const host = (globalThis as { backlight?: { set?: (value: number) => void } }).backlight;
      try {
        host?.set?.(clampPercent(percent));
      } catch {
        // 未挂载背光模块时忽略。
      }
    },
    pump(): void {
      if (!ready || player === undefined) return;
      player.pump();
    },
  };
}
