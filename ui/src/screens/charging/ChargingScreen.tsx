// 充电屏：按参考 LvglChargingScreen.c 复刻。
// 条件满足时由应用外壳切入：圆环动画（6 帧采样）+ 90px SOC 数字 + 状态文案；
// SOC 达 100 显示「充电完成」，否则「正在充电」。

import { createMemo, createSignal, For, onCleanup, onMount } from "solid-js";
import { Image, Text, View } from "@pocketjs/framework/components";
import { onFrame } from "@pocketjs/framework/lifecycle";

import { t } from "../../i18n";
import type { Platform, VehicleState } from "../../platform";
import { CLASS, SCREEN_CLASS } from "../../theme/theme";
import { BAKED } from "../main/assets.gen";
import { CHARGING, CHARGING_FRAMES } from "./layout";
import { chargingComplete, chargingSocText } from "./model";

/** 数字贴图素材名。 */
type DigitAsset = "digit-0" | "digit-1" | "digit-2" | "digit-3" | "digit-4" | "digit-5" | "digit-6" | "digit-7" | "digit-8" | "digit-9";

/** 把字符映射到数字贴图；非数字返回 null。 */
function digitAsset(char: string): DigitAsset | null {
  return char >= "0" && char <= "9" ? (`digit-${char}` as DigitAsset) : null;
}

/** 充电屏组件。 */
export default function ChargingScreen(props: { platform: Platform }) {
  const [state, setState] = createSignal<VehicleState | undefined>(undefined);
  const [frame, setFrame] = createSignal(0);

  onMount(() => {
    const unsubscribe = props.platform.vehicle.subscribe(setState);
    onCleanup(unsubscribe);
  });

  // 动画帧按墙上时钟推进（QuickJS 无定时器）。
  onFrame(() => {
    const index = Math.floor(Date.now() / CHARGING.frameMs) % CHARGING_FRAMES.length;
    if (index !== frame()) setFrame(index);
  });

  /** SOC 文本与完成判定（模型在 model.ts，含单测）。 */
  const socText = createMemo<string>(() => chargingSocText(state()?.socPercent));
  const complete = createMemo<boolean>(() => chargingComplete(state()?.socPercent));

  /** 各数字的绘制位置（整串居中）。 */
  const digits = createMemo<Array<{ asset: DigitAsset; x: number; w: number; h: number }>>(() => {
    const visible: Array<{ asset: DigitAsset; w: number; h: number }> = [];
    for (const char of socText()) {
      const asset = digitAsset(char);
      if (asset === null) continue;
      visible.push({ asset, w: BAKED[asset].w, h: BAKED[asset].h });
    }
    if (visible.length === 0) return [];
    const total = visible.reduce((sum, entry) => sum + entry.w, 0) + CHARGING.digitGap * (visible.length - 1);
    let x = CHARGING.soc.x + Math.round((CHARGING.soc.w - total) / 2);
    return visible.map((entry) => {
      const rect = { ...entry, x };
      x += entry.w + CHARGING.digitGap;
      return rect;
    });
  });

  return (
    <View class={SCREEN_CLASS}>
      {/* 圆环动画（裁切内容区贴图） */}
      <Image
        src={BAKED[CHARGING_FRAMES[frame()] ?? "charging-01"].src}
        class="absolute left-0 top-0"
        style={{ translateX: CHARGING.ring.x, translateY: CHARGING.ring.y, width: BAKED[CHARGING_FRAMES[frame()] ?? "charging-01"].w, height: BAKED[CHARGING_FRAMES[frame()] ?? "charging-01"].h }}
      />

      {/* SOC 数字 */}
      <For each={digits()}>
        {(entry) => (
          <Image
            src={BAKED[entry.asset].src}
            class="absolute left-0 top-0"
            style={{ translateX: entry.x, translateY: CHARGING.soc.y + Math.round((CHARGING.soc.h - entry.h) / 2), width: BAKED[entry.asset].w, height: BAKED[entry.asset].h }}
          />
        )}
      </For>

      {/* 状态文字 */}
      <Text class={CLASS.chargingStatus} style={{ translateX: CHARGING.status.x, translateY: CHARGING.status.y, width: CHARGING.status.w, height: CHARGING.status.h }}>
        {complete() ? t("JCLIB_LAN_CHARGE_COMPLETE") : t("JCLIB_LAN_CHARGING")}
      </Text>
    </View>
  );
}
