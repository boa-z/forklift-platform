#!/usr/bin/env bash
#
# 构建并部署 D211 设备调试工具（当前为 d211-touch 触摸注入）。
# 交叉编译在 Linux builder 上用 PocketJS 已验证的 Luban 工具链完成。
#
#   D211_REMOTE=user@host tools/d211-tools.sh
#
# 依赖：GNU rsync、builder 上的 Luban SDK（默认 ~/d211，可用 D211_LUBAN_SDK 覆盖）。

set -euo pipefail

: "${D211_REMOTE:?请设置 D211_REMOTE（builder 的 user@host）}"
remote="$D211_REMOTE"
ssh_port=""
if [[ -n "${D211_REMOTE_PORT:-}" ]]; then
  ssh_port="-p $D211_REMOTE_PORT"
fi

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ -n "${D211_LUBAN_SDK:-}" ]]; then
  gcc="$D211_LUBAN_SDK/output/d211/host/bin/riscv64-unknown-linux-gnu-gcc"
else
  gcc="\$HOME/d211/output/d211/host/bin/riscv64-unknown-linux-gnu-gcc"
fi

echo "d211-tools: 同步源码到 $remote"
ssh $ssh_port "$remote" "mkdir -p ~/d211-tools"
rsync -az -e "ssh $ssh_port" "$root/tools/d211-touch.c" "$remote:~/d211-tools/"

echo "d211-tools: 交叉编译"
ssh $ssh_port "$remote" "\"$gcc\" -Os -static -o ~/d211-tools/d211-touch ~/d211-tools/d211-touch.c"

echo "d211-tools: 回传并推送到设备"
mkdir -p "$root/dist/d211-tools"
rsync -az -e "ssh $ssh_port" "$remote:~/d211-tools/d211-touch" "$root/dist/d211-tools/"
adb push "$root/dist/d211-tools/d211-touch" /opt/pocketjs/d211-touch
adb shell "chmod +x /opt/pocketjs/d211-touch"
echo "d211-tools: /opt/pocketjs/d211-touch 就绪"
