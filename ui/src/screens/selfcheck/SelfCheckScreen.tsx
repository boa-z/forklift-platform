// 自检屏：按参考 LvglSelfCheckScreen.c 复刻。
// 6 项接入检查实时更新状态与进度；全部通过自动进入，超时（3s）显示完成、
// 由“进入系统”按钮手动进入。无数据源的项保持等待（见 model.ts）。

import { createMemo, createSignal, For, onCleanup, onMount } from "solid-js";
import { Image, Text, View } from "@pocketjs/framework/components";
import { onFrame } from "@pocketjs/framework/lifecycle";

import { t } from "../../i18n";
import type { Platform, VehicleState } from "../../platform";
import { playButton } from "../../platform/feedback";
import { CLASS, SCREEN_CLASS } from "../../theme/theme";
import { BAKED, type BakedAsset } from "../main/assets.gen";
import { SELF_CHECK } from "./layout";
import { SELF_CHECK_ITEMS, allPassed, checkProgress, checkStatuses, type CheckStatus } from "./model";

/** 自检屏组件。 */
export default function SelfCheckScreen(props: { platform: Platform; onEnter: () => void }) {
  const [state, setState] = createSignal<VehicleState | undefined>(undefined);
  const [finished, setFinished] = createSignal(false);
  let startedAt = Date.now();
  let entered = false;

  onMount(() => {
    startedAt = Date.now();
    const unsubscribe = props.platform.vehicle.subscribe(setState);
    onCleanup(unsubscribe);
  });

  /** 状态、进度与完成判定（逐帧驱动，QuickJS 无定时器）。 */
  const statuses = createMemo<CheckStatus[]>(() => checkStatuses(state()));
  const progress = createMemo<number>(() => checkProgress(statuses()));

  /** 进入主屏（去重）。 */
  const enter = (): void => {
    if (entered) return;
    entered = true;
    playButton(props.platform);
    props.onEnter();
  };

  onFrame(() => {
    if (finished()) return;
    // 全部通过自动进入；否则超时后显示完成、等用户点击。
    if (allPassed(statuses())) {
      setFinished(true);
      enter();
      return;
    }
    if (Date.now() - startedAt >= SELF_CHECK.timeoutMs) setFinished(true);
  });

  /** 单项状态图标（等待数据时不显示）。 */
  const statusAsset = (status: CheckStatus): BakedAsset | null => {
    if (status === "pass") return "002yesPass";
    if (status === "fail") return "003noPass";
    return null;
  };

  return (
    <View class={SCREEN_CLASS}>
      <Text class={CLASS.screenTitle} style={{ translateX: SELF_CHECK.title.x, translateY: SELF_CHECK.title.y, width: SELF_CHECK.title.w, height: SELF_CHECK.title.h }}>
        {t("JCLIB_LAN_SYSTEM_SELF_CHECK")}
      </Text>

      {/* 进度 */}
      <Text class={CLASS.progressLabel} style={{ translateX: SELF_CHECK.progressLabel.x, translateY: SELF_CHECK.progressLabel.y, width: SELF_CHECK.progressLabel.w, height: SELF_CHECK.progressLabel.h }}>
        {finished() ? t("JCLIB_LAN_SELF_CHECK_OK") : t("JCLIB_LAN_CHECKING_WAIT")}
      </Text>
      <View class="absolute left-0 top-0 rounded-[4] bg-[#595757]" style={{ translateX: SELF_CHECK.progressBar.x, translateY: SELF_CHECK.progressBar.y, width: SELF_CHECK.progressBar.w, height: SELF_CHECK.progressBar.h }} />
      <View class="absolute left-0 top-0 rounded-[4] bg-[#00a552]" style={{ translateX: SELF_CHECK.progressBar.x, translateY: SELF_CHECK.progressBar.y, width: Math.round((SELF_CHECK.progressBar.w * progress()) / 100), height: SELF_CHECK.progressBar.h }} />

      {/* 检查项 */}
      <For each={SELF_CHECK_ITEMS}>
        {(item, index) => {
          const position = SELF_CHECK.itemPositions[index()] ?? SELF_CHECK.itemPositions[0];
          const status = (): CheckStatus => statuses()[index()] ?? "pending";
          return (
            <View class="absolute left-0 top-0" style={{ translateX: position.x, translateY: position.y, width: SELF_CHECK.item.w, height: SELF_CHECK.item.h }}>
              <Image src={BAKED["001GreyBoxBg"].src} class="absolute left-0 top-0" style={{ translateX: 0, translateY: 0, width: BAKED["001GreyBoxBg"].w, height: BAKED["001GreyBoxBg"].h }} />
              <Text class={CLASS.rowText} style={{ translateX: SELF_CHECK.item.labelX, translateY: SELF_CHECK.item.labelY, width: SELF_CHECK.item.w - 100, height: SELF_CHECK.item.h - SELF_CHECK.item.labelY }}>
                {t(item.labelKey)}
              </Text>
              {statusAsset(status()) !== null && (
                <Image src={BAKED[statusAsset(status()) ?? "002yesPass"].src} class="absolute left-0 top-0" style={{ translateX: SELF_CHECK.item.statusX, translateY: SELF_CHECK.item.statusY, width: BAKED["002yesPass"].w, height: BAKED["002yesPass"].h }} />
              )}
            </View>
          );
        }}
      </For>

      {/* 进入系统 */}
      <View class="absolute left-0 top-0" style={{ translateX: SELF_CHECK.enterButton.x, translateY: SELF_CHECK.enterButton.y, width: SELF_CHECK.enterButton.w, height: SELF_CHECK.enterButton.h }} focusable onPress={enter}>
        <Image src={BAKED["004GreenBoxBg"].src} class="absolute left-0 top-0" style={{ translateX: 0, translateY: 0, width: BAKED["004GreenBoxBg"].w, height: BAKED["004GreenBoxBg"].h }} />
        <Text class={CLASS.enterButtonText} style={centeredText()}>
          {t("JCLIB_LAN_ENTER_SYSTEM")}
        </Text>
      </View>
    </View>
  );
}

/** 进入按钮文本的槽内位置。 */
function centeredText(): Record<string, number> {
  return { translateX: 0, translateY: 16, width: SELF_CHECK.enterButton.w, height: 32 };
}
