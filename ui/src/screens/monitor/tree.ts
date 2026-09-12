// 监控菜单树类型：与 tools/databin.ts 的解析结果一致。
// menu.gen.ts 由 tools/gen-i18n.ts 生成，运行时不再解析 data.bin。

/** SDO 叶子信息（CANopen 对象地址与处理方式）。 */
export interface MonitorSdo {
  /** 读写权限：0 只读，1 读写，2 只写。 */
  rw: number;
  /** 数据处理方式。 */
  handle: number;
  /** 处理参数（含位域 bitPos/bitLen）。 */
  handleParam: number;
  /** 帧 id。 */
  fid: number;
  /** CANopen 主索引。 */
  mid: number;
  /** CANopen 子索引。 */
  sid: number;
  /** 默认值。 */
  default: number;
  /** 最小值。 */
  min: number;
  /** 最大值。 */
  max: number;
}

/** 监控菜单节点。 */
export interface MonitorNode {
  /** 节点类型。 */
  kind: "menu" | "sdo";
  /** 名称在语言表中的下标。 */
  nameIndex: number;
  /** 权限：1 普通用户，2 管理员，3 超级管理员。 */
  auth: number;
  /** 子节点。 */
  children: MonitorNode[];
  /** SDO 信息（kind=sdo 时存在）。 */
  sdo?: MonitorSdo;
}

/** 分页大小（每页 4 行，与参考界面一致）。 */
export const MONITOR_PAGE_SIZE = 4;

/** 计算总页数（至少 1 页）。 */
export function monitorPageCount(total: number): number {
  return Math.max(1, Math.ceil(total / MONITOR_PAGE_SIZE));
}

/** 夹取页码到有效范围。 */
export function clampMonitorPage(page: number, total: number): number {
  return Math.min(Math.max(page, 0), monitorPageCount(total) - 1);
}
