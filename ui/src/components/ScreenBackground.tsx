// 屏幕背景：原始背景图中只有底部导航条带包含有效像素（返回按钮区域的原生
// 图形与 return.png 重叠出现重影，参考界面实际绘制的是按钮贴图）。
// 其余像素为基色 #080304（屏幕底色）。条带按 512 列切两片，像素与原始一致；
// pak 单张纹理上限 512，条带 70 高补到 128。

import { Image } from "@pocketjs/framework/components";

import { BAKED } from "../screens/main/assets.gen";

/** 可用的背景条带（右片固定放在 x=512，条带 y=410）。 */
export const BACKGROUNDS = {
  main: { left: "main_nav", right: "main_nav_r" },
  fault: { left: "fault_nav", right: "fault_nav_r" },
  menu: { left: "menu_nav", right: "menu_nav_r" },
} as const;

/** 背景标识。 */
export type BackgroundId = keyof typeof BACKGROUNDS;

/** 背景条带。 */
export default function ScreenBackground(props: { id: BackgroundId }) {
  const tiles = BACKGROUNDS[props.id];
  const left = BAKED[tiles.left];
  const right = BAKED[tiles.right];
  return (
    <>
      <Image
        src={left.src}
        class="absolute left-0 top-0"
        style={{ translateX: 0, translateY: 410, width: left.w, height: left.h }}
      />
      <Image
        src={right.src}
        class="absolute left-0 top-0"
        style={{ translateX: 512, translateY: 410, width: right.w, height: right.h }}
      />
    </>
  );
}
