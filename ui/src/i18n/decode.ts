// 语言表解码：base64(JSON) -> string[]（QuickJS 无 atob/TextDecoder，纯 JS 实现）。
// 生成器把非默认语言表以 base64 存储，避免字体烘焙把非 ASCII 条目的字形
// 带进字库；校验失败时抛错（生成文件损坏应当在启动时暴露）。

const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** base64 解码为字节数组。 */
function decodeBase64(encoded: string): Uint8Array {
  const lookup = new Int16Array(128).fill(-1);
  for (let index = 0; index < BASE64_ALPHABET.length; index += 1) {
    lookup[BASE64_ALPHABET.charCodeAt(index)] = index;
  }
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (let index = 0; index < encoded.length; index += 1) {
    const code = encoded.charCodeAt(index);
    if (code >= 128) continue;
    const value = lookup[code] ?? -1;
    if (value < 0) continue;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  return new Uint8Array(bytes);
}

/** UTF-8 字节解码为字符串（含 1-4 字节序列）。 */
function decodeUtf8(bytes: Uint8Array): string {
  let text = "";
  let index = 0;
  while (index < bytes.length) {
    const first = bytes[index] ?? 0;
    index += 1;
    let codePoint: number;
    if (first < 0x80) {
      codePoint = first;
    } else if (first < 0xe0) {
      codePoint = ((first & 0x1f) << 6) | ((bytes[index] ?? 0) & 0x3f);
      index += 1;
    } else if (first < 0xf0) {
      codePoint = ((first & 0x0f) << 12) | (((bytes[index] ?? 0) & 0x3f) << 6) | ((bytes[index + 1] ?? 0) & 0x3f);
      index += 2;
    } else {
      codePoint =
        ((first & 0x07) << 18) |
        (((bytes[index] ?? 0) & 0x3f) << 12) |
        (((bytes[index + 1] ?? 0) & 0x3f) << 6) |
        ((bytes[index + 2] ?? 0) & 0x3f);
      index += 3;
    }
    if (codePoint > 0xffff) {
      const adjusted = codePoint - 0x10000;
      text += String.fromCharCode(0xd800 + (adjusted >> 10), 0xdc00 + (adjusted & 0x3ff));
    } else {
      text += String.fromCharCode(codePoint);
    }
  }
  return text;
}

/** 解码 base64 编码的 JSON 字符串表。 */
export function decodeStrings(encoded: string): readonly string[] {
  const parsed: unknown = JSON.parse(decodeUtf8(decodeBase64(encoded)));
  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string")) {
    throw new Error("语言表解码失败：内容不是字符串数组");
  }
  return parsed;
}
