// 设置屏布局与菜单数据：对应参考 LvglSetScreen.c 的三级菜单。
// 菜单项用 JCLIB_LAN_* 语言键（取自 data.bin 生成的 keys.gen.ts），
// 文案在渲染时经 i18n 解析。子对话框未实现。

import type { LanKey } from "../../i18n";

/** 设置屏布局。 */
export const SET = {
  /** 返回主屏按钮（与监控屏共用 ReturnButton 坐标）。 */
  returnButton: { x: 38, y: 20, w: 55, h: 55 },
  /** 标题。 */
  title: { x: 270, y: 70, w: 400, h: 32 },
  /** 上一页按钮。 */
  pageLeft: { x: 580, y: 70, w: 74, h: 24 },
  /** 页码标签。 */
  pageLabel: { x: 652, y: 70, w: 74, h: 24 },
  /** 下一页按钮。 */
  pageRight: { x: 726, y: 70, w: 74, h: 24 },
  /** 左列菜单项。 */
  menuItem: { x: 28, w: 183, h: 65 },
  /** 内容区。 */
  content: { x: 275, y: 124, w: 520, h: 270 },
  /** 内容行（相对内容区）；参考按钮槽 65 高，行背景图 50 高居中。 */
  row: { x: 0, w: 473, h: 65, bgH: 50, insetY: 7, stepY: 60 },
  /** 行内文本 x 偏移。 */
  rowTextX: 25,
} as const;

/** 一个设置菜单（左列入口）及其分页。 */
export interface SetMenu {
  /** 菜单标题语言键。 */
  titleKey: LanKey;
  /** 左列按钮的 y 坐标。 */
  y: number;
  /** 每页 4 个条目，条目为参考工程的菜单语言键。 */
  pages: readonly (readonly LanKey[])[];
}

/** 三个设置菜单（顺序与参考一致）。 */
export const SET_MENUS: readonly SetMenu[] = [
  {
    titleKey: "JCLIB_LAN_USER_SETTINGS",
    y: 86,
    pages: [
      ["JCLIB_LAN_LANGUAGE_SELECT", "JCLIB_LAN_BRIGHTNESS_ADJUST", "JCLIB_LAN_ADAPTIVE_BRIGHTNESS", "JCLIB_LAN_VOLUME_ADJUST"],
      ["JCLIB_LAN_TIME_SETTINGS", "JCLIB_LAN_BOOT_LOGO_SELECT", "JCLIB_LAN_REVERSE_TRIGGER", "JCLIB_LAN_HAPTIC_FEEDBACK"],
      ["JCLIB_LAN_ULTRASONIC_ALARM_SELECT", "JCLIB_LAN_OVERSPEED_ALARM_SET", "JCLIB_LAN_ANTI_MISOPERATION_ENABLED", "JCLIB_LAN_AFTER_SALES_SERVICE"],
    ],
  },
  {
    titleKey: "JCLIB_LAN_LOCAL_SETTINGS",
    y: 161,
    pages: [
      ["JCLIB_LAN_SIM_CARD_INFO", "JCLIB_LAN_TRACTION_SW_VERSION", "JCLIB_LAN_PUMP_SW_VERSION", "JCLIB_LAN_STEERING_SW_VERSION"],
      ["JCLIB_LAN_INSTRUMENT_SW_VERSION", "JCLIB_LAN_SPEED_UNIT_SWITCH", "JCLIB_LAN_CLEAR_HOUR_METER", "JCLIB_LAN_CAN_BAUDRATE_SELECT"],
      ["JCLIB_LAN_MODE_STORAGE", "JCLIB_LAN_MILEAGE_CLEAR", "JCLIB_LAN_TURTLE_MODE_SELECT", "JCLIB_LAN_SEATBELT_SELECT"],
      ["JCLIB_LAN_SELF_CHECK_FUNCTION", "JCLIB_LAN_SET_ADMIN_PASSWORD", "JCLIB_LAN_AUTH_ENABLE", "JCLIB_LAN_RESTORE_DEFAULTS"],
    ],
  },
  {
    titleKey: "JCLIB_LAN_ADVANCED_SETTINGS",
    y: 236,
    pages: [
      ["JCLIB_LAN_VERSION_SELECT", "JCLIB_LAN_MILEAGE_DISPLAY", "JCLIB_LAN_CARD_INTERFACE_TEXT"],
      ["JCLIB_LAN_HANDSHAKE_SELECT", "JCLIB_LAN_PASSWORD_BOOT_ENABLE", "JCLIB_LAN_ANTI_REMOVAL_ENABLE"],
    ],
  },
];

/** 设置子对话框布局（相对内容区 520×270）。 */
export const SET_DIALOG = {
  /** 语言项：2 列 × 5 行，条目 186×44。 */
  languageItem: { w: 186, h: 44, x: 5, y: 4, colStep: 255, rowStep: 50, labelX: 25, labelY: 14, checkX: 135, checkY: 7 },
  /** 亮度/音量滑条（参考 441×33，位于 (10,39)）。 */
  slider: { x: 10, y: 39, w: 441, h: 33 },
  /** 百分比标签（滑条下方）。 */
  valueLabel: { x: 341, y: 82, w: 110, h: 32 },
  /** 初始亮度/音量（设置持久化随 M3 的设置存储）。 */
  initialBrightness: 70,
  initialVolume: 70,
} as const;

/** 夹取页码到菜单有效范围。 */
export function clampMenuPage(page: number, pages: number): number {
  return Math.min(Math.max(page, 0), Math.max(0, pages - 1));
}

