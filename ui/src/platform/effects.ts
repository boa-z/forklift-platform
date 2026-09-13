// 设备效果：把平台的音频/亮度命令落到 PocketJS 宿主模块。
//
// - 声音：`./voice` 的语音控制器（pak 里的 audio:wav.*，宿主 audio 模块播放）；
// - 亮度：宿主模块 `globalThis.backlight`（0-100）；未挂载时忽略。
//
// 这是 daemon 后端接通前的设备直连路径；协议与平台 API 不变。

import type { SoundId } from "./protocol";
import { createVoiceController } from "./voice";

/** 设备效果接口。 */
export interface DeviceEffects {
  /** 播放一个音效/语音。 */
  playSound(id: SoundId): void;
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
  const voice = createVoiceController();
  return {
    playSound(id: SoundId): void {
      voice.play(id);
    },
    setVolume(percent: number): void {
      voice.setVolume(clampPercent(percent));
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
      voice.pump();
    },
  };
}
