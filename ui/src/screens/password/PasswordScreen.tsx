// 密码屏：按参考 LvglPasswordScreen.c 复刻。
// 12 键键盘（1-9、退格、0、确认），输入以 `*` 掩码显示；
// 确认时由调用方校验（返回 false 清空重输），取消返回上一屏。

import { createSignal, For } from "solid-js";
import { Image, Text, View } from "@pocketjs/framework/components";

import ReturnButton from "../../components/ReturnButton";
import { t } from "../../i18n";
import type { Platform } from "../../platform";
import { playButton } from "../../platform/feedback";
import { CLASS, SCREEN_CLASS } from "../../theme/theme";
import { BAKED } from "../main/assets.gen";
import { PASSWORD, PASSWORD_KEY_COUNT, keyAction, keyPosition } from "./layout";

/** 密码屏属性。 */
export interface PasswordScreenProps {
  platform: Platform;
  /** 确认回调：返回 true 由调用方关闭，false 清空重输。 */
  onSubmit: (value: string) => boolean;
  /** 取消回调。 */
  onCancel: () => void;
}

/** 密码屏组件。 */
export default function PasswordScreen(props: PasswordScreenProps) {
  const [value, setValue] = createSignal("");

  /** 按键动作。 */
  const pressKey = (index: number): void => {
    playButton(props.platform);
    const action = keyAction(index);
    if (action === "backspace") {
      setValue(value().slice(0, -1));
      return;
    }
    if (action === "confirm") {
      if (!props.onSubmit(value())) setValue("");
      return;
    }
    if (value().length < PASSWORD.maxLength) setValue(value() + action);
  };

  return (
    <View class={SCREEN_CLASS}>
      <ReturnButton
        onPress={() => {
          playButton(props.platform);
          props.onCancel();
        }}
      />

      {/* 输入框（掩码显示） */}
      <View class="absolute left-0 top-0" style={{ translateX: PASSWORD.textArea.x, translateY: PASSWORD.textArea.y, width: PASSWORD.textArea.w, height: PASSWORD.textArea.h }}>
        <Image src={BAKED.passwordtext_bg.src} class="absolute left-0 top-0" style={{ translateX: 0, translateY: 0, width: BAKED.passwordtext_bg.w, height: BAKED.passwordtext_bg.h }} />
        <Text class={CLASS.passwordText} style={{ translateX: PASSWORD.textInset, translateY: 12, width: PASSWORD.textArea.w - PASSWORD.textInset * 2, height: 32 }}>
          {value().replace(/./g, "*")}
        </Text>
      </View>

      {/* 键盘 */}
      <For each={Array.from({ length: PASSWORD_KEY_COUNT }, (_, index) => index)}>
        {(index) => {
          const position = keyPosition(index);
          const action = keyAction(index);
          return (
            <View
              class="absolute left-0 top-0"
              style={{ translateX: position.x, translateY: position.y, width: PASSWORD.key.w, height: PASSWORD.key.h }}
              focusable
              onPress={() => pressKey(index)}
            >
              <Image src={BAKED.password_PRESSED.src} class="absolute left-0 top-0" style={{ translateX: 0, translateY: 0, width: BAKED.password_PRESSED.w, height: BAKED.password_PRESSED.h }} />
              {action === "backspace" ? (
                <Image
                  src={BAKED["007_key_backspace"].src}
                  class="absolute left-0 top-0"
                  style={{
                    translateX: Math.round((PASSWORD.key.w - BAKED["007_key_backspace"].cw) / 2),
                    translateY: Math.round((PASSWORD.key.h - BAKED["007_key_backspace"].ch) / 2),
                    width: BAKED["007_key_backspace"].w,
                    height: BAKED["007_key_backspace"].h,
                  }}
                />
              ) : (
                <Text class={CLASS.passwordKey} style={{ translateX: 0, translateY: 14, width: PASSWORD.key.w, height: 32 }}>
                  {action === "confirm" ? t("JCLIB_LAN_CONFIRM") : action}
                </Text>
              )}
            </View>
          );
        }}
      </For>
    </View>
  );
}
