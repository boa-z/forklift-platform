// 主屏布局常量：逐项对应 docs/ui-main-screen.md 的 ground truth。
// 组件只引用这里的常量，不在 JSX 里写坐标魔数。

/** 主屏物理尺寸（与 target profile 一致）。 */
export const SCREEN_WIDTH = 800;
export const SCREEN_HEIGHT = 480;

/** 顶栏图标通用尺寸。 */
const TOP_ICON = 17;

/** 顶部状态栏元素。 */
export const TOP = {
  rtc: { x: 20, y: 20, w: 80, h: 32 },
  bluetooth: { x: 618, y: 21, w: 14, h: 19 },
  usb: { x: 649, y: 21, w: TOP_ICON, h: TOP_ICON },
  gps: { x: 689, y: 21, w: 14, h: 17 },
  network: { x: 719, y: 21, w: TOP_ICON, h: TOP_ICON },
  signal: { x: 735, y: 21, w: TOP_ICON, h: 15 },
  lockIcon: { x: 755, y: 21, w: TOP_ICON, h: TOP_ICON },
  lockButton: { x: 712, y: 48, w: 45, h: 45 },
} as const;

/** 次顶栏按钮（模式/相机/多媒体/语音）。 */
export const TOOLBAR = {
  runMode: { x: 310, y: 54, w: 80, h: 36 },
  camera: { x: 410, y: 54, w: 80, h: 36 },
  multiMedia: { x: 402, y: 54, w: 57, h: 26 },
  voice: { x: 464, y: 54, w: 57, h: 26 },
} as const;

/** 中央车速区。 */
export const SPEED = {
  value: { x: 300, y: 85, w: 185, h: 80 },
  unit: { x: 495, y: 150, w: 80, h: 38 },
} as const;

/** 电量区。 */
export const SOC = {
  label: { x: 50, y: 150, w: 100, h: 38 },
  value: { x: 650, y: 150, w: 100, h: 38 },
  bar: { x: 67, y: 170, w: 662, h: 26 },
} as const;

/** 工时与里程区。 */
export const COUNTERS = {
  workhourIcon: { x: 50, y: 274, w: 10, h: 14 },
  workhourValue: { x: 50, y: 292, w: 120, h: 30 },
  odomLabel: { x: 50, y: 322, w: 60, h: 10 },
  odomValue: { x: 50, y: 334, w: 120, h: 30 },
} as const;

/** 左右转向区。 */
export const STEER = {
  leftIcon: { x: 222, y: 230, w: 39, h: 37 },
  leftValue: { x: 272, y: 238, w: 60, h: 23 },
  rightIcon: { x: 578, y: 230, w: 39, h: 37 },
  rightValue: { x: 528, y: 238, w: 60, h: 23 },
} as const;

/** 车辆图形区（路面/档位/叉车/倒车雷达）。 */
export const VEHICLE = {
  road: { x: 0, y: 0, w: SCREEN_WIDTH, h: SCREEN_HEIGHT },
  gear: { x: 380, y: 200, w: 41, h: 20 },
  forklift: { x: 368, y: 245, w: 65, h: 112 },
  reverseLidarIcon: { x: 364, y: 370, w: 74, h: 33 },
  reverseLidarValue: { x: 376, y: 350, w: 150, h: 50 },
} as const;

/** 全屏遮罩（超速警告等）。 */
export const OVERLAY = { x: 0, y: 0, w: SCREEN_WIDTH, h: SCREEN_HEIGHT } as const;

/** 底部导航按钮。 */
export const BOTTOM_BUTTONS = {
  monitor: { x: 0, y: 410, w: 198, h: 69 },
  home: { x: 202, y: 410, w: 198, h: 69 },
  fault: { x: 402, y: 410, w: 198, h: 69 },
  set: { x: 602, y: 410, w: 198, h: 69 },
} as const;

/** 通用状态图标（两行五列）。 */
export const STATUS_GRID = {
  size: 28,
  columns: 5,
  originX: 592,
  stepX: 40,
  rowY: [284, 314] as const,
} as const;

/** 通用状态图标语义（与参考工程索引一致）。 */
export const STATUS_ICONS = [
  "parking_brake",
  "gear",
  "seat",
  "seatbelt",
  "fault",
  "lift_limit",
  "user_permission",
  "lock",
  "turtle",
  "low_battery",
] as const;

export type StatusIcon = (typeof STATUS_ICONS)[number];

/** 计算第 `index` 个通用状态图标的位置。 */
export function statusIconPosition(index: number): { x: number; y: number } {
  const row = index < STATUS_GRID.columns ? 0 : 1;
  const column = index % STATUS_GRID.columns;
  return {
    x: STATUS_GRID.originX + column * STATUS_GRID.stepX,
    y: STATUS_GRID.rowY[row] ?? STATUS_GRID.rowY[0],
  };
}
