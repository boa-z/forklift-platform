// 自检屏布局常量：对应参考 LvglSelfCheckScreen.c 的元素坐标。
// 6 个检查项按左右两列排列（左列 x=72，右列 x=408，行距 60）。

/** 自检屏布局。 */
export const SELF_CHECK = {
  /** 标题“系统自检”。 */
  title: { x: 74, y: 64, w: 400, h: 32 },
  /** 进度文字（右对齐）。 */
  progressLabel: { x: 580, y: 73, w: 113, h: 35 },
  /** 进度条（轨道与填充共用）。 */
  progressBar: { x: 72, y: 109, w: 626, h: 18 },
  /** 检查项尺寸与标签内偏移。 */
  item: { w: 303, h: 52, labelX: 20, labelY: 15, statusX: 240, statusY: 15 },
  /** 检查项坐标（顺序与 model.ts 的条目一致）。 */
  itemPositions: [
    { x: 72, y: 170 },
    { x: 72, y: 230 },
    { x: 72, y: 290 },
    { x: 408, y: 170 },
    { x: 408, y: 230 },
    { x: 408, y: 290 },
  ] as const,
  /** “进入系统”按钮。 */
  enterButton: { x: 288, y: 364, w: 206, h: 52 },
  /** 自检超时（毫秒），与参考的 60×50ms 定时一致。 */
  timeoutMs: 3000,
} as const;
