# 开发手册

## 1. 环境

| 角色 | 要求 |
| --- | --- |
| macOS 主开发机 | Rust stable（`rustup`）、Git、GNU rsync（`brew install rsync`） |
| Linux builder | SSH 可达、Rust stable/rustup；后续承载 D211 交叉编译 |
| D211 实机 | Luban Linux + PocketJS host（见 M1 部署脚本） |

外网受限时：crates.io 可正常访问即可；不使用任何联网运行时功能。

## 2. 仓库结构

```text
protocol/    版本化 IPC（纯 Rust，无平台依赖）
daemon/      forkliftd：VehicleState/Fault/backends/IPC 服务
simulator/   forklift-sim：场景注入，复用 daemon 服务循环
ui/          PocketJS + Solid UI（M1 起）
host/        PocketJS 原生 platform bridge（M1 起）
tools/       构建/测试/部署脚本
docs/        架构、协议、功能与测试文档
```

## 3. 日常命令

```sh
cargo test --workspace                     # 本地测试（macOS 走流式兜底）
cargo clippy --workspace --all-targets -- -D warnings
cd ui && bun test                          # UI 协议金样 + 平台 API
bun tools/ui-sim-check.ts                  # Rust sim ↔ TS 平台层端到端
cargo run -p daemon -- --socket /tmp/forklift.sock
cargo run -p simulator -- --socket /tmp/forklift.sock --speed 12 --direction reverse
D211_REMOTE=user@host tools/test-remote.sh # Linux 权威测试
```

## 4. 工作流

```text
macOS 编辑
  → cargo test/clippy（快速）
  → tools/test-remote.sh（Linux 权威，SEQPACKET 原生路径）
  → git commit（Conventional Commits，保持 workspace 可编译）
  → M1 起：D211 交叉编译 + ADB 部署 + 真机验收
```

## 5. 编码规则

- **注释与文档字符串一律用中文；每个函数都必须有注释。**
- 库代码返回 `Result`；`unwrap()/expect()` 只允许出现在测试或不可达不变量处。
- `unsafe` 只允许集中在 `protocol/src/socket.rs` 与后续 backend/FFI 层。
- 业务模块（vehicle/fault/service）不得出现 `unsafe`，不得访问设备节点。
- 不使用 async runtime；阻塞 IO 用线程或 poll（D211 64 MB 约束）。
- 提交信息用 Conventional Commits：`feat(scope): ...`、`fix:`、`docs:` 等。
- 每次提交必须保证 `cargo test --workspace` 可编译通过。

## 6. D211 交叉编译（M1 计划）

复用 PocketJS D211 已验证的工具链组合：

```text
Luban GCC wrapper（Xuantie-900 V2.10.1 / gcc 10.4.0）+ Luban sysroot（glibc）
Rust nightly-2026-07-02，target riscv64gc-unknown-linux-gnu
最终链接使用 nightly 的 LLVM LLD（规避 binutils 2.35 的 RISC-V attributes 限制）
```

`tools/build-d211` 将负责 rsync → builder → 交叉编译 → 产物回传；
部署路径 `/opt/forklift/`，runtime 数据 `/var/lib/forklift/`，日志
`/var/log/forklift/`。
