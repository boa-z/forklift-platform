// 监控屏布局常量：对应参考 LvglMonitorScreen.c 的框架元素坐标。
// 内容区 520×270，行 472×50，行距 60；每页 4 行（见 tree.ts）。

/** 监控屏布局。 */
export const MONITOR = {
  /** 返回主屏按钮。 */
  returnButton: { x: 38, y: 20, w: 55, h: 55 },
  /** 标题。 */
  title: { x: 270, y: 70, w: 400, h: 32 },
  /** 上一页按钮。 */
  pageLeft: { x: 580, y: 70, w: 74, h: 24 },
  /** 页码标签。 */
  pageLabel: { x: 652, y: 70, w: 74, h: 24 },
  /** 下一页按钮。 */
  pageRight: { x: 726, y: 70, w: 74, h: 24 },
  /** 内容区。 */
  content: { x: 275, y: 124, w: 520, h: 270 },
  /** 内容行（相对内容区）。 */
  row: { x: 25, w: 472, h: 50, stepY: 60 },
  /** 行内索引/名称/数值的 x 偏移。 */
  indexX: 5,
  nameX: 100,
  valueX: 262,
} as const;
