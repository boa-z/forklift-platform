// 屏幕背景：原始背景图中只有底部导航条有像素，四格复用同一张格子贴图
// （每屏一格 202×68，含右侧间隙；main 的 set 格与 fault 格单独烘焙）。
// 其余像素为基色 #080304（屏幕底色）。

import { For } from "solid-js";
import { Image } from "@pocketjs/framework/components";

import { BAKED, type BakedAsset } from "../screens/main/assets.gen";

/** 底部四格的位置。 */
const SLOT_X = [0, 202, 402, 602] as const;

/** 每屏使用的格子贴图（main 的 set 格不同）。 */
export const BACKGROUNDS = {
  main: "nav_cell_main",
  fault: "nav_cell_fault",
  menu: "nav_cell_menu",
} as const;

/** 背景标识。 */
export type BackgroundId = keyof typeof BACKGROUNDS;

/** 指定槽位的格子贴图。 */
function cellAsset(id: BackgroundId, slot: number): BakedAsset {
  if (id === "main" && slot === 602) return "nav_cell_main_set";
  return BACKGROUNDS[id];
}

/** 背景条（四个格子）。 */
export default function ScreenBackground(props: { id: BackgroundId }) {
  return (
    <For each={SLOT_X}>
      {(slot) => (
        <Image
          src={BAKED[cellAsset(props.id, slot)].src}
          class="absolute left-0 top-0"
          style={{
            translateX: slot,
            translateY: 410,
            width: BAKED[cellAsset(props.id, slot)].w,
            height: BAKED[cellAsset(props.id, slot)].h,
          }}
        />
      )}
    </For>
  );
}
