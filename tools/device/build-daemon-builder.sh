#!/usr/bin/env bash
#
# 在 builder 上交叉编译 forkliftd/forkliftctl（由 tools/d211-deploy-daemon.sh 调用）。
#
# 编译用 Luban gcc + sysroot（glibc），最终链接用 Rust nightly 自带的 LLD：
# Luban binutils 2.35 无法解析现代 RISC-V ELF 属性（Zaamo/Zalrsc），
# 与 PocketJS d211 宿主相同的处理方式。

set -euo pipefail

source "$HOME/.cargo/env"

cd "$(dirname "${BASH_SOURCE[0]}")/../.."

toolchain="nightly-2026-07-02"
rust_lld="$(find "$HOME/.rustup/toolchains/${toolchain}-x86_64-unknown-linux-gnu" -name rust-lld | head -1)"
if [[ -z "$rust_lld" ]]; then
  echo "build-daemon-builder: 找不到 rust-lld（缺少 $toolchain）" >&2
  exit 1
fi

shim="$HOME/lld-shim"
mkdir -p "$shim"
ln -sf "$rust_lld" "$shim/ld.lld"
ln -sf ld.lld "$shim/riscv64-unknown-linux-gnu-ld.lld"

export CARGO_TARGET_RISCV64GC_UNKNOWN_LINUX_GNU_LINKER="$HOME/d211/output/d211_d70t_nand/host/bin/riscv64-unknown-linux-gnu-gcc"
export CARGO_TARGET_RISCV64GC_UNKNOWN_LINUX_GNU_RUSTFLAGS="-C link-arg=-B$shim -C link-arg=-fuse-ld=lld"

rustup run "$toolchain" cargo build --release --target riscv64gc-unknown-linux-gnu \
  -p forkliftd --bin forkliftd --bin forkliftctl

echo "build-daemon-builder: 产物 target/riscv64gc-unknown-linux-gnu/release/{forkliftd,forkliftctl}"
