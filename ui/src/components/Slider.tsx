// 滑条：参考 setmenu 的轨道/填充/旋钮贴图（441×33 轨道，20×48 旋钮）。
// 支持点按与横向拖动（PocketJS 手势），移动中实时更新，松手提交。

import { createMemo, createSignal } from "solid-js";
import { Image } from "@pocketjs/framework/components";
import { createGesture } from "@pocketjs/framework/gesture";

import { BAKED } from "../screens/main/assets.gen";
import { fillSlices, sliderValueAt } from "./slices";

/** 滑条属性。 */
export interface SliderProps {
  /** 渲染槽位左上角（相对父容器）。 */
  x: number;
  y: number;
  /** 手势区域左上角（屏幕绝对坐标；渲染在内容区时与 x/y 不同）。 */
  regionX: number;
  regionY: number;
  /** 轨道宽度（参考 441）。 */
  width: number;
  /** 初始值 0-100。 */
  value: number;
  /** 拖动中的实时值。 */
  onInput: (value: number) => void;
  /** 松手后的提交值。 */
  onCommit: (value: number) => void;
}

/** 旋钮内容宽度与轨道内容高度。 */
const KNOB_WIDTH = 20;
const TRACK_HEIGHT = 33;

/** 切片宽度到素材名的映射。 */
function sliceAsset(size: number): "slider_green_slice16" | "slider_green_slice8" | "slider_green_slice4" | "slider_green_slice2" | "slider_green_slice1" {
  switch (size) {
    case 16:
      return "slider_green_slice16";
    case 8:
      return "slider_green_slice8";
    case 4:
      return "slider_green_slice4";
    case 2:
      return "slider_green_slice2";
    default:
      return "slider_green_slice1";
  }
}

/** 滑条组件。 */
export default function Slider(props: SliderProps) {
  const [value, setValue] = createSignal(props.value);
  let dragging = false;

  /** 填充宽度：指示器到旋钮中心（与 LVGL indicator 一致）。 */
  const fillWidth = createMemo<number>(() =>
    Math.max(0, Math.round((props.width * value()) / 100 - KNOB_WIDTH / 2)),
  );

  /** 旋钮位置。 */
  const knobX = (): number => Math.round((props.width * value()) / 100) - Math.round(KNOB_WIDTH / 2);

  /** 指针位置更新数值（按绝对坐标换算）。 */
  const update = (pointerX: number): void => {
    setValue(sliderValueAt(pointerX, props.regionX, props.width));
    props.onInput(value());
  };

  // 手势区域覆盖轨道与旋钮高度；x 轴锁定（区域用绝对坐标）。
  createGesture({
    region: { rect: () => ({ x: props.regionX, y: props.regionY - 8, w: props.width, h: 48 }) },
    axis: "x",
    onDown: (contact) => {
      dragging = true;
      update(contact.x);
    },
    onMove: (contact) => {
      if (dragging) update(contact.x);
    },
    onPanMove: (contact) => update(contact.x),
    onUp: () => {
      dragging = false;
      props.onCommit(value());
    },
    onTap: (contact) => {
      update(contact.x);
      props.onCommit(value());
    },
  });

  return (
    <>
      {/* 轨道 */}
      <Image
        src={BAKED.bargray_441x33.src}
        class="absolute left-0 top-0"
        style={{ translateX: props.x, translateY: props.y, width: BAKED.bargray_441x33.w, height: BAKED.bargray_441x33.h }}
      />
      {/* 绿色填充（精确切片平铺） */}
      {fillSlices(fillWidth()).map((slice) => (
        <Image
          src={BAKED[sliceAsset(slice.size)].src}
          class="absolute left-0 top-0"
          style={{
            translateX: props.x + slice.x,
            translateY: props.y,
            width: BAKED[sliceAsset(slice.size)].w,
            height: BAKED[sliceAsset(slice.size)].h,
          }}
        />
      ))}
      {/* 旋钮 */}
      <Image
        src={BAKED.sliding_block_20x48.src}
        class="absolute left-0 top-0"
        style={{
          translateX: props.x + knobX(),
          translateY: props.y - Math.round((48 - TRACK_HEIGHT) / 2),
          width: BAKED.sliding_block_20x48.w,
          height: BAKED.sliding_block_20x48.h,
        }}
      />
    </>
  );
}
