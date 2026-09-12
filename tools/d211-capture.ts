// 捕获 D211 帧缓冲为 PNG（调试与验收用）。
//
//   bun tools/d211-capture.ts <输出.png>
//
// 设备侧抓 /dev/fb0（800×480×32bpp BGRA，stride 3200），本地转 BMP 后
// 用 macOS sips 转 PNG。产物属于验证材料，不入库。

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const output = Bun.argv[2];
if (output === undefined) {
  console.error("用法: bun tools/d211-capture.ts <输出.png>");
  process.exit(2);
}
mkdirSync(dirname(output), { recursive: true });

const WIDTH = 800;
const HEIGHT = 480;
const BYTES = WIDTH * HEIGHT * 4;
const REMOTE_RAW = "/tmp/d211-capture.raw";

const temp = mkdtempSync(join(tmpdir(), "d211-capture-"));
try {
  // 该设备 adbd 的 exec-out 读大块数据会报 closed；改用设备端落盘 + pull。
  const dump = Bun.spawnSync({
    cmd: ["adb", "shell", `dd if=/dev/fb0 of=${REMOTE_RAW} bs=${BYTES} count=1`],
    stdout: "pipe",
    stderr: "pipe",
  });
  if (dump.exitCode !== 0) {
    console.error(`d211-capture: 设备端抓帧失败\n${dump.stderr.toString()}`);
    process.exit(1);
  }
  const rawPath = join(temp, "frame.raw");
  const pull = Bun.spawnSync({ cmd: ["adb", "pull", REMOTE_RAW, rawPath], stdout: "pipe", stderr: "pipe" });
  if (pull.exitCode !== 0) {
    console.error(`d211-capture: pull 失败\n${pull.stderr.toString()}`);
    process.exit(1);
  }
  const frame = new Uint8Array(readFileSync(rawPath));
  if (frame.length < BYTES) {
    console.error(`d211-capture: 帧缓冲读取不足（${frame.length}/${BYTES} 字节）`);
    process.exit(1);
  }

  // BMP：自底向上写入（BMP 原点在左下），像素保持 BGRA 顺序。
  const headerSize = 14 + 40;
  const bmp = new Uint8Array(headerSize + BYTES);
  const view = new DataView(bmp.buffer);
  bmp[0] = 0x42; // 'B'
  bmp[1] = 0x4d; // 'M'
  view.setUint32(2, bmp.length, true);
  view.setUint32(10, headerSize, true);
  view.setUint32(14, 40, true);
  view.setInt32(18, WIDTH, true);
  view.setInt32(22, HEIGHT, true);
  view.setUint16(26, 1, true);
  view.setUint16(28, 32, true);
  view.setUint32(34, BYTES, true);
  for (let row = 0; row < HEIGHT; row += 1) {
    const source = row * WIDTH * 4;
    const target = headerSize + (HEIGHT - 1 - row) * WIDTH * 4;
    bmp.set(frame.subarray(source, source + WIDTH * 4), target);
  }

  const bmpPath = join(temp, "frame.bmp");
  writeFileSync(bmpPath, bmp);
  const sips = Bun.spawnSync({ cmd: ["sips", "-s", "format", "png", bmpPath, "--out", output], stdout: "pipe", stderr: "pipe" });
  if (sips.exitCode !== 0) {
    console.error(`d211-capture: sips 转换失败\n${sips.stderr.toString()}`);
    process.exit(1);
  }
  console.log(`d211-capture: ${output}`);
} finally {
  rmSync(temp, { recursive: true, force: true });
}
