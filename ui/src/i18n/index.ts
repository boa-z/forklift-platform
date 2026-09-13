// i18n：语言字符串来自 data.bin（tools/gen-i18n.ts 生成），按键或下标取值。
// 语言在运行时切换（当前支持 zh / en；其余语言的字形与整形依赖 M3 的字体方案）。
// 存储为普通模块状态；界面在切换后通过 subscribeLanguage 主动刷新。

import { FAULT_LAN_INDEX } from "./fault.gen";
import { LAN_KEY_INDEX, type LanKey } from "./keys.gen";
import { EN_STRINGS } from "./strings.en.gen";
import { ZH_STRINGS } from "./strings.gen";

/** 可切换的语言代码。 */
export type LanguageCode = "zh" | "en";

/** 语言表（下标与 JCLIB_LAN_* 枚举、菜单树 nameIndex 对应）。 */
const TABLES: Record<LanguageCode, readonly string[]> = {
  zh: ZH_STRINGS,
  en: EN_STRINGS,
};

/** 语言名称在语言表中的下标（JCLIB_LAN_CHINESE 起的 10 项）。 */
export const LANGUAGE_NAME_BASE = 0;

/** 全部语言名称的条目数（zh/en/ru/fr/de/ko/pt/es/ar/ja）。 */
export const LANGUAGE_COUNT = 10;

/** 当前可切换的语言（字形已覆盖；其余语言在对话框中置灰）。 */
export const SELECTABLE_LANGUAGES: readonly { code: LanguageCode; nameIndex: number }[] = [
  { code: "zh", nameIndex: 0 },
  { code: "en", nameIndex: 1 },
];

let current: LanguageCode = "zh";
const listeners = new Set<() => void>();

/** 当前语言代码。 */
export function currentLanguage(): LanguageCode {
  return current;
}

/** 切换语言；未知代码与原语言为无操作。 */
export function setLanguage(code: LanguageCode): void {
  if (code === current || TABLES[code] === undefined) return;
  current = code;
  for (const listener of listeners) listener();
}

/** 订阅语言变化，返回取消函数。 */
export function subscribeLanguage(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** 按键取文案；未知键返回键名（显示异常可见，不静默）。 */
export function t(key: LanKey): string {
  const index = LAN_KEY_INDEX[key];
  return index === undefined ? key : tIndex(index);
}

/** 按语言表下标取文案；越界返回空串。
 *  非 zh 表中的非 ASCII 条目（未翻译回退）用 zh 表兜底，避免豆腐块。 */
export function tIndex(index: number): string {
  const text = TABLES[current][index] ?? "";
  if (current !== "zh" && /[^\x00-\x7f]/.test(text)) return ZH_STRINGS[index] ?? text;
  return text;
}

/** 故障码对应文案；未收录的故障码返回空串。 */
export function faultText(id: number): string {
  const index = FAULT_LAN_INDEX[id];
  return index === undefined ? "" : tIndex(index);
}

export { LAN_KEY_INDEX, type LanKey };
