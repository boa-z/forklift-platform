// 参考工程 data.bin 的解析器（语言表与 SDO 菜单树的只读视图）。
//
// 格式（逆向自 meter_6_test/jclib_ui.c，与 data/bin/config.json 地址表配合）：
// - 语言表：addr 处 u32 条目数，随后 u32 偏移数组，各偏移为 NUL 结尾 UTF-8；
// - SDO 树：节点为 40 字节记录（menu_item_t 菜单 / menu_sdo 叶子，type 区分），
//   menu 的 children_addr 为文件绝对偏移。
//
// 本模块只做解析，不做 IO；调用方传入完整文件字节与地址表。

/** data.bin 的地址表（来自 config.json 的 data_description）。 */
export interface DataBinConfig {
  /** 各语言的表地址；-1 表示无该语言。 */
  languageAddr: number[];
  /** 语言代码（与 languageAddr 对应）。 */
  languageCode: string[];
  /** SDO 菜单树根偏移。 */
  sdoBaseAddr: number;
  /** 文件字节数（校验用）。 */
  fileSize: number;
  /** CRC16-CCITT-FALSE（校验用）。 */
  crc16: number;
}

/** 语言表（按条目的顺序即 JCLIB_LAN_* 枚举顺序）。 */
export interface LanguageBank {
  /** 语言代码，如 `zh`。 */
  code: string;
  /** 字符串表。 */
  strings: string[];
}

/** 菜单树节点类型。 */
export type MenuNodeKind = "menu" | "sdo";

/** SDO 叶子信息（写入/读取 CANopen 对象时使用）。 */
export interface SdoInfo {
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

/** 菜单树节点。 */
export interface MenuNode {
  /** 节点类型。 */
  kind: MenuNodeKind;
  /** 名称在语言表中的下标。 */
  nameIndex: number;
  /** 权限：1 普通用户，2 管理员，3 超级管理员。 */
  auth: number;
  /** 子节点（menu 节点有值）。 */
  children: MenuNode[];
  /** SDO 信息（sdo 节点有值）。 */
  sdo?: SdoInfo;
}

/** 解析错误。 */
export class DataBinError extends Error {}

/** CRC16-CCITT-FALSE。 */
export function crc16CcittFalse(bytes: Uint8Array): number {
  let crc = 0xffff;
  for (const byte of bytes) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1) & 0xffff;
    }
  }
  return crc;
}

const MENU_ITEM_SIZE = 40;
const SDO_TYPE = 1;

/** 边界检查后读取 u16。 */
function readU16(view: DataView, offset: number, what: string): number {
  if (offset + 2 > view.byteLength) throw new DataBinError(`${what} 越界：${offset}`);
  return view.getUint16(offset, true);
}

/** 边界检查后读取 u32。 */
function readU32(view: DataView, offset: number, what: string): number {
  if (offset + 4 > view.byteLength) throw new DataBinError(`${what} 越界：${offset}`);
  return view.getUint32(offset, true);
}

/** 边界检查后读取 f32。 */
function readF32(view: DataView, offset: number, what: string): number {
  if (offset + 4 > view.byteLength) throw new DataBinError(`${what} 越界：${offset}`);
  return view.getFloat32(offset, true);
}

/** 校验文件尺寸与 CRC。 */
export function verifyDataBin(bytes: Uint8Array, config: DataBinConfig): void {
  if (bytes.byteLength !== config.fileSize) {
    throw new DataBinError(`data.bin 尺寸 ${bytes.byteLength} != ${config.fileSize}`);
  }
  const crc = crc16CcittFalse(bytes);
  if (crc !== config.crc16) {
    throw new DataBinError(`data.bin CRC ${crc} != ${config.crc16}`);
  }
}

/** 解析一个语言表。 */
export function parseLanguageBank(bytes: Uint8Array, config: DataBinConfig, languageIndex: number): LanguageBank {
  const code = config.languageCode[languageIndex];
  const addr = config.languageAddr[languageIndex];
  if (code === undefined || addr === undefined || addr < 0) {
    throw new DataBinError(`语言 ${languageIndex} 不存在`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = readU32(view, addr, "语言条目数");
  const strings: string[] = [];
  const decoder = new TextDecoder();
  for (let index = 0; index < count; index += 1) {
    const offset = readU32(view, addr + 4 + index * 4, `语言条目 ${index} 偏移`);
    if (offset >= bytes.byteLength) throw new DataBinError(`语言条目 ${index} 越界：${offset}`);
    let end = offset;
    while (end < bytes.byteLength && bytes[end] !== 0) end += 1;
    strings.push(decoder.decode(bytes.subarray(offset, end)));
  }
  return { code, strings };
}

/** 解析一个 SDO 节点（含递归子节点，深度上限 8 防止环）。 */
function parseNode(bytes: Uint8Array, view: DataView, addr: number, depth: number): MenuNode {
  if (depth > 8) throw new DataBinError(`菜单树过深：${addr}`);
  if (addr + MENU_ITEM_SIZE > bytes.byteLength) {
    throw new DataBinError(`菜单节点越界：${addr}`);
  }
  const control = readU16(view, addr, "菜单控制位");
  const kind: MenuNodeKind = (control & 0xf) === SDO_TYPE ? "sdo" : "menu";
  const auth = (control >> 4) & 0x7;
  const nameIndex = readU16(view, addr + 2, "菜单名称下标");
  if (kind === "menu") {
    const childrenAddr = readU32(view, addr + 4, "子节点地址");
    const total = readU32(view, addr + 8, "子节点数量");
    if (total > 4096) throw new DataBinError(`子节点数量异常：${total}`);
    const children: MenuNode[] = [];
    for (let index = 0; index < total; index += 1) {
      children.push(parseNode(bytes, view, childrenAddr + index * MENU_ITEM_SIZE, depth + 1));
    }
    return { kind, nameIndex, auth, children };
  }
  const ctrl = bytes[addr + 6] ?? 0;
  return {
    kind,
    nameIndex,
    auth,
    children: [],
    sdo: {
      rw: (ctrl >> 4) & 0x3,
      handle: bytes[addr + 7] ?? 0,
      handleParam: readU32(view, addr + 8, "SDO 处理参数"),
      fid: bytes[addr + 12] ?? 0,
      mid: readU16(view, addr + 13, "SDO 主索引"),
      sid: bytes[addr + 15] ?? 0,
      default: readU32(view, addr + 16, "SDO 默认值"),
      min: readF32(view, addr + 20, "SDO 最小值"),
      max: readF32(view, addr + 24, "SDO 最大值"),
    },
  };
}

/** 解析 SDO 菜单树。 */
export function parseMenuTree(bytes: Uint8Array, config: DataBinConfig): MenuNode {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return parseNode(bytes, view, config.sdoBaseAddr, 0);
}
