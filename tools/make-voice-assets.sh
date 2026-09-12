#!/usr/bin/env bash
#
# 生成提示/报警语音资产：从参考工程迁移全部 10 种语言并重采样，随后重写
# ui/pak.json 的 audio:wav.* 原始块清单。
#
#   tools/make-voice-assets.sh
#
# 背景：
# - 参考语音为 24000 Hz 单声道 16bit；PocketJS 只允许 44100/22050/11025。
# - 设备 rootfs 只有 ~26MB 可用：中文与英文（界面可切换的语言）保持
#   22050 Hz，其余 8 种语言用 11025 Hz（完整覆盖，电话级语音质量）。
# - 开机音（44.1k 立体声 6s）降到 22050 Hz 以节省 ~0.5MB。
#
# 输入：参考工程 coustom/voice 与 audio（VOICE_REFERENCE_DIR / AUDIO_REFERENCE_DIR）。
# 输出：ui/assets/audio/voice-XX[-<lang>].wav、start.wav、pak.json。

set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
voice_reference="${VOICE_REFERENCE_DIR:-/Users/boa/Documents/dev/luban-lite-jc-d70t/packages/artinchip/lvgl-ui/aic_demo/meter_6_test/lvgl_src/lvgl_data/coustom/voice}"
audio_reference="${AUDIO_REFERENCE_DIR:-/Users/boa/Documents/dev/luban-lite-jc-d70t/packages/artinchip/lvgl-ui/aic_demo/meter_6_test/lvgl_src/lvgl_data/audio}"

if [[ ! -d "$voice_reference" ]]; then
  echo "make-voice-assets: 找不到语音目录 $voice_reference" >&2
  exit 1
fi

python3 - "$voice_reference" "$audio_reference" "$root" <<'PY'
import json
import os
import re
import struct
import sys
import wave

voice_reference, audio_reference, root = sys.argv[1], sys.argv[2], sys.argv[3]
out_dir = os.path.join(root, "ui/assets/audio")
os.makedirs(out_dir, exist_ok=True)

# 文件名后缀 -> (语言代码, 目标采样率)；空后缀为中文。
LANGUAGES = [
    ("", "zh", 22050),
    ("英", "en", 22050),
    ("俄", "ru", 11025),
    ("法", "fr", 11025),
    ("德", "de", 11025),
    ("韩", "ko", 11025),
    ("葡", "pt", 11025),
    ("西", "es", 11025),
    ("阿", "ar", 11025),
    ("日", "ja", 11025),
]


def read_mono(path):
    """读 WAV 为（单声道样本列表，采样率）；多声道取首声道。"""
    with wave.open(path, "rb") as source:
        channels = source.getnchannels()
        width = source.getsampwidth()
        rate = source.getframerate()
        frames = source.getnframes()
        data = source.readframes(frames)
    if width != 2:
        raise SystemExit(f"{path}: 只支持 16bit（实际 {width * 8}bit）")
    if channels > 1:
        samples = struct.unpack("<%dh" % (frames * channels), data)[::channels]
    else:
        samples = struct.unpack("<%dh" % frames, data)
    return list(samples), rate


def write_mono(path, samples, rate):
    """写单声道 16bit WAV。"""
    with wave.open(path, "wb") as sink:
        sink.setnchannels(1)
        sink.setsampwidth(2)
        sink.setframerate(rate)
        sink.writeframes(struct.pack("<%dh" % len(samples), *samples))


def resample(samples, rate, target):
    """线性重采样。"""
    if rate == target:
        return list(samples)
    ratio = target / rate
    out_frames = int(len(samples) * ratio)
    out = []
    for index in range(out_frames):
        position = index / ratio
        left = int(position)
        frac = position - left
        a = samples[left] if left < len(samples) else 0
        b = samples[left + 1] if left + 1 < len(samples) else a
        out.append(int(a + (b - a) * frac))
    return out


# 1) 语音：14 段 × 10 语言。
sources = {}
for name in sorted(os.listdir(voice_reference)):
    match = re.match(r"\[(\d+)\](.+)\.wav$", name)
    if not match:
        continue
    number = int(match.group(1))
    label = match.group(2)
    code = None
    for suffix, language, _ in LANGUAGES:
        if suffix and label.endswith(suffix):
            code = language
            break
    if code is None:
        code = "zh"
    sources.setdefault(code, {})[number] = os.path.join(voice_reference, name)

voice_files = []
for suffix, code, target in LANGUAGES:
    if code not in sources:
        print(f"make-voice-assets: 缺少 {code} 语音，跳过")
        continue
    for number in sorted(sources[code]):
        samples, rate = read_mono(sources[code][number])
        samples = resample(samples, rate, target)
        name = f"voice-{number:02d}" if code == "zh" else f"voice-{number:02d}-{code}"
        write_mono(os.path.join(out_dir, name + ".wav"), samples, target)
        voice_files.append((code, name))
    print(f"make-voice-assets: {code} {len(sources[code])} 段 -> {target}Hz")

# 2) 开机音：44.1k 立体声降到 22.05k（单声道，语音提示场景足够）。
start_source = os.path.join(audio_reference, "app_start_up.wav")
with wave.open(start_source, "rb") as source:
    channels = source.getnchannels()
    frames = source.getnframes()
    rate = source.getframerate()
    data = source.readframes(frames)
samples = list(struct.unpack("<%dh" % (frames * channels), data))[::channels]
write_mono(os.path.join(out_dir, "start.wav"), resample(samples, rate, 22050), 22050)
print(f"make-voice-assets: start {rate}Hz -> 22050Hz")

# 3) pak 原始块清单：btn + start + 全部语音。
entries = [
    {"key": "audio:wav.btn", "file": "assets/audio/btns.wav"},
    {"key": "audio:wav.start", "file": "assets/audio/start.wav"},
]
for _code, name in voice_files:
    entries.append({"key": f"audio:wav.{name}", "file": f"assets/audio/{name}.wav"})
with open(os.path.join(root, "ui/pak.json"), "w") as sink:
    json.dump(entries, sink, indent=2)
    sink.write("\n")
print(f"make-voice-assets: pak.json {len(entries)} 个原始块")
PY

echo "make-voice-assets: 完成 -> ui/assets/audio 与 ui/pak.json"
