#!/usr/bin/env bash
#
# 生成主屏大数字贴图：车速（54px，白/橙/红）与 SOC 数值（36px，白）。
#
#   tools/make-number-assets.sh
#
# 背景：PocketJS 字库槽位按字号整体烘焙，54px/36px 两档仅用于数字，
# 但每个槽位要带全部中文字形（~1.8MB + 0.8MB）。用数字贴图替代后
# 字库只剩小字号中文，省 ~2.6MB 纹理内存（64MB 设备的 OOM 临界）。
#
# 输入：ui/assets/fonts/MiSans-Demibold.subset.ttf
# 输出：ui/assets/reference/numbers/{speed54,speed54w,speed54c,soc36}-*.png

set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
font="$root/ui/assets/fonts/MiSans-Demibold.subset.ttf"

if [[ ! -f "$font" ]]; then
  echo "make-number-assets: 缺少 $font（先运行 tools/subset-fonts.sh）" >&2
  exit 1
fi

python3 - "$font" "$root" <<'PY'
import os
import sys

from PIL import Image, ImageDraw, ImageFont

font_path, root = sys.argv[1], sys.argv[2]
out_dir = os.path.join(root, "ui/assets/reference/numbers")
os.makedirs(out_dir, exist_ok=True)

# (前缀, 字号, 颜色, 字符集)
sets = [
    ("speed54", 54, (245, 247, 250, 255), "0123456789.-"),
    ("speed54w", 54, (245, 158, 11, 255), "0123456789.-"),
    ("speed54c", 54, (239, 68, 68, 255), "0123456789.-"),
    ("soc36", 36, (245, 247, 250, 255), "0123456789%-"),
]
name_for = {".": "dot", "%": "pct", "-": "dash"}
for prefix, size, color, chars in sets:
    font = ImageFont.truetype(font_path, size)
    for char in chars:
        canvas = Image.new("RGBA", (size * 2, size * 2), (0, 0, 0, 0))
        draw = ImageDraw.Draw(canvas)
        draw.text((size // 2, size // 3), char, font=font, fill=color)
        bbox = canvas.getbbox()
        assert bbox is not None, f"{prefix} {char} 渲染为空"
        name = name_for.get(char, char)
        canvas.crop(bbox).save(os.path.join(out_dir, f"{prefix}-{name}.png"))
        print(f"{prefix}-{name}.png", canvas.crop(bbox).size)
PY

echo "make-number-assets: 完成"
