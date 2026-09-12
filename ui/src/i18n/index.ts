// i18n：语言字符串来自 data.bin（tools/gen-i18n.ts 生成），按键或下标取值。
// v1 只启用 zh；生成文件保留全部枚举键，切语言只需替换 strings.gen.ts 的数据源。

import { FAULT_LAN_INDEX } from "./fault.gen";
import { LAN_KEY_INDEX, type LanKey } from "./keys.gen";
import { ZH_STRINGS } from "./strings.gen";

/** 按键取文案；未知键返回键名（显示异常可见，不静默）。 */
export function t(key: LanKey): string {
  const index = LAN_KEY_INDEX[key];
  return index === undefined ? key : tIndex(index);
}

/** 按语言表下标取文案；越界返回空串。 */
export function tIndex(index: number): string {
  return ZH_STRINGS[index] ?? "";
}

/** 故障码对应文案；未收录的故障码返回空串。 */
export function faultText(id: number): string {
  const index = FAULT_LAN_INDEX[id];
  return index === undefined ? "" : tIndex(index);
}

export { LAN_KEY_INDEX, type LanKey };
