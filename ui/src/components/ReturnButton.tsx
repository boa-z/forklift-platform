// 子屏返回按钮：参考布局统一位于 (38,20)，55×55 槽，素材居中。
// 点击回到主屏，由 onPress 回调处理。

import { Image, View } from "@pocketjs/framework/components";

import { BAKED } from "../screens/main/assets.gen";

/** 返回按钮槽位。 */
export const RETURN_BUTTON = { x: 38, y: 20, w: 55, h: 55 } as const;

/** 返回按钮组件。 */
export default function ReturnButton(props: { onPress: () => void }) {
  const baked = BAKED["return"];
  return (
    <View
      class="absolute left-0 top-0"
      style={{ translateX: RETURN_BUTTON.x, translateY: RETURN_BUTTON.y, width: RETURN_BUTTON.w, height: RETURN_BUTTON.h }}
      focusable
      onPress={props.onPress}
    >
      <Image
        src={baked.src}
        class="absolute left-0 top-0"
        style={{
          translateX: Math.round((RETURN_BUTTON.w - baked.w) / 2),
          translateY: Math.round((RETURN_BUTTON.h - baked.h) / 2),
          width: baked.w,
          height: baked.h,
        }}
      />
    </View>
  );
}
