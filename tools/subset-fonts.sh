#!/usr/bin/env bash
#
# 生成 UI 使用的 MiSans 子集字体（中文字形回退）。
#
#   tools/subset-fonts.sh
#
# 输入：ui/assets/fonts/charset.txt（由 tools/extract-charset.ts 从 data.bin 生成）
#      参考工程的 MiSans TTF（FONTS_REFERENCE_DIR 可覆盖）。
# 输出：ui/assets/fonts/MiSans-{Normal,Demibold}.subset.ttf
#
# 需要 python3 + fontTools（pip install fonttools）。

set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
reference="${FONTS_REFERENCE_DIR:-/Users/boa/Documents/dev/luban-lite-jc-d70t/packages/artinchip/lvgl-ui/aic_demo/meter_6_test/lvgl_src/lvgl_data/font}"
charset="$root/ui/assets/fonts/charset.txt"
output_dir="$root/ui/assets/fonts"

if [[ ! -f "$charset" ]]; then
  echo "subset-fonts: 缺少 $charset（先运行 bun tools/extract-charset.ts）" >&2
  exit 1
fi

for pair in "MiSans-Normal:MiSans-Normal" "MiSans-Demibold:MiSans-Demibold"; do
  source_name="${pair%%:*}"
  output_name="${pair##*:}"
  source="$reference/$source_name.ttf"
  if [[ ! -f "$source" ]]; then
    echo "subset-fonts: 找不到 $source（可用 FONTS_REFERENCE_DIR 指定字体目录）" >&2
    exit 1
  fi
  python3 -m fontTools.subset "$source" \
    --text-file="$charset" \
    --output-file="$output_dir/$output_name.subset.ttf" \
    --layout-features='kern,liga' \
    --no-hinting \
    --desubroutinize
  ls -la "$output_dir/$output_name.subset.ttf"
done

echo "subset-fonts: 完成 -> $output_dir"
