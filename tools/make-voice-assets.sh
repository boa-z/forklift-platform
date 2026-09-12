#!/usr/bin/env bash
#
# 生成提示/报警语音资产：从参考工程复制 14 段中文语音并重采样到 22050 Hz。
#
#   tools/make-voice-assets.sh
#
# 背景：参考语音为 24000 Hz，PocketJS 音频规范只允许 44100/22050/11025；
# 语音是单声道 16bit，线性重采样即可（工具避免依赖 sox/audioop）。
#
# 输入：参考工程 coustom/voice（VOICE_REFERENCE_DIR 可覆盖）。
# 输出：ui/assets/audio/voice-01..14.wav（22050 Hz 单声道 16bit）。

set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
reference="${VOICE_REFERENCE_DIR:-/Users/boa/Documents/dev/luban-lite-jc-d70t/packages/artinchip/lvgl-ui/aic_demo/meter_6_test/lvgl_src/lvgl_data/coustom/voice}"
out="$root/ui/assets/audio"

if [[ ! -d "$reference" ]]; then
  echo "make-voice-assets: 找不到语音目录 $reference" >&2
  exit 1
fi

mkdir -p "$out"
python3 - "$reference" "$out" <<'PY'
import os
import re
import struct
import sys
import wave

reference, out_dir = sys.argv[1], sys.argv[2]
TARGET_RATE = 22050
# 中文文件名没有语言后缀；有后缀的是其他语言（后续按需扩展）。
SUFFIXES = ("英", "俄", "法", "德", "韩", "葡", "西", "阿", "日")

files = {}
for name in sorted(os.listdir(reference)):
    match = re.match(r"\[(\d+)\](.+)\.wav$", name)
    if not match:
        continue
    number = int(match.group(1))
    label = match.group(2)
    localized = label.endswith(SUFFIXES)
    if localized:
        continue
    files[number] = os.path.join(reference, name)

for number in sorted(files):
    with wave.open(files[number], "rb") as source:
        channels = source.getnchannels()
        width = source.getsampwidth()
        rate = source.getframerate()
        frames = source.getnframes()
        data = source.readframes(frames)
    if width != 2:
        raise SystemExit(f"voice-{number:02d}: 只支持 16bit（实际 {width * 8}bit）")
    # 多声道按首声道降为单声道（参考语音本身是单声道）。
    if channels > 1:
        samples = struct.unpack("<%dh" % (frames * channels), data)
        samples = samples[::channels]
    else:
        samples = struct.unpack("<%dh" % frames, data)
    # 线性重采样。
    if rate != TARGET_RATE:
        ratio = TARGET_RATE / rate
        out_frames = int(len(samples) * ratio)
        resampled = []
        for index in range(out_frames):
            position = index / ratio
            left = int(position)
            frac = position - left
            a = samples[left] if left < len(samples) else 0
            b = samples[left + 1] if left + 1 < len(samples) else a
            resampled.append(int(a + (b - a) * frac))
        samples = resampled
    target = os.path.join(out_dir, f"voice-{number:02d}.wav")
    with wave.open(target, "wb") as sink:
        sink.setnchannels(1)
        sink.setsampwidth(2)
        sink.setframerate(TARGET_RATE)
        sink.writeframes(struct.pack("<%dh" % len(samples), *samples))
    print(f"voice-{number:02d}.wav {rate}Hz -> {TARGET_RATE}Hz, {len(samples)} frames")
PY

echo "make-voice-assets: 完成 -> $out"
