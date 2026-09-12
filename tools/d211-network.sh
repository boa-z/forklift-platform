#!/usr/bin/env bash
#
# 部署 Wi-Fi 与 4G 的运行时配置到设备（可重复执行）。
#
#   tools/d211-network.sh                              # 推送脚本/工具并启动两条链路
#   D211_SSID=xxx D211_PSK=yyy tools/d211-network.sh   # 同时写入 Wi-Fi 凭据
#
# 说明：固件镜像已内置 S91wifi/S92lte/atsend 与 wpa 配置模板；本脚本用于
# 刷机后在设备侧更新脚本、写入实际 SSID/PSK，并立即拉起两条链路。

set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
dev="$root/tools/device"
atsend_bin="$root/dist/d211-tools/atsend"

# atsend：新固件已内置 /usr/bin/atsend；本地有交叉编译产物时同步一份（旧固件用）。
if [[ ! -x "$atsend_bin" && -n "${D211_REMOTE:-}" ]]; then
  echo "d211-network: 在 builder 交叉编译 atsend"
  ssh_opts=()
  [[ -n "${D211_REMOTE_PORT:-}" ]] && ssh_opts=(-p "$D211_REMOTE_PORT")
  scp "${ssh_opts[@]}" -q "$dev/atsend.c" "$D211_REMOTE:/tmp/atsend.c"
  ssh "${ssh_opts[@]}" "$D211_REMOTE" '
    set -e
    SDK="${D211_LUBAN_SDK:-$HOME/d211}"
    GCC=$(ls "$SDK"/output/d211_d70t_nand/host/bin/riscv64-*-gcc | head -1)
    "$GCC" -O2 -o /tmp/atsend /tmp/atsend.c'
  scp "${ssh_opts[@]}" -q "$D211_REMOTE:/tmp/atsend" "$atsend_bin"
fi

echo "d211-network: 推送 init 脚本"
adb push "$dev/S91wifi" /etc/init.d/S91wifi >/dev/null
adb push "$dev/S92lte" /etc/init.d/S92lte >/dev/null
adb shell "chmod +x /etc/init.d/S91wifi /etc/init.d/S92lte"
if [[ -x "$atsend_bin" ]]; then
  echo "d211-network: 推送 atsend"
  adb push "$atsend_bin" /usr/bin/atsend >/dev/null
  adb shell "chmod +x /usr/bin/atsend"
else
  echo "d211-network: 未构建 atsend（固件不含该产物）；S92lte 只等待 usb0，"
  echo "              不支持从出厂 RNDIS 自动切 ECM。设 D211_REMOTE 可交叉编译后重试。"
fi

if [[ -n "${D211_SSID:-}" && -n "${D211_PSK:-}" ]]; then
  echo "d211-network: 写入 /etc/wpa_supplicant.conf（ssid=$D211_SSID）"
  tmp="$(mktemp -t d211-wpa)"
  cat >"$tmp" <<EOF
country=CN
network={
    ssid="$D211_SSID"
    psk="$D211_PSK"
    key_mgmt=WPA-PSK
}
EOF
  adb push "$tmp" /etc/wpa_supplicant.conf >/dev/null
  rm -f "$tmp"
fi

echo "d211-network: 启动 Wi-Fi 与 4G"
adb shell "/etc/init.d/S91wifi restart >/dev/null 2>&1 || true; /etc/init.d/S92lte restart >/dev/null 2>&1 || true"
adb shell "sleep 6; ifconfig wlan0 2>/dev/null; ifconfig usb0 2>/dev/null"
echo "d211-network: 完成"
