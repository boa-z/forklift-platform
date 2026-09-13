#!/usr/bin/env bash
#
# 交叉编译并把 forkliftd/forkliftctl 部署到 D211 设备。
#
#   D211_REMOTE=user@host tools/d211-deploy-daemon.sh
#   D211_REMOTE=user@host D211_REMOTE_PORT=2233 tools/d211-deploy-daemon.sh
#
# 步骤：rsync 仓库到 builder → 交叉编译（Luban gcc + Rust LLD）→ 产物回传 →
# adb 推送二进制、/etc/forklift.toml 与 /etc/init.d/S90forkliftd → 重启服务。
#
# 前置：builder 有 Rust nightly-2026-07-02 与 riscv64gc target、Luban SDK；
# 设备可 adb 连接。

set -euo pipefail

: "${D211_REMOTE:?请设置 D211_REMOTE（builder 的 user@host）}"
remote="$D211_REMOTE"
ssh_port=()
scp_port=(-P "${D211_REMOTE_PORT:-22}")
if [[ -n "${D211_REMOTE_PORT:-}" ]]; then
  ssh_port=(-p "$D211_REMOTE_PORT")
fi

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
remote_repo="${D211_REMOTE_REPOSITORY:-forklift-platform}"
dist="${root}/dist/d211-daemon"
mkdir -p "$dist"

echo "d211-deploy-daemon: 同步仓库到 builder"
rsync -az --delete --exclude target --exclude node_modules --exclude .git --exclude dist \
  --exclude .pocket-build -e "ssh ${D211_REMOTE_PORT:+-p $D211_REMOTE_PORT}" \
  "$root/" "$remote:~/$remote_repo/"

echo "d211-deploy-daemon: 交叉编译"
ssh "${ssh_port[@]}" "$remote" "bash ~/$remote_repo/tools/device/build-daemon-builder.sh"

echo "d211-deploy-daemon: 回传产物"
scp "${scp_port[@]}" -q \
  "$remote:~/$remote_repo/target/riscv64gc-unknown-linux-gnu/release/forkliftd" \
  "$remote:~/$remote_repo/target/riscv64gc-unknown-linux-gnu/release/forkliftctl" \
  "$dist/"

echo "d211-deploy-daemon: 推送到设备"
adb shell "mkdir -p /opt/forklift"
adb push "$dist/forkliftd" /opt/forklift/forkliftd >/dev/null
adb push "$dist/forkliftctl" /opt/forklift/forkliftctl >/dev/null
adb push "$root/tools/device/forklift.toml" /etc/forklift.toml >/dev/null
adb push "$root/tools/device/S90forkliftd" /etc/init.d/S90forkliftd >/dev/null
adb shell "chmod +x /opt/forklift/forkliftd /opt/forklift/forkliftctl /etc/init.d/S90forkliftd"

echo "d211-deploy-daemon: 启动服务"
adb shell "/etc/init.d/S90forkliftd restart; sleep 1; ps | grep forkliftd | grep -v grep; cat /var/log/forkliftd.log | awk \"NR<=20\""
echo "d211-deploy-daemon: 完成（forkliftctl --socket /run/forklift/forkliftd.sock settings 可自检）"
