// 页签定义：底部导航的四个页签与图标。
// 图标来自 assets.gen.ts 的烘焙清单（_0 未激活 / _1 激活）。

import type { BakedAsset } from "../screens/main/assets.gen";

/** 底部导航页签。 */
export type TabId = "monitor" | "home" | "fault" | "set";

/** 单个页签的展示信息。 */
export interface NavTab {
  /** 页签标识。 */
  id: TabId;
  /** 未激活图标。 */
  icon: BakedAsset;
  /** 激活图标。 */
  iconActive: BakedAsset;
}

/** 页签从左到右的顺序（与底部槽位一致）。 */
export const NAV_TABS: readonly NavTab[] = [
  { id: "monitor", icon: "find_0", iconActive: "find_1" },
  { id: "home", icon: "home_0", iconActive: "home_1" },
  { id: "fault", icon: "error_0", iconActive: "error_1" },
  { id: "set", icon: "set_0", iconActive: "set_1" },
];
