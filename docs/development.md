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

UI 构建（必须在 **forklift-platform 仓库根**执行，不能从 PocketJS 目录执行）：

```sh
POCKETJS_ROOT=../pocketjs bun tools/ui-build-dev.ts
# 产物：dist/ui/forklift-main.js + forklift-main.pak
```

`ui-build-dev` 的前置条件与行为：

- `POCKETJS_ROOT` 指向完整且已 `bun install` 的 PocketJS 检出（不是随便的目录）；
- 脚本会预检检出完整性，缺少依赖时给出明确错误；
- 自动建立 `node_modules/@pocketjs/framework -> $POCKETJS_ROOT` 包链接，
  避免 `Could not resolve: "@pocketjs/framework/..."` 一类解析失败；
- 自动调用 `tools/bake-ui-assets.ts` 烘焙 2 的幂纹理（产物不入库）；
- 打印 PocketJS 提交号，便于回执追溯。

QuickJS 目标的 PocketJS 检出必须包含（合入前用对应分支，或包含这些提交的检出）：

| 依赖 | 内容 | 未合入前的分支 |
| --- | --- | --- |
| pocket-stack/pocketjs#414 | Solid 入口 scheduler globals（否则握手直接失败） | `fix/solid-scheduler-globals` |
| pocket-stack/pocketjs#407 | d211-linux 宿主移植（触摸/帧缓冲） | `feat/d211-linux` |
| pocket-stack/pocketjs#416 / #417 | quickjs-c 宿主模块钩子 + d211 音频/背光模块 | `feat/d211-host-modules`（含前两者） |

设备构建（宿主 + UI）用 `feat/d211-host-modules` 检出可以一次满足三条；
只构建 UI 时用 `tmp/d211-audio-valid`（本地临时合并分支）亦可。

## 4. 工作流

```text
macOS 编辑
  → cargo test/clippy（快速）
  → tools/test-remote.sh（Linux 权威，SEQPACKET 原生路径）
  → git commit（Conventional Commits，保持 workspace 可编译）
  → M1 起：D211 交叉编译 + ADB 部署 + 真机验收
```

## 5. D211 默认启动我们的 app

设备出厂由 `/etc/init.d/S00lvgl` 启动官方 `test_lvgl`。切换与还原：

```sh
tools/d211-default-app.sh            # 推送 S99pocketjs，禁用 S00lvgl（改名 .disabled），立即切换
tools/d211-default-app.sh --restore  # 还原官方 demo
```

- 脚本可重复执行；`S00lvgl` 只改名不删除；
- **test_lvgl 忽略 SIGTERM**，启动脚本用 SIGKILL 清场；应用用 `setsid` 脱离 shell 会话；
- 变更落在设备 rootfs，重启保留，**重新烧录镜像后丢失**（需重跑）；
- 日志：`/var/log/pocketjs.log`（tmpfs，重启清空）。

## 6. 编码规则

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
