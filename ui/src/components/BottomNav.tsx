// 底部导航：主屏与子屏共用。槽位背景与图标都由本组件绘制。
// 激活页签图标用 _1 版本，其余用 _0；onNavigate 由应用外壳提供路由。

import { For } from "solid-js";
import { Image, View } from "@pocketjs/framework/components";

import { NAV_TABS, type NavTab, type TabId } from "../nav/nav";
import { BAKED } from "../screens/main/assets.gen";
import { SLOT_CLASS } from "../theme/theme";

/** 底部按钮槽位（参考 800×480 布局）。 */
export const BOTTOM_BUTTONS: Record<TabId, { x: number; y: number; w: number; h: number }> = {
  monitor: { x: 0, y: 410, w: 198, h: 69 },
  home: { x: 202, y: 410, w: 198, h: 69 },
  fault: { x: 402, y: 410, w: 198, h: 69 },
  set: { x: 602, y: 410, w: 198, h: 69 },
};

/** 底部导航属性。 */
export interface BottomNavProps {
  /** 当前激活页签。 */
  active: TabId;
  /** 页签点击回调。 */
  onNavigate: (tab: TabId) => void;
  /** 点击提示音回调（可选）。 */
  onPress?: () => void;
}

/** 底部导航栏。 */
export default function BottomNav(props: BottomNavProps) {
  /** 页签图标的槽内居中位置（相对槽位原点）。 */
  const iconStyle = (tab: NavTab): Record<string, number> => {
    const slot = BOTTOM_BUTTONS[tab.id];
    const isActive = props.active === tab.id;
    const baked = isActive ? BAKED[tab.iconActive] : BAKED[tab.icon];
    return {
      translateX: Math.round((slot.w - baked.w) / 2),
      translateY: Math.round((slot.h - baked.h) / 2),
      width: baked.w,
      height: baked.h,
    };
  };

  return (
    <For each={NAV_TABS}>
      {(tab) => {
        const slot = BOTTOM_BUTTONS[tab.id];
        return (
          <View
            class={SLOT_CLASS}
            style={{ translateX: slot.x, translateY: slot.y, width: slot.w, height: slot.h }}
            focusable
            onPress={() => {
              props.onPress?.();
              props.onNavigate(tab.id);
            }}
          >
            <Image
              src={props.active === tab.id ? BAKED[tab.iconActive].src : BAKED[tab.icon].src}
              class="absolute left-0 top-0"
              style={iconStyle(tab)}
            />
          </View>
        );
      }}
    </For>
  );
}
