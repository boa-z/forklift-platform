# forklift-platform

D211DBV 叉车仪表软件平台。架构与边界见 `docs/architecture-spec.md`，实施细化见
`docs/implementation-plan.md`，UI 复刻范围见 `docs/ui-inventory.md`。

## 目录

```text
protocol/     versioned binary IPC（Rust）
daemon/       forkliftd：VehicleState / Fault / backend traits / IPC server
simulator/    forklift-sim：场景注入，走与 daemon 相同的 IPC
ui/           PocketJS + Solid 仪表 UI（@forklift/platform）
host/         PocketJS 原生 platform bridge（C）
aic/          ArtInChip 后端 shim（VIN/DE/GE，后续里程碑）
bsp/          rootfs overlay 与 init 脚本
tools/        本地与 D211 构建/部署脚本
tests/        集成与硬件测试
docs/         架构、协议、开发文档
```

## 快速开始

```sh
# 本机（macOS）单元与集成测试
cargo test --workspace

# 启动场景模拟器（IPC 服务端）
cargo run -p simulator -- --socket /tmp/forklift.sock \
    --speed 12 --soc 56 --direction reverse

# 启动 daemon（mock 后端）
cargo run -p daemon -- --socket /tmp/forklift.sock
```

产品代码不进入 PocketJS upstream；D211 交叉编译复用 Luban SDK 与 LLD bridge，
见 `tools/build-d211`（M1 提供）。
