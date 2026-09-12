// 语音/提示音控制器：按平台 SoundId 选择语音文件并在设备上播放。
//
// 单播放器（与参考工程的单语音线程一致）：报警/提示语音播放中忽略新请求
// （ThreadPlayer 返回 -2 的语义），按钮与开机音可打断当前语音。
// 说明：框架播放器的 poll() 是模块级事件队列，两个播放器会互相消费对方的
// credit，因此这里只用一个播放器。
//
// 语言：语音文件带语言后缀（zh 无后缀、en 为 -en），缺失时回退中文文件。
// 宿主没有 audio 模块时全部静默降级。

import { createWavPlayer, type WavPlayer } from "@pocketjs/framework/audio";

import { currentLanguage } from "../i18n";
import type { SoundId } from "./protocol";

/** SoundId 到语音文件名的映射（不含语言后缀）。 */
const VOICE_FILES: Partial<Record<SoundId, string>> = {
  button: "btn",
  startup: "start",
  reverse: "voice-05",
  fault: "voice-04",
  cardSwipe: "voice-01",
  cardOk: "voice-02",
  cardFail: "voice-03",
  overspeed: "voice-08",
  overspeedHigh: "voice-09",
  overspeedCritical: "voice-10",
  seatbelt: "voice-06",
  seatOff: "voice-07",
  obstacleFar: "voice-11",
  obstacleNear: "voice-12",
  obstacleBrake: "voice-13",
  collision: "voice-14",
};

/** 系统提示音（短音，独立通道）。 */
const SYSTEM_SOUNDS: ReadonlySet<SoundId> = new Set(["button", "startup"]);

/** 语言后缀：中文文件无后缀。 */
function languageSuffix(): string {
  const language = currentLanguage();
  return language === "zh" ? "" : `-${language}`;
}

/** 语音控制器。 */
export interface VoiceController {
  /** 播放一个音效（系统音随时触发，报警音播放中丢弃新请求）。 */
  play(id: SoundId): void;
  /** 设置音量（0-100），作用于两个通道。 */
  setVolume(percent: number): void;
  /** 每帧驱动环形缓冲。 */
  pump(): void;
}

/** 构造语音控制器。 */
export function createVoiceController(): VoiceController {
  let player: WavPlayer | undefined;
  try {
    player = createWavPlayer();
  } catch {
    player = undefined;
  }
  let volume = 1;

  /** 按语言后缀装载；缺失时回退无后缀（中文）文件。 */
  const load = (player: WavPlayer, base: string): boolean => {
    const suffix = languageSuffix();
    if (suffix !== "" && player.load(`${base}${suffix}`)) return true;
    return player.load(base);
  };

  return {
    play(id: SoundId): void {
      // 单个语音的资源/格式问题不能中断帧循环（宿主异常会被记为 tick 失败）。
      try {
        const base = VOICE_FILES[id];
        if (base === undefined || player === undefined) return;
        if (SYSTEM_SOUNDS.has(id)) {
          // 按钮/开机音可打断当前语音（有即时反馈）。
          load(player, base);
          player.stop();
          player.setVolume(volume);
          player.play();
          return;
        }
        // 报警/提示语音播放中忽略新请求（参考工程返回 -2 的语义）。
        if (player.playing()) return;
        if (!load(player, base)) return;
        player.setVolume(volume);
        player.play();
      } catch {
        // 素材缺失或宿主不支持时静默降级。
      }
    },
    setVolume(percent: number): void {
      volume = Math.min(100, Math.max(0, Math.round(percent))) / 100;
      player?.setVolume(volume);
    },
    pump(): void {
      player?.pump();
    },
  };
}
