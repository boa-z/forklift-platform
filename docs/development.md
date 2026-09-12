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
| pocket-stack/pocketjs#416 / #417 | quickjs-c 宿主模块钩子 + d211 音频/背光模块（含 pak mmap 与音频时钟修复） | `feat/d211-host-modules`（含前两者） |

设备构建（宿主 + UI）用 `feat/d211-host-modules` 检出可以一次满足三条；
只构建 UI 时用本地集成分支 `integration/d211`（`feat/d211-host-modules` 之上叠加 #414，线性历史）亦可。

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

## 6. 数据分区（/data）

D211 的 128MB NAND 上，mtd11（"ubisystem"，32MB）出厂未使用；参考工程用同类
分区承载 `/data/lvgl_data` 资源（构建期打成 FATFS 映像）。本产品把它做成
**UBI + UBIFS** 卷挂到 `/data`，`app.pak` 放在那里，OS 分区只留宿主二进制与入口：

```sh
D211_REMOTE=user@host tools/d211-data-partition.sh               # 首次建立（幂等）
D211_REMOTE=user@host tools/d211-data-partition.sh --deploy-pak  # 推送 dist pak 到 /data
```

- 开机挂载：`/etc/init.d/S98ubidata`（attach mtd11 + mount `ubi1_0`）；设备端工具
  （ubiformat/ubiattach/ubimkvol/ubiupdatevol）放在 `/opt/pocketjs/tools`；
  `tools/d211-data-partition.sh` 会从 builder 的 mtd-utils 构建缓存推送；
- `/etc/init.d/S99pocketjs` 在 `/data/pocketjs/app.pak` 存在时导出
  `POCKET_PAK` 指向它，否则回退 `/opt/pocketjs/app.pak`；
- 实测收益：pak（21.7MB）迁走后 rootfs 可用空间 17.7MB → **29MB**，
  `/data` 占用 20.2MB / 25.9MB；
- 现状：10 语言语音（zh/en 22.05kHz、其余 11.025kHz）全在 pak 内；
  若后续要提升采样率或加入大动画，可继续用 /data 余量或扩大卷。

UI 部署流程（有 /data 时）：

```sh
POCKETJS_ROOT=../pocketjs bun tools/ui-build-dev.ts
adb push dist/ui/forklift-main.js /opt/pocketjs/app.js
D211_REMOTE=user@host tools/d211-data-partition.sh --deploy-pak
```

## 7. 编码规则

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
