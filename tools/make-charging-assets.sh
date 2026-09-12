#!/usr/bin/env bash
#
# 生成充电屏素材：SOC 数字（90px）与充电动画帧（裁切到内容区）。
#
#   tools/make-charging-assets.sh
#
# 输入：参考工程的充电帧（CHARGING_REFERENCE_DIR 可覆盖）与
#       ui/assets/fonts/MiSans-Normal.subset.ttf。
# 输出：ui/assets/reference/digits/{0..9}.png
#       ui/assets/reference/charging/charging-XX.png（3 帧，按 16 帧间隔采样）
#
# 需要 python3 + Pillow。

set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
reference="${CHARGING_REFERENCE_DIR:-/Users/boa/Documents/dev/luban-lite-jc-d70t/packages/artinchip/lvgl-ui/aic_demo/meter_6_test/lvgl_src/lvgl_data/charging}"
font="$root/ui/assets/fonts/MiSans-Normal.subset.ttf"

if [[ ! -f "$font" ]]; then
  echo "make-charging-assets: 缺少 $font（先运行 tools/subset-fonts.sh）" >&2
  exit 1
fi
if [[ ! -d "$reference" ]]; then
  echo "make-charging-assets: 找不到充电帧目录 $reference" >&2
  exit 1
fi

python3 - "$reference" "$font" "$root" <<'PY'
import glob
import os
import sys

from PIL import Image, ImageDraw, ImageFont

reference, font_path, root = sys.argv[1], sys.argv[2], sys.argv[3]
digits_dir = os.path.join(root, "ui/assets/reference/digits")
charging_dir = os.path.join(root, "ui/assets/reference/charging")
os.makedirs(digits_dir, exist_ok=True)
os.makedirs(charging_dir, exist_ok=True)

# SOC 数字：90px 白字，裁到内容包围盒（PIL 无 hinting 时字形与原字体一致）。
font = ImageFont.truetype(font_path, 90)
for digit in "0123456789":
    canvas = Image.new("RGBA", (140, 140), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)
    draw.text((12, 8), digit, font=font, fill=(252, 252, 252, 255))
    bbox = canvas.getbbox()
    assert bbox is not None
    canvas.crop(bbox).save(os.path.join(digits_dir, f"digit-{digit}.png"))
print(f"digits: 10 个 -> {digits_dir}")

# 充电帧：全部 50 帧的联合包围盒为 (180,0)-(624,478)；按 16 帧间隔取 3 帧
# （64 MB 设备的内存约束：每帧 512×512 纹理）。
bbox = (180, 0, 625, 479)
frames = sorted(glob.glob(os.path.join(reference, "*.jpg")))
assert len(frames) >= 34, f"充电帧数量异常: {len(frames)}"
for index in range(0, 48, 16):
    image = Image.open(frames[index]).convert("RGB").crop(bbox)
    image.save(os.path.join(charging_dir, f"charging-{index + 1:02d}.png"))
    print(f"charging-{index + 1:02d}.png {image.size}")
PY

echo "make-charging-assets: 完成"
