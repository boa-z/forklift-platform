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

# Linux builder 权威测试（原生 SOCK_SEQPACKET，与 D211 一致）
D211_REMOTE=user@host tools/test-remote.sh

# 启动场景模拟器（IPC 服务端）
cargo run -p simulator -- --socket /tmp/forklift.sock \
    --speed 12 --soc 56 --direction reverse

# 启动 daemon（mock 后端）
cargo run -p daemon -- --socket /tmp/forklift.sock

# 构建 UI guest bundle（在仓库根执行，PocketJS 检出需先 bun install）
POCKETJS_ROOT=../pocketjs bun tools/ui-build-dev.ts
```

## 文档

| 文档 | 内容 |
| --- | --- |
| `docs/architecture-spec.md` | 总体架构与边界（权威） |
| `docs/implementation-plan.md` | 实施细化、阶段与范围裁剪 |
| `docs/protocol.md` | IPC 线格式与消息目录 |
| `docs/vehicle-state.md` | Signal 与 VehicleState 字段语义 |
| `docs/daemon.md` | forkliftd 模块、循环、故障规则、配置 |
| `docs/simulator.md` | 场景模拟器与 UI 联调 |
| `docs/testing.md` | 测试分层、运行方式与验收清单 |
| `docs/development.md` | 环境、工作流与编码规则 |
| `docs/ui-inventory.md` | 参考仪表 UI 复刻清单 |

产品代码不进入 PocketJS upstream；D211 交叉编译复用 Luban SDK 与 LLD bridge，
见 `docs/development.md` §6（M1 提供 `tools/build-d211`）。
