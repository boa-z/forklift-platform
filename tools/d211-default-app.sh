#!/usr/bin/env bash
#
# 把设备默认启动的应用切换为 PocketJS 叉车仪表。
#
#   tools/d211-default-app.sh            # 设为默认（禁用官方 demo）
#   tools/d211-default-app.sh --restore  # 恢复官方 test_lvgl demo
#
# 做了什么：
#   1. 推送 /etc/init.d/S99pocketjs（开机启动 /opt/pocketjs）；
#   2. 把官方 /etc/init.d/S00lvgl 改名 .disabled（不删除）；
#   3. 立即切换当前会话：杀掉 test_lvgl，启动我们的 app。
#
# 注意：改动落在设备 rootfs（可写、重启保留），重新烧录镜像会丢失；
# 本脚本可重复执行。

set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
init_script="$root/tools/device/S99pocketjs"
data_script="$root/tools/device/S98ubidata"

if [[ ! -f "$init_script" || ! -f "$data_script" ]]; then
  echo "d211-default-app: 缺少 tools/device/S99pocketjs 或 S98ubidata" >&2
  exit 1
fi

if [[ "${1:-}" == "--restore" ]]; then
  echo "d211-default-app: 恢复官方 test_lvgl demo"
  adb shell "killall -9 pocketjs-d211 2>/dev/null; \
    if [ -f /etc/init.d/S00lvgl.disabled ]; then mv /etc/init.d/S00lvgl.disabled /etc/init.d/S00lvgl; fi; \
    if [ -f /etc/init.d/S99pocketjs ]; then mv /etc/init.d/S99pocketjs /etc/init.d/S99pocketjs.disabled; fi; \
    /etc/init.d/S00lvgl start"
  echo "d211-default-app: 已恢复（重启后仍为官方 demo）"
  exit 0
fi

echo "d211-default-app: 推送 S98ubidata + S99pocketjs"
adb push "$data_script" /etc/init.d/S98ubidata >/dev/null
adb push "$init_script" /etc/init.d/S99pocketjs >/dev/null
adb shell "chmod +x /etc/init.d/S98ubidata /etc/init.d/S99pocketjs"
# 数据分区若尚未建立，由 tools/d211-data-partition.sh 负责；此处挂载已建立的卷。
adb shell "/etc/init.d/S98ubidata start >/dev/null 2>&1 || true"

echo "d211-default-app: 禁用官方 S00lvgl（改名保留，不删除）"
adb shell "[ -f /etc/init.d/S00lvgl ] && mv /etc/init.d/S00lvgl /etc/init.d/S00lvgl.disabled || true"

echo "d211-default-app: 立即切换"
adb shell "killall -9 pocketjs-d211 2>/dev/null; /etc/init.d/S99pocketjs restart"
sleep 2
adb shell "ps | grep pocketjs-d211 | grep -v grep" || {
  echo "d211-default-app: 启动失败，检查 /var/log/pocketjs.log" >&2
  exit 1
}

echo "d211-default-app: 完成（重启后默认启动 PocketJS；--restore 可还原）"
