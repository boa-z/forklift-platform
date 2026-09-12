# forkliftd 守护进程

`forkliftd` 是唯一的车辆平台进程：全部硬件能力收敛为 `VehicleState`，通过
versioned IPC 提供给 UI。本文是开发、联调与测试的对照说明。

## 1. 模块与边界

```text
daemon/src/
├── main.rs          入口：参数、配置、后端选择、IPC 绑定
├── service.rs       服务循环：采样 → 策略 → 命令 → 发布
├── vehicle.rs       VehicleUpdate → VehicleState（唯一的模型入口）
├── fault.rs         故障规则与滞回，独立于 CAN 解码
├── config.rs        forklift.toml 加载（未知键报错）
├── diagnostics.rs   时钟与 /proc 内存遥测
├── ipc.rs           多客户端 IPC 服务端（握手后才进广播表）
└── backends/
    ├── can.rs       CanBackend + SocketCAN(stub) + Mock + 临时解码器
    ├── adc.rs       AdcBackend + IIO(stub) + Mock
    ├── camera.rs    CameraBackend + AIC(stub) + Mock
    ├── audio.rs     AudioBackend + ALSA(stub) + Mock
    └── watchdog.rs  WatchdogBackend + Linux(stub) + Mock
```

**业务模块（vehicle/fault/service）不允许出现 unsafe，也不允许直接访问
设备节点**；平台差异只存在于 backends。

## 2. 服务循环时序（默认 20ms）

```text
tick:
  1. sample_can()      读取 CAN 帧，解码并合并进 VehicleState
  2. sample_adc()      每 500ms 读取液压压力
  3. evaluate_timeouts() 超时信号降级为 Stale
  4. apply_camera_policy() 倒车显示视频层（变化时才调用后端）
  5. evaluate_faults() 规则判定，产生事件
  6. handle_commands() 播放/音量/亮度命令
  7. feed_watchdog()   每 1s 喂狗
  8. publish()         状态节流发布 + 每秒系统状态
```

## 3. 故障规则（Skeleton）

| 故障 | id | 条件 | 清除条件 |
| --- | --- | --- | --- |
| 低电量 | 0x0002 | SOC Valid 且 < 20% | SOC ≥ 25%（滞回） |
| 电机过热 | 0x0001 | 温度 Valid 且 > 80℃ | 温度 < 75℃（滞回） |
| CAN 离线 | 0x0003 | 超过 `signal_timeout_ms` 无帧 | 恢复收帧 |
| 相机离线 | 0x0005 | 倒车请求视频且相机不健康 | 相机恢复或退出倒车 |

规则参数后续迁移到配置；`raise` 只在状态从 inactive → active 时产生
`EVENT_FAULT_RAISED`，重复触发只更新 `last_seen` 与 `occurrence_count`。

## 4. 临时 CAN 解码（待替换）

`backends/can.rs` 中的 0x301/0x302/0x303 是**占位矩阵**，用于打通链路：

| ID | 内容 | 编码 |
| --- | --- | --- |
| 0x301 | 电机 | rpm u16 LE、温度 u8（+40 偏移） |
| 0x302 | 电池 | SOC u8(%)、电压 u16(0.1V)、电流 i16(0.1A) |
| 0x303 | 运动 | 速度 u16(0.1km/h)、方向 u8、转向 i8、模式 u8、手刹 u8 |

真实车型 CAN 矩阵确认后只替换 decoder 与 mock 编码，`VehicleState` 与 UI 不变。

## 5. 配置（`/etc/forklift/forklift.toml`，命令行 `--config` 可覆盖）

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `socket_path` | `/run/forklift/forkliftd.sock` | IPC 路径 |
| `can_interface` | `can0` | SocketCAN 接口名 |
| `signal_timeout_ms` | 500 | 信号超时阈值 |
| `tick_ms` | 20 | 服务循环周期 |
| `publish_hz` | 25 | 状态发布频率 |
| `volume` | 70 | 启动音量 |
| `brightness` | 80 | 启动亮度 |
| `camera_enable` | true | 倒车相机策略开关 |
| `use_mock_hardware` | true | true=全部 mock；false=真实后端 |
| `log_level` | info | 日志级别（RUST_LOG 可覆盖） |

未知键会拒绝启动（防止拼写错误静默生效）。

## 6. 运行

```sh
# 默认 mock 后端
cargo run -p daemon -- --socket /tmp/forklift.sock

# 查看日志（结构化，模块名为 target）
RUST_LOG=can=debug,fault=debug cargo run -p daemon -- --socket /tmp/forklift.sock
```

退出：`Ctrl-C`（当前版本不处理信号，进程直接结束；M8 加入优雅退出）。
