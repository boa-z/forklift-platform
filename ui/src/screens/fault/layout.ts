// 故障诊断屏布局常量：对应参考 LvglFaultScreen.c 的元素坐标。
// 行位从 y=115 起，每行 66px；每页 4 行。

/** 故障屏布局。 */
export const FAULT = {
  /** 标题“故障诊断”。 */
  title: { x: 74, y: 64, w: 400, h: 32 },
  /** 上一页按钮。 */
  pageLeft: { x: 610, y: 44, w: 50, h: 44 },
  /** 页码标签。 */
  pageLabel: { x: 655, y: 52, w: 51, h: 26 },
  /** 下一页按钮。 */
  pageRight: { x: 696, y: 44, w: 50, h: 44 },
  /** 故障行文本槽。 */
  rowLabel: { x: 100, w: 560, h: 50 },
  /** 故障行图标槽。 */
  rowIcon: { x: 672, w: 66, h: 51 },
  /** 行起始 y 与行距。 */
  rowY: [115, 181, 247, 313] as const,
  /** 空状态提示。 */
  empty: { x: 160, y: 196, w: 480, h: 30 },
  /** 每页行数。 */
  rowsPerPage: 4,
} as const;

/** 严重度中文标签。 */
export function severityLabel(severity: "info" | "warning" | "critical"): string {
  switch (severity) {
    case "critical":
      return "严重";
    case "warning":
      return "警告";
    default:
      return "提示";
  }
}

/** 故障行文案：`F 编号  说明`。 */
export function faultRowText(id: number, severity: "info" | "warning" | "critical", occurrences: number): string {
  const count = occurrences > 1 ? `  x${occurrences}` : "";
  return `F ${id}  ${severityLabel(severity)}${count}`;
}

/** 总页数（至少 1 页）。 */
export function faultPageCount(count: number): number {
  return Math.max(1, Math.ceil(count / FAULT.rowsPerPage));
}

/** 夹取页码到有效范围。 */
export function clampFaultPage(page: number, count: number): number {
  return Math.min(Math.max(page, 0), faultPageCount(count) - 1);
}
