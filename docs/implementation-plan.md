# Forklift Instrument — 实施计划（architecture-spec 细化）

本文档是 `architecture-spec.md` 的实施细化与范围裁剪记录。**架构边界以 spec 为准**；本文只补充可执行决策、阶段划分与验收口径。

## 1. 范围结论

本轮（Architecture Phase）交付：

- 完整可编译的 Rust workspace：`protocol` / `daemon` / `simulator`
- 可运行的 `forkliftd`（mock CAN/ADC/Camera/Audio）与 `forklift-sim`
- versioned binary IPC + 集成测试
- `@forklift/platform` TypeScript API（含 transport 抽象）
- PocketJS 原生 host bridge 骨架（产品侧）
- 构建脚本（macOS 本地与 D211 交叉）与文档

本轮不做：

- 联网：4G、WiFi、远程 OTA、云、蓝牙、RFID 云端校验（参考工程中的 `CommonNet*`、`Common4GDriver`、`App_Meter_BleHandle` 不迁移）
- 真实硬件后端：SocketCAN / IIO / VIN / DE / ALSA / 硬件 watchdog 仅保留 trait 与 `Unsupported` 实现
- GE2D renderer（按 spec §23）

## 2. 对 architecture-spec 的补充决策

### 2.1 UI transport 抽象（补充 §13/§17）

UI 不直连 IPC，但 `@forklift/platform` 内部需要可替换 transport，才能覆盖三种运行形态：

| 形态 | transport | 用途 |
| --- | --- | --- |
| macOS 开发 | `MockTransport`（内存场景） | UI 不依赖 daemon 的快速迭代 |
| macOS + simulator | `UnixSocketTransport`（Bun 侧实现协议编解码） | 验证 sim→UI 全链路 |
| D211 | `HostBridgeTransport`（HostOps 注入） | 产品形态 |

三种 transport 共享同一份消息类型定义；TypeScript 侧的 codec 与 Rust `protocol` crate 用同一组 golden 字节做交叉测试。

### 2.2 原生 platform bridge 的落点（补充 §18）

- 产品代码不放 PocketJS upstream。
- PocketJS 侧需要一个**通用扩展点**（HostOps 服务/扩展注入），用于把宿主自有 API 暴露给 JS；该 hook 的设计与实现单独在 PocketJS 仓库提交（通用能力，不含产品逻辑）。
- 产品 side 在 `host/` 实现 `forklift_platform.h`：`forkliftd` 连接、命令编码、state/event 分发、JS value 转换。
- 第一阶段允许 `HostBridgeTransport` 先在 simulator 链路验证，bridge 接 `forkliftd` 在 M1 完成。

### 2.3 D211 交叉编译（补充 §32/§33）

Rust 侧复用 PocketJS D211 已验证的工具链组合：

```text
Luban GCC wrapper (Xuantie-900 V2.10.1 / gcc 10.4.0)
+ Luban sysroot (glibc, lp64d)
+ Rust nightly-2026-07-02, target riscv64gc-unknown-linux-gnu
+ 最终链接使用 nightly 的 LLVM LLD（绕过 binutils 2.35 的 RISC-V attributes 限制）
```

`tools/build-d211` 负责 rsync → Ubuntu builder → cross build → 产物回传，沿用 `D211_REMOTE` / `D211_LUBAN_SDK` 环境约定。

### 2.4 资产管道（补充 §34）

- 参考资产为 PNG/JPG/TTF/WAV（`lvgl_src/lvgl_data/`，571 个文件，约 70 MB）。
- PNG/JPG → 按屏幕裁剪/压缩后进入 PocketJS pak；不必要的启动动画视频与联网图标不迁移。
- TTF → 使用 PocketJS 字体子集/烘焙工具生成 atlas；v1 只发布 zh-CN 文案，i18n 表结构预留。
- 指针/仪表类连续图形用图像叠加 + 旋转，旋转方案见 §5.3 的 spike 结论。

### 2.5 Signal 超时策略（补充 §7）

`Signal<T>` 增加：

```rust
pub fn age_ms(&self, now_ms: u64) -> u64;
pub fn evaluate(&mut self, now_ms: u64, timeout_ms: u64) -> SignalQuality;
```

超时判定放在 daemon 更新循环（20 ms tick），UI 只读 `quality`。

### 2.6 IPC client 复用（补充 §19/§45）

`protocol` crate 同时提供 `Client`（阻塞式）供 simulator、集成测试与 host bridge 参考实现复用，避免三处各自实现帧解析。

## 3. 里程碑

| 里程碑 | 内容 | 验收 |
| --- | --- | --- |
| M0 架构骨架 | workspace、protocol、daemon（mock）、simulator、IPC、测试 | `cargo test/clippy` 通过；sim→client 跑通 |
| M1 UI P1 | 主界面 + 状态栏 + 菜单栏 + 主题 | 800×480 真机显示，速度/SOC/方向实时更新 |
| M2 UI P2 | 设置、监控、故障、自检、充电、密码、移除、加力屏 | 各屏静态复刻 + 数据绑定，导航闭环 |
| M3 真实后端 | SocketCAN / IIO / ALSA / 摄像头 policy | 有硬件条件下逐项接入 |
| M4 产品化 | init 脚本、watchdog、日志、soak | 72h 无重启/无泄漏 |

## 4. UI 复刻策略

屏幕与资产清单见 `ui-inventory.md`。

- 阶段 P1：主屏（车速/电量/转向/档位/状态图标）、顶部状态栏、底部菜单栏、全局主题与字体。
- 阶段 P2：设置、监控（CAN 数据页）、故障诊断、自检、充电、密码/授权/移除、加力屏。
- 阶段 P3：摄像头屏（无信号占位，等待 VIN/DE 链路）与本地文件升级屏（去掉联网部分）。
- 不可用功能（相机像素、RFID 校验）在 UI 中以明确的离线状态呈现，不伪造数据。

### 4.1 主屏数据映射（参考 → VehicleState）

| 参考字段 | VehicleState |
| --- | --- |
| `uintSpeed` | `motion.speed_kph` |
| `uintForwardGear` / `uintReverseGear` | `motion.direction` |
| `uintHandbrakeSwitch` | `motion.parking_brake` |
| `uintSoc` / `floatBatteryVoltage` / `floatBatteryCurrent` | `battery.soc_percent` / `voltage_v` / `current_a` |
| `uintRunMode` / `uintRunStatus` | `motion.run_mode`（枚举待定） |
| `uintSeatSwitch` / `uintSafebeltSwitch` | `io.seat_switch` / `io.seatbelt` |
| `sintWheelSteerAngle` | `motion.steer_angle_deg` |
| `uintWorkhour*` / `uintOdometer` | `vehicle.work_hours` / `vehicle.odometer` |
| `boolTractor/Pump/SteerControllerReceived` | `connectivity.can_online` 与各控制器 health |

### 4.2 待补充到 VehicleState 的字段

参考 UI 需要的以下字段不在 spec §6 初版中，实施时补充：`run_mode`、`steer_angle_deg`、`seatbelt`、`work_hours`、`odometer`、控制器级 `controller_status[3]`。

### 4.3 仪表绘制的 spike

PocketJS 无圆弧图元。候选：

1. 表盘背景 PNG + 指针 PNG 按角度预烘焙（12/24 帧）；
2. 若框架支持旋转（`TEX_TRI`），用单张指针图实时旋转；
3. 为 PocketJS 增加通用 `<Gauge>` 组件（RECT/TEX_TRI 组合）。

M1 开始前用半天 spike 选定；不动 PocketJS core 语义。

## 5. 验收与测试

- Unit：Signal timeout、CAN decoder、ADC filter、Fault manager、IPC codec、协议版本
- Integration：sim → IPC → client（state/event/command/reconnect/version mismatch）
- Hardware（后续）：CAN/ADC/Camera/Audio/Touch/Display
- 任何一项 24h soak 未做之前不进入量产状态
