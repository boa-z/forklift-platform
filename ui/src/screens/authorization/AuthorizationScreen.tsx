// 授权屏：开机刷卡/密码授权入口（参考 LvglAuthorizationScreen.c）。
// 自检之后默认进入；授权成功上报开机方式并进入主界面。
// 双重认证由 daemon 判定（authState.authorized=false + 刷卡 status=1），
// 本屏弹出尾号键盘并把输入交给 daemon 校验。

import { createSignal, onCleanup, onMount, Show } from "solid-js";
import { Image, Text, View } from "@pocketjs/framework/components";

import ScreenBackground from "../../components/ScreenBackground";
import PasswordScreen from "../password/PasswordScreen";
import { t, type LanKey } from "../../i18n";
import type { Platform } from "../../platform";
import { playButton } from "../../platform/feedback";
import { getPasswordBootEnabled } from "../../settings";
import { CLASS, SCREEN_CLASS, TITLE_CLASS } from "../../theme/theme";
import { BAKED } from "../main/assets.gen";
import { AUTH } from "./layout";
import { phaseForSwipe, powerOnKindForCard, swipeStatusKey, type AuthPhase } from "./model";

/** 授权屏属性。 */
export interface AuthorizationScreenProps {
  platform: Platform;
  /** 授权通过后的回调（切主界面）。 */
  onAuthorized: () => void;
}

/** 授权屏组件。 */
export default function AuthorizationScreen(props: AuthorizationScreenProps) {
  const [phase, setPhase] = createSignal<AuthPhase>("waiting");
  const [messageKey, setMessageKey] = createSignal<LanKey | null>(null);
  const [tailInput, setTailInput] = createSignal(false);
  const [passwordInput, setPasswordInput] = createSignal(false);
  let lastCard = "";

  /** 进入成功流程：上报开机方式并切主界面。 */
  const succeed = (kind: number, card: string): void => {
    setPhase("success");
    setMessageKey("JCLIB_LAN_AUTH_SUCCESS");
    try {
      props.platform.auth.reportPowerOn(kind, card);
    } catch {
      // 连接未建立前忽略。
    }
    props.onAuthorized();
  };

  onMount(() => {
    const unsubscribeSwipe = props.platform.auth.onSwipe((report) => {
      lastCard = report.card;
      const authorized = props.platform.auth.snapshot().authorized;
      const next = phaseForSwipe(report.status, authorized);
      if (next === "licenseTail") {
        props.platform.audio.play("cardSwipe");
        setPhase("licenseTail");
        setMessageKey("JCLIB_LAN_ENTER_PASSWORD");
        setTailInput(true);
        return;
      }
      if (next === "success") {
        props.platform.audio.play("cardOk");
        try {
          props.platform.auth.swipeReply(0);
        } catch {
          // 忽略未连接。
        }
        succeed(powerOnKindForCard(report.card), report.card);
        return;
      }
      props.platform.audio.play("cardFail");
      try {
        props.platform.auth.swipeReply(1);
      } catch {
        // 忽略未连接。
      }
      setPhase("failed");
      setMessageKey(swipeStatusKey(report.status));
    });
    const unsubscribeAuth = props.platform.auth.subscribe((state) => {
      if (state.authorized && phase() === "licenseTail") {
        succeed(1, lastCard);
      }
    });
    onCleanup(() => {
      unsubscribeSwipe();
      unsubscribeAuth();
    });
  });

  /** 双重认证尾号提交：交给 daemon 校验，成功由 authState 事件触发。 */
  const submitTail = (digits: string): boolean => {
    setTailInput(false);
    try {
      props.platform.auth.enterLicenseTail(digits);
    } catch {
      // 忽略未连接。
    }
    return true;
  };

  /** 密码开机提交：管理员/超级管理员密码通过则上报密码开机。 */
  const submitPassword = async (value: string): Promise<boolean> => {
    if (value.length === 0) return false;
    try {
      const level = await props.platform.auth.verifyPassword(value);
      if (level < 1) return false;
    } catch {
      return false;
    }
    setPasswordInput(false);
    succeed(0, "");
    return true;
  };

  return (
    <Show
      when={!tailInput() && !passwordInput()}
      fallback={
        <PasswordScreen
          platform={props.platform}
          prompt={t(tailInput() ? "JCLIB_LAN_ENTER_PASSWORD" : "JCLIB_LAN_ENTER_ADMIN_PASSWORD")}
          onSubmit={tailInput() ? submitTail : submitPassword}
          onCancel={() => {
            setTailInput(false);
            setPasswordInput(false);
            setPhase("waiting");
            setMessageKey(null);
          }}
        />
      }
    >
      <View class={SCREEN_CLASS}>
        <ScreenBackground id="main" />

        <Text class={TITLE_CLASS} style={{ translateX: AUTH.title.x, translateY: AUTH.title.y, width: AUTH.title.w, height: AUTH.title.h }}>
          {t(getPasswordBootEnabled() ? "JCLIB_LAN_PLZ_CARD_OR_PASSWORD" : "JCLIB_LAN_SWIPE_CARD")}
        </Text>

        <Show when={messageKey() !== null}>
          <Text
            class={phase() === "failed" ? CLASS.dialogLabelDisabled : CLASS.rowText}
            style={{ translateX: AUTH.message.x, translateY: AUTH.message.y, width: AUTH.message.w, height: AUTH.message.h }}
          >
            {t(messageKey() ?? "JCLIB_LAN_CHECKING_WAIT")}
          </Text>
        </Show>

        <Show when={getPasswordBootEnabled()}>
          <View
            class="absolute left-0 top-0"
            style={{ translateX: AUTH.passwordButton.x, translateY: AUTH.passwordButton.y, width: AUTH.passwordButton.w, height: AUTH.passwordButton.h }}
            focusable
            onPress={() => {
              playButton(props.platform);
              setPasswordInput(true);
            }}
          >
            <Image
              src={BAKED["004GreenBoxBg"].src}
              class="absolute left-0 top-0"
              style={{ translateX: 0, translateY: 0, width: BAKED["004GreenBoxBg"].w, height: BAKED["004GreenBoxBg"].h }}
            />
            <Text class={CLASS.enterButtonText} style={{ translateX: 0, translateY: 16, width: AUTH.passwordButton.w, height: 32 }}>
              {t("JCLIB_LAN_ENTER_PASSWORD")}
            </Text>
          </View>
        </Show>
      </View>
    </Show>
  );
}
