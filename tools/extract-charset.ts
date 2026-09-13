// 从 data.bin 提取字体子集所需的字符集。
//
//   bun tools/extract-charset.ts
//
// 输出 ui/assets/fonts/charset.txt：全部中文语言表字符 + ASCII 可打印字符。
// 供 tools/subset-fonts.sh 生成 MiSans 子集字体。

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { parseLanguageBank, verifyDataBin, type DataBinConfig } from "./databin";

const root = join(import.meta.dir, "..");
const bytes = new Uint8Array(readFileSync(join(root, "data/bin/data.bin")));
const rawConfig = JSON.parse(readFileSync(join(root, "data/bin/config.json"), "utf8")) as {
  data_description: {
    file_size: number;
    crc: number;
    sdo_base_addr: number;
    language_addr: number[];
    language_code: string[];
  };
};
const config: DataBinConfig = {
  fileSize: rawConfig.data_description.file_size,
  crc16: rawConfig.data_description.crc,
  sdoBaseAddr: rawConfig.data_description.sdo_base_addr,
  languageAddr: rawConfig.data_description.language_addr,
  languageCode: rawConfig.data_description.language_code,
};
verifyDataBin(bytes, config);

// 字符集取全部语言的字符串并集：切换语言不需要重新生成字体。
const chars = new Set<string>();
for (let index = 0; index < config.languageCode.length; index += 1) {
  if ((config.languageAddr[index] ?? -1) < 0) continue;
  for (const text of parseLanguageBank(bytes, config, index).strings) {
    for (const char of text) {
      if (char !== "\n" && char !== "\r") chars.add(char);
    }
  }
}
// ASCII 可打印字符恒包含（数字、单位与英文标签）。
for (let code = 0x20; code <= 0x7e; code += 1) chars.add(String.fromCharCode(code));

const sorted = [...chars].sort((a, b) => (a.codePointAt(0) ?? 0) - (b.codePointAt(0) ?? 0));
const output = join(root, "ui/assets/fonts/charset.txt");
writeFileSync(output, `${sorted.join("")}\n`);
console.log(`extract-charset: ${sorted.length} 个字符 -> ${output}`);
