// 按钮反馈音：平台未连接时按下按钮不应中断界面动作。
// PocketJS 宿主把回调异常记为 tick 失败，因此这里吞掉未连接错误。

import type { Platform } from "./index";

/** 播放按钮音；未连接时忽略。 */
export function playButton(platform: Platform): void {
  try {
    platform.audio.play("button");
  } catch {
    // 连接建立前的按下静默；握手完成后按钮音恢复。
  }
}
