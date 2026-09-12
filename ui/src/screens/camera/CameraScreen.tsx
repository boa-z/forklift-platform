// 相机屏：按参考 LvglCameraScreen.c 的布局复刻（底部三按钮）。
// 产品无视频链路（VIN/DE 未接入）：内容区显示 NO SIGNAL 离线占位，通道可切换并
// 高亮当前通道；退出回到主屏。参考实现切换的是视频源，本实现不伪造画面。

import { createSignal, For } from "solid-js";
import { Text, View } from "@pocketjs/framework/components";

import { t } from "../../i18n";
import type { TabId } from "../../nav/nav";
import type { Platform } from "../../platform";
import { playButton } from "../../platform/feedback";
import { CLASS, SCREEN_CLASS } from "../../theme/theme";
import { CAMERA } from "./layout";

/** 底部按钮对应的语言键（与 CAMERA.buttons 顺序一致）。 */
const BUTTON_KEYS = ["JCLIB_LAN_CAMERA1", "JCLIB_LAN_CAMERA2", "JCLIB_LAN_EXIT"] as const;

/** 相机屏组件。 */
export default function CameraScreen(props: { platform: Platform; onExit: () => void }) {
  const [channel, setChannel] = createSignal(0);

  /** 通道按钮：0/1 切换通道，2 退出。 */
  const pressButton = (index: number): void => {
    playButton(props.platform);
    if (index === 2) {
      props.onExit();
      return;
    }
    setChannel(index);
  };

  return (
    <View class={SCREEN_CLASS}>
      {/* 离线占位 */}
      <Text class={CLASS.cameraOffline} style={{ translateX: CAMERA.placeholder.x, translateY: CAMERA.placeholder.y, width: CAMERA.placeholder.w, height: CAMERA.placeholder.h }}>
        {CAMERA.offlineText}
      </Text>
      <Text class={CLASS.cameraChannel} style={{ translateX: CAMERA.channelLabel.x, translateY: CAMERA.channelLabel.y, width: CAMERA.channelLabel.w, height: CAMERA.channelLabel.h }}>
        {t(BUTTON_KEYS[channel()] ?? "JCLIB_LAN_CAMERA1")}
      </Text>

      {/* 底部按钮 */}
      <For each={CAMERA.buttons}>
        {(slot, index) => (
          <View
            class="absolute left-0 top-0"
            style={{ translateX: slot.x, translateY: slot.y, width: slot.w, height: slot.h }}
            focusable
            onPress={() => pressButton(index())}
          >
            <Text
              class={index() === 2 || index() === channel() ? CLASS.cameraButtonActive : CLASS.cameraButton}
              style={{ translateX: 0, translateY: 12, width: slot.w, height: 32 }}
            >
              {t(BUTTON_KEYS[index()] ?? "JCLIB_LAN_EXIT")}
            </Text>
          </View>
        )}
      </For>
    </View>
  );
}
