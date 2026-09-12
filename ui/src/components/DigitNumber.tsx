// 数字贴图渲染：大字号数值（车速 54px、SOC 36px）用逐字贴图拼出。
// 背景：PocketJS 字库按槽位整体烘焙（54px/36px 仅用于数字却带全部中文字形），
// 数字贴图把这两档字库的内存省下来（见 tools/make-number-assets.sh）。

import { For } from "solid-js";
import { Image } from "@pocketjs/framework/components";

import { BAKED, type BakedAsset } from "../screens/main/assets.gen";

/** 数字贴图集合（每种颜色一套）。 */
export type DigitSet = "speed54" | "speed54w" | "speed54c" | "soc36";

/** 特殊字符在素材名中的写法。 */
const CHAR_NAMES: Record<string, string> = { ".": "dot", "%": "pct", "-": "dash" };

/** 字符到素材名；不在集合内返回 null。 */
function assetName(set: DigitSet, char: string): BakedAsset | null {
  const name = CHAR_NAMES[char] ?? char;
  if (!/^[0-9]$/.test(name) && name !== "dot" && name !== "pct" && name !== "dash") return null;
  return `${set}-${name}` as BakedAsset;
}

/** 数字串属性。 */
export interface DigitNumberProps {
  /** 待显示文本（只渲染集合内的字符）。 */
  text: string;
  /** 贴图集合。 */
  set: DigitSet;
  /** 显示区。 */
  x: number;
  y: number;
  w: number;
  h: number;
  /** 水平对齐（贴图组整体）。 */
  align: "left" | "right" | "center";
  /** 字距，默认 2。 */
  gap?: number;
}

/** 数字串组件。 */
export default function DigitNumber(props: DigitNumberProps) {
  /** 逐字布局（整组按对齐方式水平定位，垂直居中）。 */
  const entries = (): Array<{ asset: BakedAsset; x: number; y: number; w: number; h: number }> => {
    const gap = props.gap ?? 2;
    const visible: Array<{ asset: BakedAsset; w: number; h: number }> = [];
    for (const char of props.text) {
      const asset = assetName(props.set, char);
      if (asset === null) continue;
      // 推进用内容宽度（cw）：节点框是补齐后的纹理尺寸，直接推进会带上
      // 右侧透明补齐，字距被撑大。
      visible.push({ asset, w: BAKED[asset].cw, h: BAKED[asset].ch });
    }
    if (visible.length === 0) return [];
    const total = visible.reduce((sum, entry) => sum + entry.w, 0) + gap * (visible.length - 1);
    const startX =
      props.align === "right"
        ? props.x + props.w - total
        : props.align === "center"
          ? props.x + Math.round((props.w - total) / 2)
          : props.x;
    // 按字形底边对齐（基线一致）：'·' 等矮字形与数字底部对齐，而不是各自居中。
    const baseHeight = Math.max(...visible.map((entry) => entry.h));
    const baseTop = props.y + Math.round((props.h - baseHeight) / 2);
    let cursor = startX;
    return visible.map((entry) => {
      const rect = {
        asset: entry.asset,
        x: cursor,
        y: baseTop + (baseHeight - entry.h),
        w: entry.w,
        h: entry.h,
      };
      cursor += entry.w + gap;
      return rect;
    });
  };

  return (
    <For each={entries()}>
      {(entry) => (
        <Image
          src={BAKED[entry.asset].src}
          class="absolute left-0 top-0"
          style={{ translateX: entry.x, translateY: entry.y, width: BAKED[entry.asset].w, height: BAKED[entry.asset].h }}
        />
      )}
    </For>
  );
}
