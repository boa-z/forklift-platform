// UI 素材烘焙：把参考工程的 PNG 补齐为 2 的幂纹理（PocketJS pak 要求
// ≤512 且边长为 2 的幂），并生成类型化的素材清单。
//
//   POCKETJS_ROOT=../pocketjs bun tools/bake-ui-assets.ts
//
// 说明：
// - 透明补齐，左上对齐，不缩放内容；
// - 800×480 背景与 662×26 电量条改为 View 绘制，不在此烘焙；
// - 生成 ui/src/screens/main/assets.gen.ts，组件不得手写素材尺寸。

import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { deflateSync } from "node:zlib";

const root = join(import.meta.dir, "..");
const pocketjsEnv = (process.env.POCKETJS_ROOT ?? "").trim();
if (pocketjsEnv === "") {
  console.error("bake-ui-assets: 请设置 POCKETJS_ROOT");
  process.exit(1);
}
// 相对于执行目录解析，保证动态 import 的路径始终有效。
const pocketjs = resolve(pocketjsEnv);

const { decodePng } = await import(join(pocketjs, "framework/compiler/pak.ts"));

/** 下一个不小于 n 的 2 的幂。 */
function nextPow2(n: number): number {
  let value = 1;
  while (value < n) value <<= 1;
  return value;
}

/** PNG 块 CRC32。 */
function crc32(buffer: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** 组装 PNG 块。 */
function chunk(type: string, data: Uint8Array): Uint8Array {
  const length = new Uint8Array(4);
  new DataView(length.buffer).setUint32(0, data.length, false);
  const tagged = new Uint8Array(4 + data.length);
  tagged.set(new TextEncoder().encode(type), 0);
  tagged.set(data, 4);
  const crc = new Uint8Array(4);
  new DataView(crc.buffer).setUint32(0, crc32(tagged), false);
  const out = new Uint8Array(8 + data.length + 4);
  out.set(length, 0);
  out.set(tagged, 4);
  out.set(crc, 8 + data.length);
  return out;
}

/** 把 RGBA 像素编码为 8-bit PNG（color type 6，filter 0）。 */
function encodePng(width: number, height: number, rgba: Uint8Array): Uint8Array {
  const signature = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, width, false);
  ihdrView.setUint32(4, height, false);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = new Uint8Array(height * (1 + width * 4));
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * (1 + width * 4);
    raw[rowOffset] = 0;
    raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), rowOffset + 1);
  }
  const idat = deflateSync(raw, { level: 9 });
  const parts = [signature, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", new Uint8Array(0))];
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const png = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    png.set(part, offset);
    offset += part.length;
  }
  return png;
}

/** 透明补齐到 2 的幂（左上对齐）。 */
function padToPow2(image: { width: number; height: number; rgba: Uint8Array }): {
  width: number;
  height: number;
  rgba: Uint8Array;
  padded: boolean;
} {
  const width = nextPow2(image.width);
  const height = nextPow2(image.height);
  if (width === image.width && height === image.height) {
    return { ...image, padded: false };
  }
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < image.height; y += 1) {
    rgba.set(
      image.rgba.subarray(y * image.width * 4, (y + 1) * image.width * 4),
      y * width * 4,
    );
  }
  return { width, height, rgba, padded: true };
}

const sources: string[] = [];
for (const dir of ["src", "status", "error", "selfCheck", "menu"]) {
  const base = join(root, "ui/assets/reference", dir);
  for (const name of readdirSync(base).filter((n) => n.endsWith(".png"))) {
    sources.push(join(base, name));
  }
}

/** 大图裁切（pak 纹理上限 512）：整图按 512 列切片，或截取局部。 */
interface Crop {
  /** 生成素材名。 */
  name: string;
  /** 相对 ui/assets/reference 的源路径。 */
  path: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

const crops: readonly Crop[] = [
  // 背景图只有底部导航条带与返回按钮区域有内容；其余像素为基色 #080304
  // （由屏幕底色绘制）。条带 70 高，左右两片。
  { name: "main_nav", path: "bg/main_bg.png", x: 0, y: 410, w: 512, h: 70 },
  { name: "main_nav_r", path: "bg/main_bg.png", x: 512, y: 410, w: 288, h: 70 },
  { name: "fault_nav", path: "bg/001bg.png", x: 0, y: 410, w: 512, h: 70 },
  { name: "fault_nav_r", path: "bg/001bg.png", x: 512, y: 410, w: 288, h: 70 },
  { name: "menu_nav", path: "bg/000_menu_bg.png", x: 0, y: 410, w: 512, h: 70 },
  { name: "menu_nav_r", path: "bg/000_menu_bg.png", x: 512, y: 410, w: 288, h: 70 },
  // 自检进度条：629×27，左 512 + 右 117；绿色填充用 16/8/4/2/1 均匀切片
  // 精确拼出任意宽度（切片取自条带中段，像素与原始一致）。
  { name: "progress_grey_t0", path: "progress/006ProgressGrey.png", x: 0, y: 0, w: 512, h: 27 },
  { name: "progress_grey_t1", path: "progress/006ProgressGrey.png", x: 512, y: 0, w: 117, h: 27 },
  { name: "progress_green_slice16", path: "progress/005ProgressGreen.png", x: 280, y: 0, w: 16, h: 27 },
  { name: "progress_green_slice8", path: "progress/005ProgressGreen.png", x: 280, y: 0, w: 8, h: 27 },
  { name: "progress_green_slice4", path: "progress/005ProgressGreen.png", x: 280, y: 0, w: 4, h: 27 },
  { name: "progress_green_slice2", path: "progress/005ProgressGreen.png", x: 280, y: 0, w: 2, h: 27 },
  { name: "progress_green_slice1", path: "progress/005ProgressGreen.png", x: 280, y: 0, w: 1, h: 27 },
  // 电量条：662×26 轨道两片；三段颜色各取一个分段。
  { name: "soc_track_t0", path: "src/soc_0.png", x: 0, y: 0, w: 512, h: 26 },
  { name: "soc_track_t1", path: "src/soc_0.png", x: 512, y: 0, w: 150, h: 26 },
  { name: "soc_seg_green", path: "src/soc_1.png", x: 0, y: 0, w: 62, h: 26 },
  { name: "soc_seg_yellow", path: "src/soc_2.png", x: 0, y: 0, w: 62, h: 26 },
  { name: "soc_seg_red", path: "src/soc_3.png", x: 0, y: 0, w: 61, h: 25 },
];

const outDir = join(root, "ui/assets/pak");
mkdirSync(outDir, { recursive: true });
const entries: string[] = [];
const seen = new Set<string>();

/** 写入一个烘焙素材并登记清单。 */
function bake(name: string, width: number, height: number, rgba: Uint8Array, sourceLabel: string): void {
  if (seen.has(name)) {
    console.error(`bake-ui-assets: 素材重名 ${name}`);
    process.exit(1);
  }
  seen.add(name);
  const padded = padToPow2({ width, height, rgba });
  writeFileSync(join(outDir, `${name}.png`), encodePng(padded.width, padded.height, padded.rgba));
  entries.push(
    `  ${JSON.stringify(name)}: { src: ${JSON.stringify(`assets/pak/${name}.png`)}, w: ${padded.width}, h: ${padded.height}, cw: ${width}, ch: ${height} },`,
  );
  console.log(
    `bake-ui-assets: ${name} ${width}x${height} -> ${padded.width}x${padded.height} (${sourceLabel})`,
  );
}

for (const source of sources) {
  if (basename(source).startsWith("soc_")) continue;
  const name = basename(source, ".png");
  const image = decodePng(new Uint8Array(await Bun.file(source).arrayBuffer()));
  if (image.width > 512 || image.height > 512) {
    console.error(`bake-ui-assets: ${source} 超过 512（${image.width}x${image.height}）`);
    process.exit(1);
  }
  bake(name, image.width, image.height, image.rgba, basename(source));
}

for (const crop of crops) {
  const source = join(root, "ui/assets/reference", crop.path);
  const image = decodePng(new Uint8Array(await Bun.file(source).arrayBuffer()));
  if (crop.x + crop.w > image.width || crop.y + crop.h > image.height) {
    console.error(`bake-ui-assets: 裁切超出范围 ${crop.name}（源 ${image.width}x${image.height}）`);
    process.exit(1);
  }
  const rgba = new Uint8Array(crop.w * crop.h * 4);
  for (let row = 0; row < crop.h; row += 1) {
    const from = ((crop.y + row) * image.width + crop.x) * 4;
    rgba.set(image.rgba.subarray(from, from + crop.w * 4), row * crop.w * 4);
  }
  bake(crop.name, crop.w, crop.h, rgba, crop.path);
}

const generated = `// 由 tools/bake-ui-assets.ts 生成，请勿手改。
// 纹理已补齐为 2 的幂：w/h 是补齐后的纹理尺寸，cw/ch 是内容尺寸
// （左上对齐，透明扩展）；渲染用 cw/ch，贴图资源用 w/h。

export const BAKED = {
${entries.join("\n")}
} as const;

export type BakedAsset = keyof typeof BAKED;
`;
writeFileSync(join(root, "ui/src/screens/main/assets.gen.ts"), generated);
console.log(`bake-ui-assets: ${entries.length} 个素材 -> ui/assets/pak + assets.gen.ts`);

// 顺带输出 main_bg.png 的关键取色，供背景 View 绘制参考。
const background = decodePng(
  new Uint8Array(await Bun.file(join(root, "ui/assets/reference/bg/main_bg.png")).arrayBuffer()),
);
/** 读取指定像素的十六进制颜色。 */
function pixel(x: number, y: number): string {
  const offset = (y * background.width + x) * 4;
  const [r, g, b, a] = background.rgba.subarray(offset, offset + 4);
  return `#${[r, g, b].map((v) => (v ?? 0).toString(16).padStart(2, "0")).join("")} a=${a}`;
}
console.log("bake-ui-assets: main_bg 取色");
console.log(`  (10,10)   ${pixel(10, 10)}`);
console.log(`  (400,240) ${pixel(400, 240)}`);
console.log(`  (99,440)  ${pixel(99, 440)}`);
console.log(`  (300,440) ${pixel(300, 440)}`);
console.log(`  (500,440) ${pixel(500, 440)}`);
console.log(`  (700,440) ${pixel(700, 440)}`);
console.log(`  (400,415) ${pixel(400, 415)}`);
