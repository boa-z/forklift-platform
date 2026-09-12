#!/usr/bin/env bash
#
# 在 D211 上建立数据分区并部署 pak。
#
#   D211_REMOTE=user@host tools/d211-data-partition.sh              # 首次建立（幂等）
#   D211_REMOTE=user@host tools/d211-data-partition.sh --deploy-pak # 推送 dist pak 到 /data
#
# 背景：D211 NAND 128MB，出厂镜像把 mtd11（"ubisystem"，32MB）留空未用。
# 本脚本把它格式化为 UBI + UBIFS 卷并挂到 /data（参考工程用同样的分区承载
# /data/lvgl_data 资源），随后 app.pak 从 OS 分区迁到 /data：
#   - OS 分区只留宿主二进制与入口；
#   - 大素材（语音/动画）放 /data，与参考工程的部署模型一致。
#
# 前置：builder 可访问互联网（拉取 mtd-utils 源）与 Luban 工具链（D211_LUBAN_SDK
# 或默认 ~/d211）。设备端 mount 需要内核 UBIFS（已启用）。

set -euo pipefail

: "${D211_REMOTE:?请设置 D211_REMOTE（builder 的 user@host）}"
remote="$D211_REMOTE"
ssh_port=""
if [[ -n "${D211_REMOTE_PORT:-}" ]]; then
  ssh_port="-p $D211_REMOTE_PORT"
fi

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tools_dir="$root/tools/device"

if [[ "${1:-}" == "--deploy-pak" ]]; then
  pak="$root/dist/ui/forklift-main.pak"
  [[ -f "$pak" ]] || { echo "d211-data-partition: 缺少 $pak（先构建 UI）" >&2; exit 1; }
  adb shell "mkdir -p /data/pocketjs"
  adb push "$pak" /data/pocketjs/app.pak
  adb shell "sync; df -h /data | awk 'NR<=2'"
  echo "d211-data-partition: pak 已部署到 /data/pocketjs/app.pak"
  exit 0
fi

echo "d211-data-partition: 在 builder 构建 mtd-utils 工具（缓存于 ~/mtd-utils-build）"
ssh $ssh_port "$remote" 'bash -s' <<'REMOTE'
set -e
build="$HOME/mtd-utils-build"
if [[ ! -x "$build/cross/ubi-utils/ubiformat" ]]; then
  mkdir -p "$build"
  cd "$build"
  if [[ ! -f mtd-utils_2.2.0.orig.tar.xz ]]; then
    curl -sO --max-time 120 http://archive.ubuntu.com/ubuntu/pool/main/m/mtd-utils/mtd-utils_2.2.0.orig.tar.xz
  fi
  rm -rf cross native
  mkdir cross native
  tar xf mtd-utils_2.2.0.orig.tar.xz -C cross --strip-components=1
  tar xf mtd-utils_2.2.0.orig.tar.xz -C native --strip-components=1
  (cd cross && ./autogen.sh >/dev/null 2>&1 || autoreconf -fi >/dev/null 2>&1)
  (cd native && ./autogen.sh >/dev/null 2>&1 || autoreconf -fi >/dev/null 2>&1)
  export PATH="${D211_LUBAN_SDK:-$HOME/d211}/output/d211/host/bin:$PATH"
  (cd cross && ./configure --host=riscv64-unknown-linux-gnu --without-xattr --without-zstd \
      --without-lzo --without-crypto --without-ubifs CC=riscv64-unknown-linux-gnu-gcc >/dev/null && make -j4 >/dev/null)
  (cd native && ./configure --without-xattr --without-zstd --without-lzo --without-crypto >/dev/null && make -j4 mkfs.ubifs >/dev/null)
fi
echo "d211-data-partition: builder 工具就绪"
REMOTE

echo "d211-data-partition: 推送目标侧工具到 /opt/pocketjs/tools"
adb shell "mkdir -p /opt/pocketjs/tools"
for tool in ubiformat ubiattach ubimkvol ubiupdatevol ubidetach; do
  scp -P "${D211_REMOTE_PORT:-22}" -q "$remote:$HOME/mtd-utils-build/cross/ubi-utils/$tool" "/tmp/$tool" 2>/dev/null \
    || scp -P "${D211_REMOTE_PORT:-22}" -q "$remote:~/mtd-utils-build/cross/ubi-utils/$tool" "/tmp/$tool"
  adb push "/tmp/$tool" "/opt/pocketjs/tools/$tool" >/dev/null
done
adb shell "chmod +x /opt/pocketjs/tools/*"

if adb shell "[ -e /dev/ubi1 ]" 2>/dev/null; then
  echo "d211-data-partition: UBI1 已存在，跳过格式化"
else
  echo "d211-data-partition: 格式化 mtd11 -> UBI1 -> 卷 data"
  adb shell "/opt/pocketjs/tools/ubiformat /dev/mtd11 -y >/dev/null 2>&1"
  adb shell "/opt/pocketjs/tools/ubiattach -m 11 >/dev/null 2>&1"
  adb shell "/opt/pocketjs/tools/ubimkvol /dev/ubi1 -N data -m >/dev/null"
  echo "d211-data-partition: 写入空 UBIFS 镜像"
  ssh $ssh_port "$remote" 'mkdir -p /tmp/ubifs-empty && cd ~/mtd-utils-build/native && ./mkfs.ubifs -m 2048 -e 126976 -c 247 -x none -r /tmp/ubifs-empty /tmp/ubifs-empty.img >/dev/null'
  scp -P "${D211_REMOTE_PORT:-22}" -q "$remote:/tmp/ubifs-empty.img" /tmp/ubifs-empty.img
  adb push /tmp/ubifs-empty.img /tmp/ubifs-empty.img >/dev/null
  adb shell "/opt/pocketjs/tools/ubiupdatevol /dev/ubi1_0 /tmp/ubifs-empty.img"
fi

echo "d211-data-partition: 安装 S98ubidata 并挂载"
adb push "$tools_dir/S98ubidata" /etc/init.d/S98ubidata >/dev/null
adb shell "chmod +x /etc/init.d/S98ubidata; /etc/init.d/S98ubidata start >/dev/null; df -h /data | awk 'NR<=2'"

echo "d211-data-partition: 完成（pak 用 --deploy-pak 推送；启动脚本 S99pocketjs 会自动优先 /data）"
