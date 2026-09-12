# D211 Forklift Instrument — Architecture Implementation Specification

1. 文档目的

本项目是在 ArtInChip D211DBV 平台上开发一套全新的叉车仪表软件系统。

硬件条件：

* SoC：ArtInChip D211DBV
* CPU：T-Head C906 / RV64GC
* RAM：64 MB DDR2
* LCD：800 × 480
* 输入：电容触摸屏
* 操作系统：Luban Linux
* 车辆接口：
    * CAN
    * ADC
    * GPIO
* 多媒体：
    * 摄像头视频输入
    * 音频播放
* UI Runtime：
    * PocketJS
    * 当前 D211 Linux host 已完成 fbdev + evdev + QuickJS + Rust Core 真机验证
    * 800×480 软件渲染当前性能约 60 FPS
* 开发模式：
    * macOS 主开发环境
    * 远程 Ubuntu x86_64 构建服务器
    * D211 真机部署测试

本阶段不以实现所有硬件功能为目标。

本阶段的目标是：

建立完整、稳定、可测试、可扩展的软件架构，使后续 CAN、ADC、Camera、Audio、Fault、GE2D 等功能只需要填充具体 backend，而不再修改系统总体架构。

⸻

2. 核心架构原则

必须遵守以下原则。

2.1 UI 与硬件彻底分离

PocketJS UI 不允许直接访问：

/dev/can*
/dev/iio*
/dev/video*
/dev/fb*
/dev/snd/*
ioctl
MPP
VIN
DE
GE
ALSA
SocketCAN

UI 只能访问稳定的 Forklift Platform API。

错误：

readCanFrame(0x301)
readAdc(3)
openCamera()

正确：

vehicle.speed
vehicle.soc
vehicle.direction
audio.play("warning")
system.setBrightness(80)

⸻

2.2 单一 native daemon

所有车辆平台能力集中在：

forkliftd

不要拆成：

cand
adcd
audiod
camerad
faultd

D211 只有 64 MB RAM，不需要微服务架构。

最终产品只要求两个主要业务进程：

forkliftd
forklift-ui

⸻

2.3 VehicleState 是唯一事实来源

CAN、ADC、GPIO 等底层数据必须先转换为：

VehicleState

然后再向 UI 发布。

UI 永远不能依赖：

CAN ID
CAN byte offset
ADC channel
GPIO number

⸻

2.4 Camera 是独立数据平面

摄像头像素数据禁止进入：

IPC
QuickJS
PocketJS
VehicleState

视频链路应最终采用：

Camera
  ↓
DVP
  ↓
VIN
  ↓
DMA-BUF / CMA
  ↓
DE Video Layer
  ↓
LCD

UI 仅负责：

倒车辅助线
警告文字
图标
按钮
透明 overlay

⸻

2.5 Hardware backend 可替换

业务层不得依赖 ArtInChip SDK。

例如：

CameraManager
    │
CameraBackend trait
    │
    ├── MockCameraBackend
    └── AicCameraBackend

CAN、ADC、Audio 同理。

⸻

3. 总体系统架构

┌──────────────────────────────────────────────────┐
│                 forklift-ui                      │
│                                                  │
│         TypeScript / Solid / PocketJS            │
│                                                  │
│   Screens / Components / Theme / Application     │
│                                                  │
│          @forklift/platform API                  │
└───────────────────────┬──────────────────────────┘
                        │
                        │ PocketJS HostOps
                        ▼
┌──────────────────────────────────────────────────┐
│           PocketJS D211 Linux Host               │
│                                                  │
│ fbdev │ evdev │ platform bridge │ lifecycle      │
│                                                  │
│             IPC Client                           │
└───────────────────────┬──────────────────────────┘
                        │
               Unix Domain Socket
                 SOCK_SEQPACKET
                        │
                        ▼
┌──────────────────────────────────────────────────┐
│                  forkliftd                       │
│                     Rust                         │
│                                                  │
│ VehicleState                                     │
│ FaultManager                                     │
│ CameraManager                                    │
│ AudioManager                                     │
│ CAN                                              │
│ ADC                                              │
│ GPIO                                             │
│ Config                                           │
│ Diagnostics                                      │
│ Watchdog                                         │
│ Persistence                                      │
│ IPC                                              │
└───────────────────────┬──────────────────────────┘
                        │
             Linux / ArtInChip backend
                        │
      ┌─────────────────┼─────────────────┐
      ▼                 ▼                 ▼
   SocketCAN           IIO              ALSA
      │                 │                 │
     CAN               ADC              Audio
Camera:
Camera → DVP → VIN → DMA-BUF → DE Video Layer
UI:
PocketJS → Software Renderer → fbdev → DE UI Layer
Final:
DE Video Layer + DE UI Layer → LCD

⸻

4. Repository 结构

创建独立 repository：

forklift-instrument/

禁止把产品业务代码放进 PocketJS upstream repository。

推荐结构：

forklift-instrument/
│
├── Cargo.toml
├── README.md
├── .gitignore
├── .editorconfig
│
├── daemon/
│   ├── Cargo.toml
│   └── src/
│       ├── main.rs
│       │
│       ├── app.rs
│       │
│       ├── vehicle/
│       │   ├── mod.rs
│       │   ├── state.rs
│       │   ├── signal.rs
│       │   └── policy.rs
│       │
│       ├── can/
│       │   ├── mod.rs
│       │   ├── backend.rs
│       │   ├── mock.rs
│       │   └── socketcan.rs
│       │
│       ├── adc/
│       │   ├── mod.rs
│       │   ├── backend.rs
│       │   ├── mock.rs
│       │   └── iio.rs
│       │
│       ├── camera/
│       │   ├── mod.rs
│       │   ├── backend.rs
│       │   ├── mock.rs
│       │   └── aic.rs
│       │
│       ├── audio/
│       │   ├── mod.rs
│       │   ├── backend.rs
│       │   ├── mock.rs
│       │   └── alsa.rs
│       │
│       ├── fault/
│       │   ├── mod.rs
│       │   ├── manager.rs
│       │   └── types.rs
│       │
│       ├── config/
│       │   ├── mod.rs
│       │   └── model.rs
│       │
│       ├── diagnostics/
│       │   ├── mod.rs
│       │   └── health.rs
│       │
│       ├── watchdog/
│       │   └── mod.rs
│       │
│       ├── persistence/
│       │   └── mod.rs
│       │
│       └── ipc/
│           ├── mod.rs
│           ├── server.rs
│           ├── codec.rs
│           └── connection.rs
│
├── protocol/
│   ├── Cargo.toml
│   └── src/
│       ├── lib.rs
│       ├── header.rs
│       ├── messages.rs
│       ├── state.rs
│       ├── event.rs
│       └── command.rs
│
├── simulator/
│   ├── Cargo.toml
│   └── src/
│       ├── main.rs
│       ├── scenario.rs
│       └── replay.rs
│
├── ui/
│   ├── package.json
│   ├── tsconfig.json
│   ├── src/
│   │   ├── main.tsx
│   │   ├── app.tsx
│   │   ├── screens/
│   │   ├── components/
│   │   ├── theme/
│   │   ├── state/
│   │   └── platform/
│   │       ├── index.ts
│   │       ├── vehicle.ts
│   │       ├── faults.ts
│   │       ├── audio.ts
│   │       └── system.ts
│   └── assets/
│
├── host/
│   ├── include/
│   │   └── forklift_platform.h
│   └── src/
│       ├── platform_bridge.c
│       ├── ipc_client.c
│       └── ipc_codec.c
│
├── aic/
│   ├── include/
│   └── src/
│       ├── camera_shim.c
│       ├── display_shim.c
│       └── ge_shim.c
│
├── bsp/
│   ├── defconfig/
│   ├── dts/
│   ├── patches/
│   ├── rootfs-overlay/
│   └── init/
│
├── tools/
│   ├── dev
│   ├── build
│   ├── build-d211
│   ├── deploy
│   ├── logs
│   ├── run-sim
│   ├── capture-can
│   └── replay-can
│
├── tests/
│   ├── integration/
│   ├── protocol/
│   └── hardware/
│
└── docs/
    ├── architecture.md
    ├── protocol.md
    ├── vehicle-state.md
    ├── hardware.md
    └── development.md

⸻

5. Rust Workspace

根目录：

[workspace]
resolver = "2"
members = [
    "daemon",
    "protocol",
    "simulator",
]

禁止把 D211-specific SDK 依赖传播到：

protocol
vehicle
fault
simulator

只有 backend 层可以依赖平台代码。

⸻

6. VehicleState 数据模型

建立稳定的数据模型。

第一版至少定义：

#[derive(Debug, Clone)]
pub struct VehicleState {
    pub timestamp_ms: u64,
    pub motion: MotionState,
    pub battery: BatteryState,
    pub motor: MotorState,
    pub hydraulics: HydraulicState,
    pub io: IoState,
    pub connectivity: ConnectivityState,
}

建议：

pub struct MotionState {
    pub speed_kph: Signal<f32>,
    pub direction: Signal<Direction>,
    pub parking_brake: Signal<bool>,
}
pub enum Direction {
    Neutral,
    Forward,
    Reverse,
}
pub struct BatteryState {
    pub soc_percent: Signal<f32>,
    pub voltage_v: Signal<f32>,
    pub current_a: Signal<f32>,
}
pub struct MotorState {
    pub rpm: Signal<f32>,
    pub temperature_c: Signal<f32>,
}
pub struct HydraulicState {
    pub pressure_mpa: Signal<f32>,
}
pub struct IoState {
    pub seat_switch: Signal<bool>,
    pub key_on: Signal<bool>,
}
pub struct ConnectivityState {
    pub can_online: bool,
    pub camera_online: bool,
}

⸻

7. Signal 模型

禁止直接使用裸值作为关键车辆信号。

定义：

pub struct Signal<T> {
    pub value: T,
    pub timestamp_ms: u64,
    pub quality: SignalQuality,
}
pub enum SignalQuality {
    Valid,
    Stale,
    Invalid,
    Unavailable,
}

作用：

CAN 正常：
speed = 12.4
quality = Valid
CAN 超时：
speed = 12.4
quality = Stale
传感器故障：
quality = Invalid

UI 根据 quality 决定是否显示：

12 km/h

或：

-- km/h

⸻

8. Backend Trait

所有硬件子系统必须定义 trait。

CAN

pub trait CanBackend: Send {
    fn poll(&mut self) -> Result<Vec<CanFrame>, CanError>;
}

实现：

MockCanBackend
SocketCanBackend

⸻

ADC

pub trait AdcBackend: Send {
    fn read_channel(&mut self, channel: AdcChannel)
        -> Result<f32, AdcError>;
}

实现：

MockAdcBackend
IioAdcBackend

⸻

Camera

pub trait CameraBackend: Send {
    fn start(&mut self) -> Result<(), CameraError>;
    fn stop(&mut self) -> Result<(), CameraError>;
    fn set_visible(&mut self, visible: bool)
        -> Result<(), CameraError>;
    fn health(&self) -> CameraHealth;
}

实现：

MockCameraBackend
AicCameraBackend

第一阶段 AicCameraBackend 可以只返回：

Unsupported

但接口必须存在。

⸻

Audio

pub trait AudioBackend: Send {
    fn play(&mut self, sound: SoundId)
        -> Result<(), AudioError>;
    fn stop(&mut self)
        -> Result<(), AudioError>;
    fn set_volume(&mut self, volume: u8)
        -> Result<(), AudioError>;
}

实现：

MockAudioBackend
AlsaAudioBackend

⸻

9. Fault Manager

Fault Manager 独立于 CAN decoder。

Fault 输入可以来自：

CAN DTC
CAN timeout
ADC threshold
camera offline
audio failure
storage failure
internal health failure

数据结构：

pub enum FaultSeverity {
    Info,
    Warning,
    Critical,
}
pub struct Fault {
    pub id: FaultId,
    pub severity: FaultSeverity,
    pub active: bool,
    pub first_seen_ms: u64,
    pub last_seen_ms: u64,
    pub occurrence_count: u32,
}

需要支持：

raise
clear
update
snapshot

暂时不实现持久化也可以，但接口必须设计好。

⸻

10. forkliftd Main Loop

不要采用复杂 async runtime，除非明确证明必要。

D211 只有 64 MB RAM。

优先：

poll / epoll
+
简单 worker

或者使用 Rust std thread。

第一版运行结构：

Main thread
│
├── CAN poll
├── ADC scheduler
├── VehicleState update
├── Fault evaluation
├── IPC
├── Camera policy
├── Audio command processing
└── health/watchdog

控制循环建议：

10–20 ms tick

VehicleState 不需要 1 kHz 更新。

⸻

11. CAN 更新策略

CAN backend：

CAN frame
    ↓
decoder
    ↓
VehicleState

第一阶段允许手写 decoder：

match frame.id {
    0x301 => decode_motor(frame),
    0x302 => decode_battery(frame),
    0x303 => decode_motion(frame),
    _ => {}
}

禁止 UI 知道这些 CAN ID。

⸻

12. UI publish 策略

硬件数据可能：

100 Hz

但 UI 不应收到 100 Hz IPC 更新。

建议：

VehicleState internal update
100 Hz maximum
UI state publish
20–30 Hz

对于以下事件：

fault raised
fault cleared
reverse entered
CAN offline
camera failure

立即发送 EVENT。

⸻

13. IPC 架构

使用：

AF_UNIX
SOCK_SEQPACKET

默认路径：

/run/forklift/forkliftd.sock

禁止：

TCP localhost
HTTP
WebSocket
gRPC
DBus

第一阶段协议必须是 versioned binary protocol。

⸻

14. IPC Header

统一 header：

#[repr(C)]
pub struct MessageHeader {
    pub magic: u32,
    pub version: u16,
    pub message_type: u16,
    pub payload_length: u32,
    pub sequence: u32,
}

建议：

magic = "FLKT"
protocol version = 1

所有整数必须明确字节序。

使用：

little endian

⸻

15. Message 分类

只允许：

STATE
EVENT
COMMAND
RESPONSE

第一版至少定义：

STATE_VEHICLE
STATE_FAULTS
STATE_SYSTEM
EVENT_FAULT_RAISED
EVENT_FAULT_CLEARED
EVENT_CONNECTIVITY
CMD_PLAY_SOUND
CMD_SET_VOLUME
CMD_SET_BRIGHTNESS
CMD_PING
RESP_OK
RESP_ERROR
RESP_PONG

Camera 是否显示原则上由 forkliftd policy 决定，而不是 UI。

⸻

16. IPC Versioning

协议必须从第一天支持版本。

例如：

ProtocolVersion = 1

连接后：

HELLO
CLIENT_VERSION
SERVER_VERSION

版本不兼容：

disconnect
+
log explicit error

禁止 silently continue。

⸻

17. PocketJS Platform API

UI 不直接看到 IPC。

创建：

@forklift/platform

公开 API：

vehicle.subscribe(...)
vehicle.getSnapshot()
faults.subscribe(...)
faults.getActive()
audio.play(...)
audio.setVolume(...)
system.setBrightness(...)
system.getState()

禁止暴露：

sendPacket()
socketWrite()
ipcCommand()

⸻

18. Host Bridge

PocketJS D211 host 增加 platform bridge：

PocketJS JS
    ↓
HostOps
    ↓
platform_bridge.c
    ↓
ipc_client.c
    ↓
forkliftd

platform bridge 只负责：

连接 daemon
编码 command
接收 state/event
转成 PocketJS JS value

禁止 platform bridge 直接访问 CAN/ADC/Camera。

⸻

19. Simulator

创建：

forklift-sim

Simulator 必须实现与：

forkliftd

兼容的 IPC protocol。

这样：

Mac PocketJS
     │
     ▼
forklift-sim

与：

D211 PocketJS
     │
     ▼
forkliftd

对于 UI 是完全相同的。

⸻

20. Simulator CLI

至少支持：

forklift-sim \
    --speed 12 \
    --soc 55 \
    --rpm 1500 \
    --direction reverse

并支持动态 scenario。

例如：

scenario/reverse.yaml

描述：

0s   speed=5
2s   direction=reverse
5s   fault=motor_overheat
8s   CAN offline

格式自行选择，但不要过度设计。

⸻

21. Camera Architecture

正式架构必须保持：

Camera
 ↓
DVP
 ↓
VIN
 ↓
DMA-BUF
 ↓
DE Video Layer

严禁：

Camera
 ↓
CPU memcpy
 ↓
PocketJS texture

Camera backend 由：

forkliftd

控制。

Reverse policy：

VehicleState.direction == Reverse
            ↓
     CameraManager
            ↓
DE Video Layer visible

同时：

VehicleState
 ↓
UI
 ↓
ReverseOverlay

因此 camera critical path 不经过 QuickJS。

⸻

22. Display Architecture

当前：

PocketJS
 ↓
software raster
 ↓
ARGB8888
 ↓
fbdev
 ↓
DE UI Layer

保持不变。

Camera：

VIN
 ↓
DE Video Layer

最终：

Video Layer
+
UI Layer
 ↓
DE
 ↓
LCD

⸻

23. GE2D Architecture

当前阶段：

不实现完整 GE2D renderer

但架构必须保留位置。

未来：

PocketJS DrawList
     ↓
Renderer Backend
     ├── Software
     └── ArtInChip GE

GE backend 不允许成为当前产品功能依赖。

只有 profiling 证明软件 renderer 是瓶颈后才启用。

Camera 需要：

rotate
scale
format conversion

时允许优先使用 GE。

⸻

24. Audio Architecture

第一阶段目标：

WAV / PCM
 ↓
ALSA
 ↓
D211 audio codec

不要一开始集成完整 multimedia player。

AudioManager 负责：

button
warning
reverse
fault
startup

定义：

pub enum SoundId {
    Button,
    Warning,
    Reverse,
    Fault,
    Startup,
}

⸻

25. Configuration

配置目录：

/etc/forklift/

例如：

/etc/forklift/forklift.toml

配置包括：

CAN interface
signal timeout
ADC calibration
volume
brightness
camera enable
log level

业务代码禁止硬编码产品参数。

⸻

26. Runtime Data

可写运行时数据：

/var/lib/forklift/

例如：

fault history
settings
device state

日志：

/var/log/forklift/

如果 rootfs/storage 策略不允许持久日志，则后续可修改 backend。

路径先统一。

⸻

27. Logging

Rust 使用：

log

或轻量 tracing。

日志必须包含：

timestamp
level
module
message

例如：

INFO  can       CAN interface online
WARN  vehicle   speed signal stale
ERROR camera    VIN stream failed

禁止无结构：

printf("xxx failed\n")

产品代码里不要使用大量 debug println。

⸻

28. Error Handling

库代码：

Result<T, Error>

应用边界统一记录错误。

不要：

unwrap()
expect()

除：

测试
明确 impossible invariant

daemon 不允许因为一个 CAN decode error 直接退出。

⸻

29. Process Lifecycle

正常运行：

forkliftd
forklift-ui

UI crash：

forklift-ui restart
forkliftd 保持运行

forkliftd crash：

必须被 init 重启

设计 rootfs init：

/etc/init.d/S90forkliftd
/etc/init.d/S91forklift-ui

第一阶段可以只生成脚本，不要求马上部署。

⸻

30. Watchdog

最终硬件 watchdog 由：

forkliftd

管理。

绝不能由：

forklift-ui

kick watchdog。

第一阶段设计：

pub trait WatchdogBackend {
    fn feed(&mut self) -> Result<(), WatchdogError>;
}

实现：

MockWatchdog
LinuxWatchdog

⸻

31. Health Model

定义：

pub struct SystemHealth {
    pub can: HealthState,
    pub adc: HealthState,
    pub camera: HealthState,
    pub audio: HealthState,
    pub ipc: HealthState,
}
pub enum HealthState {
    Healthy,
    Degraded,
    Failed,
    Unknown,
}

Watchdog policy 后续基于这些状态判断。

⸻

32. Build Environment

开发结构：

macOS
  ↓ SSH
Ubuntu x86_64 build server
  ↓ cross compile
D211

Mac 用于：

UI
Rust coding
Simulator
Tests
Git

Ubuntu 用于：

Luban SDK
D211 cross compilation
QuickJS target build
PocketJS native host
final artifacts

⸻

33. Build Scripts

统一提供：

./tools/dev

作用：

启动 simulator
启动 PocketJS development UI

⸻

./tools/build

作用：

native host build / tests

⸻

./tools/build-d211

作用：

同步源码到 remote builder
交叉编译
下载 artifacts

⸻

./tools/deploy

作用：

上传 forkliftd
上传 forklift-ui
restart
stream logs

脚本必须：

set -euo pipefail

并提供清晰错误信息。

⸻

34. Target Artifacts

最终 D211 应生成：

forkliftd
forklift-ui

以及：

assets/
config/
init scripts

开发阶段部署：

/opt/forklift/bin/forkliftd
/opt/forklift/bin/forklift-ui
/opt/forklift/assets/

不要使用 /tmp 存放长期 runtime 文件。

⸻

35. Testing Strategy

必须建立三层测试。

Unit

测试：

VehicleState
Signal timeout
CAN decoder
ADC filter
Fault manager
IPC codec
protocol version

⸻

Integration

测试：

simulator
 ↓
IPC
 ↓
client

验证：

state publish
events
commands
reconnect
version mismatch

⸻

Hardware

后续：

CAN
ADC
Camera
Audio
Touch
Display

硬件测试不能成为普通 CI 必需条件。

⸻

36. IPC 必须测试的异常情况

至少覆盖：

daemon unavailable
UI disconnect
UI reconnect
partial packet
invalid magic
unsupported version
invalid message type
oversized payload
daemon restart
client restart

SOCK_SEQPACKET 本身保留 message boundary，但仍需验证 payload length。

⸻

37. Payload Size

协议第一版设置：

MAX_PAYLOAD = 64 KiB

正常 VehicleState 应远小于：

4 KiB

禁止通过 IPC 传：

camera frame
image
large asset
audio PCM

⸻

38. Security / Robustness

本项目虽然不是互联网服务，但 IPC 仍需：

检查 magic
检查 version
检查 length
检查 enum range
拒绝 malformed packet

任何外部数据：

CAN
ADC
IPC
config

均不能假定永远合法。

⸻

39. Performance Budget

800×480 / 60 FPS：

frame budget = 16.67 ms

PocketJS software renderer 当前性能已经明显低于该值。

产品目标：

UI render p95 < 8 ms
最好 < 5 ms

IPC state publish：

20–30 Hz

Critical event：

立即推送

Camera 像素：

0 copy into JS

⸻

40. Memory Budget

D211：

64 MB DDR2

架构必须避免：

Electron
Chromium
large daemon count
camera frame IPC copy
large JSON message flood
large asset preload

第一阶段需要增加 runtime memory telemetry：

VmRSS
MemAvailable

至少可以通过 diagnostics 输出。

⸻

41. Coding Rules

Rust：

rustfmt
clippy
no unnecessary unsafe
no global mutable state

C：

仅用于：
ArtInChip SDK binding
PocketJS host bridge

禁止把业务逻辑重新写入 C。

TypeScript：

strict = true

禁止：

any

除明确 platform boundary。

⸻

42. Unsafe Boundary

Rust 中所有：

unsafe

必须集中在：

backend
ffi
syscall wrapper

业务模块：

vehicle
fault
policy

原则上不允许出现 unsafe。

⸻

43. 本阶段需要实际实现的内容

Codex 本轮需要完成完整架构骨架，而不是仅生成目录。

必须实现：

Rust workspace
protocol crate
forkliftd runnable daemon
VehicleState
Signal model
Fault manager skeleton
backend traits
mock CAN
mock ADC
mock Camera
mock Audio
IPC server
IPC protocol codec
IPC reconnect handling
simulator
PocketJS platform TypeScript API
PocketJS native IPC bridge skeleton
configuration loader
logging
health state
build scripts
test skeleton
documentation

⸻

44. 本阶段允许 stub 的内容

以下允许暂时不接真实硬件：

SocketCAN
Linux IIO
AIC VIN
AIC DE
ALSA
watchdog
GE2D

但：

trait、模块、错误类型、生命周期和调用路径必须完整存在。

例如：

pub struct AicCameraBackend;

可以：

Err(CameraError::Unsupported)

但不能完全没有 camera architecture。

⸻

45. 第一条必须真正跑通的链路

本阶段必须完成：

forklift-sim
      ↓
VehicleState
speed = 12.3
soc = 56
direction = Reverse
      ↓
IPC
      ↓
PocketJS platform bridge
      ↓
TypeScript API
      ↓
UI

UI 至少显示：

Speed
SOC
Direction

并支持 simulator 修改后实时更新。

⸻

46. 第二条必须跑通的链路

UI：

audio.play("button")

实际路径：

PocketJS
 ↓
Host bridge
 ↓
IPC CMD_PLAY_SOUND
 ↓
forkliftd
 ↓
MockAudioBackend

日志：

MockAudioBackend: play Button

验证 command 方向协议正常。

⸻

47. 第三条必须跑通的链路

Simulator 注入：

motor_overheat

路径：

simulator
 ↓
FaultManager
 ↓
EVENT_FAULT_RAISED
 ↓
UI
 ↓
显示 warning

⸻

48. 第一阶段完成标准

只有以下全部满足才认为 Architecture Phase 完成：

cargo test --workspace
PASS
cargo clippy --workspace
PASS
forkliftd 可以独立运行
forklift-sim 可以独立运行
PocketJS UI 可以连接 simulator
VehicleState 更新正常
UI command → daemon 正常
Fault event 正常
daemon 重启后 UI 可 reconnect
UI 重启不影响 daemon

并存在：

docs/architecture.md
docs/protocol.md
docs/development.md

⸻

49. 当前阶段明确不做

不要实现：

GE2D PocketJS renderer
完整 camera driver
完整 CAN DBC
完整 ADC calibration
完整 audio asset system
OTA
云端
Bluetooth
Wi-Fi application logic
数据库
复杂用户系统
完整 diagnostics UI

这些进入后续 milestone。

⸻

50. 后续里程碑

完成本架构后按以下顺序继续：

M1
真实 SocketCAN backend
M2
真实 IIO ADC backend
M3
Fault / timeout / vehicle policy
M4
DVP → VIN → DE Video Layer
M5
PocketJS transparent overlay + camera
M6
ALSA audio backend
M7
真实叉车完整 UI
M8
startup / watchdog / recovery
M9
persistence / diagnostics
M10
24h / 72h soak test
M11
系统 profiling
M12
根据 profiling 决定是否实现 GE2D renderer

⸻

51. Codex 执行要求

Codex 在修改代码时遵循：

1. 先建立完整 workspace 和模块边界。
2. 每完成一个模块立即添加测试。
3. 不为未来功能过度设计。
4. 不绕过已经定义的 abstraction。
5. 不允许 UI 直接访问硬件。
6. 不允许 Camera frame 经 IPC。
7. 不把产品代码加入 PocketJS upstream repository。
8. 所有 platform-specific code 集中到 backend / host / aic 层。
9. 保持 D211 64 MB RAM 约束。
10. 优先简单、确定性的实现。
11. 每次提交必须保持 workspace 可编译。
12. 所有 public API 添加文档。
13. 所有 TODO 必须说明原因，禁止模糊 TODO。
14. 不使用大而复杂的 runtime/framework，除非有明确技术理由。
15. 在实现和本文档冲突时，以本文档的架构边界为准。

⸻

52. 推荐首批 Commit

建议按以下 commit 顺序提交：

feat: initialize forklift instrument workspace
feat(protocol): add versioned IPC protocol
feat(daemon): add vehicle state and signal model
feat(daemon): add platform backend interfaces
feat(daemon): add IPC server
feat(simulator): add forklift simulator
feat(ui): add forklift platform API
feat(host): add PocketJS platform IPC bridge
feat(fault): add fault manager
feat(config): add runtime configuration
feat(diag): add health diagnostics
test: add IPC integration tests
build: add Mac and D211 build scripts
docs: add architecture and development documentation

⸻

53. 最终架构约束总结

整个产品始终保持：

Hardware
   ↓
Linux / AIC Backend
   ↓
forkliftd
   ↓
VehicleState / Fault / Policy
   ↓
Versioned IPC
   ↓
PocketJS Platform API
   ↓
Application UI

Camera 是唯一特殊的数据路径：

Camera
 ↓
VIN
 ↓
DMA
 ↓
DE Video Layer

UI：

PocketJS
 ↓
DE UI Layer

最终：

Video Layer + UI Layer
         ↓
         DE
         ↓
      800×480

本阶段首要目标不是实现所有硬件功能，而是确保：

后续任何硬件功能的加入，都不再需要改变上述架构。
