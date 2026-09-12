#!/usr/bin/env bash
#
# 把本仓库同步到 Linux builder，并在远端原生执行测试与 clippy。
#
# 为什么需要：macOS 不支持 AF_UNIX SOCK_SEQPACKET，本地走流式组帧兜底；
# D211 产品路径是 Linux + SEQPACKET，必须在 Linux 上验证权威结果。
#
#   D211_REMOTE=user@host tools/test-remote.sh
#   D211_REMOTE=user@host D211_REMOTE_PORT=2222 tools/test-remote.sh
#
# D211_REMOTE 必填；D211_REMOTE_PORT 可选（SSH 非默认端口时使用）。
# 需要 macOS 侧安装 GNU rsync（brew install rsync）。

set -euo pipefail

: "${D211_REMOTE:?请设置 D211_REMOTE（builder 的 user@host）}"
remote="$D211_REMOTE"
ssh_port=""
if [[ -n "${D211_REMOTE_PORT:-}" ]]; then
  ssh_port="-p $D211_REMOTE_PORT"
fi

# 端口参数需要按空格拆分；为空时不会产生多余参数。
remote_home="$(ssh $ssh_port "$remote" 'printf %s "$HOME"')"
remote_dir="${FORKLIFT_REMOTE_DIR:-$remote_home/forklift-platform}"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "forklift: 同步 $root -> $remote:$remote_dir"
rsync -az --delete \
  --exclude target \
  --exclude .git \
  -e "ssh $ssh_port" \
  "$root/" "$remote:$remote_dir/"

echo "forklift: 远端 cargo test + clippy"
ssh $ssh_port "$remote" \
  "bash -lc 'cd $remote_dir && cargo test --workspace && cargo clippy --workspace --all-targets -- -D warnings'"

echo "forklift: Linux 权威测试通过"
