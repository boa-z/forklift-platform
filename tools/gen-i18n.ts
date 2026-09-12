// 从 data.bin 与参考工程头文件生成 UI 使用的语言/故障/监控菜单表。
//
//   REFERENCE_METER_ROOT=/path/to/meter_6_test bun tools/gen-i18n.ts
//
// 生成（均为构建期产物，随仓库提交，改 bin 后重跑）：
//   ui/src/i18n/keys.gen.ts            JCLIB_LAN_* 枚举名 -> 语言表下标
//   ui/src/i18n/strings.gen.ts         zh 语言表全部字符串（含菜单树扩展项）
//   ui/src/i18n/fault.gen.ts           故障码 -> 语言表下标（取自参考故障表）
//   ui/src/screens/monitor/menu.gen.ts 监控菜单树（SDO 名称/权限/地址）
//
// 参考工程只作为生成输入，不参与构建；生成文件头部记录 data.bin CRC。

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { parseLanguageBank, parseMenuTree, verifyDataBin, type DataBinConfig, type MenuNode } from "./databin";

const DEFAULT_REFERENCE = "/Users/boa/Documents/dev/luban-lite-jc-d70t/packages/artinchip/lvgl-ui/aic_demo/meter_6_test";
const reference = (process.env.REFERENCE_METER_ROOT ?? DEFAULT_REFERENCE).replace(/\/+$/, "");
const root = join(import.meta.dir, "..");

/** 读取 data.bin 与地址表。 */
function loadDataBin(): { bytes: Uint8Array; config: DataBinConfig } {
  const bytes = new Uint8Array(readFileSync(join(root, "data/bin/data.bin")));
  const raw = JSON.parse(readFileSync(join(root, "data/bin/config.json"), "utf8")) as {
    data_description: {
      file_size: number;
      crc: number;
      sdo_base_addr: number;
      language_addr: number[];
      language_code: string[];
    };
  };
  const config: DataBinConfig = {
    fileSize: raw.data_description.file_size,
    crc16: raw.data_description.crc,
    sdoBaseAddr: raw.data_description.sdo_base_addr,
    languageAddr: raw.data_description.language_addr,
    languageCode: raw.data_description.language_code,
  };
  verifyDataBin(bytes, config);
  return { bytes, config };
}

/** 提取 JCLIB_LAN 枚举名（顺序即语言表下标，排除哨兵 JCLIB_LAN_ALL）。 */
function parseLanKeys(): string[] {
  const header = readFileSync(join(reference, "jclib_ui.h"), "utf8");
  const match = /enum JCLIB_LAN\b/.exec(header);
  if (match === null) throw new Error("jclib_ui.h 中找不到 enum JCLIB_LAN");
  const start = match.index;
  const end = header.indexOf("\n    };", start);
  if (end < 0) throw new Error("jclib_ui.h 中找不到 enum JCLIB_LAN 的结束括号");
  const body = header.slice(start, end);
  const names = [...body.matchAll(/JCLIB_LAN_[A-Z0-9_]+/g)].map((match) => match[0]);
  if (names[names.length - 1] !== "JCLIB_LAN_ALL") {
    throw new Error(`JCLIB_LAN 枚举最后一项应为 JCLIB_LAN_ALL，实际 ${names[names.length - 1]}`);
  }
  return names.slice(0, -1);
}

/** 提取故障码 -> 语言表键名（参考故障表的全部 `{0x.., JCLIB_LAN_*}` 项）。 */
function parseFaultKeys(): Array<{ code: number; key: string }> {
  const header = readFileSync(join(reference, "app_lvgl_error_code_List.h"), "utf8");
  const entries: Array<{ code: number; key: string }> = [];
  for (const match of header.matchAll(/\{\s*0x([0-9A-Fa-f]+)\s*,\s*(JCLIB_LAN_[A-Z0-9_]+)\s*\}/g)) {
    entries.push({ code: Number.parseInt(match[1] ?? "0", 16), key: match[2] ?? "" });
  }
  return entries;
}

/** 序列化对象为 TS 字面量（统一 2 空格缩进）。 */
function ts(value: unknown): string {
  return JSON.stringify(value, null, 2) ?? "null";
}

/** 生成监控菜单树的 TS 类型与数据。 */
function menuTs(node: MenuNode, depth: number): string {
  const indent = "  ".repeat(depth);
  const head = `{ kind: ${JSON.stringify(node.kind)}, nameIndex: ${node.nameIndex}, auth: ${node.auth}`;
  if (node.kind === "sdo" && node.sdo !== undefined) {
    const sdo = node.sdo;
    return `${indent}${head}, sdo: { rw: ${sdo.rw}, handle: ${sdo.handle}, handleParam: ${sdo.handleParam}, fid: ${sdo.fid}, mid: ${sdo.mid}, sid: ${sdo.sid}, default: ${sdo.default}, min: ${sdo.min}, max: ${sdo.max} }, children: [] }`;
  }
  if (node.children.length === 0) return `${indent}${head}, children: [] }`;
  const children = node.children.map((child) => menuTs(child, depth + 1)).join(",\n");
  return `${indent}${head}, children: [\n${children},\n${indent}] }`;
}

const header = (source: string, crc: number): string =>
  `// 由 tools/gen-i18n.ts 生成，请勿手改。\n// 来源：${source}；data.bin CRC16-CCITT-FALSE = ${crc}。\n\n`;

const { bytes, config } = loadDataBin();
const zh = parseLanguageBank(bytes, config, 0);
const keys = parseLanKeys();
if (zh.strings.length < keys.length) {
  throw new Error(`zh 语言表 ${zh.strings.length} 项少于枚举 ${keys.length} 项`);
}

// keys.gen.ts：枚举名 -> 下标（只读字面量对象，便于按键取值）。
const keyIndex = Object.fromEntries(keys.map((name, index) => [name, index]));
writeFileSync(
  join(root, "ui/src/i18n/keys.gen.ts"),
  `${header("jclib_ui.h enum JCLIB_LAN + data/bin/data.bin", config.crc16)}` +
    `/** JCLIB_LAN_* 枚举名到语言表下标的映射（不含哨兵 JCLIB_LAN_ALL）。 */\n` +
    `export const LAN_KEY_INDEX = ${ts(keyIndex)} as const;\n\n` +
    `/** 可按键查询的语言键。 */\nexport type LanKey = keyof typeof LAN_KEY_INDEX;\n`,
);

// strings.gen.ts：zh 完整字符串表（含枚举之后的菜单扩展项）。
writeFileSync(
  join(root, "ui/src/i18n/strings.gen.ts"),
  `${header("data/bin/data.bin 语言表（zh）", config.crc16)}` +
    `/** zh 语言表：下标与 JCLIB_LAN_* 枚举、菜单树 nameIndex 对应。 */\n` +
    `export const ZH_STRINGS: readonly string[] = ${ts(zh.strings)};\n`,
);

// fault.gen.ts：故障码 -> 语言表下标（参考故障表；重复码取首次出现）。
const faultIndex = new Map<number, number>();
for (const entry of parseFaultKeys()) {
  const key = entry.key as keyof typeof keyIndex;
  const index = keyIndex[key];
  if (index === undefined) throw new Error(`故障表引用了未知语言键 ${entry.key}`);
  if (!faultIndex.has(entry.code)) faultIndex.set(entry.code, index);
}
const faultObject = Object.fromEntries([...faultIndex.entries()].sort((a, b) => a[0] - b[0]));
writeFileSync(
  join(root, "ui/src/i18n/fault.gen.ts"),
  `${header("app_lvgl_error_code_List.h + data.bin", config.crc16)}` +
    `/** 故障码到语言表下标的映射（参考故障表，重复码取首次出现）。 */\n` +
    `export const FAULT_LAN_INDEX: Record<number, number> = ${ts(faultObject)};\n`,
);

// menu.gen.ts：监控菜单树。
const tree = parseMenuTree(bytes, config);
let menuCount = 0;
let sdoCount = 0;
const count = (node: MenuNode): void => {
  if (node.kind === "menu") menuCount += 1;
  else sdoCount += 1;
  node.children.forEach(count);
};
count(tree);
writeFileSync(
  join(root, "ui/src/screens/monitor/menu.gen.ts"),
  `${header("data/bin/data.bin SDO 菜单树", config.crc16)}` +
    `import type { MonitorNode } from "./tree";\n\n` +
    `/** 监控菜单树根（kind=menu，children 为 10 个监测/设置分类）。 */\n` +
    `export const MONITOR_TREE: MonitorNode = ${menuTs(tree, 0)};\n`,
);

console.log(`gen-i18n: ${keys.length} 个语言键、${zh.strings.length} 条 zh 字符串、${faultIndex.size} 个故障码、${menuCount} 个菜单节点/${sdoCount} 个 SDO 条目`);
