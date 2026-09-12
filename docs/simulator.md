# forklift-sim 模拟器

`forklift-sim` 与 `forkliftd` 使用同一服务循环与 IPC 协议，差别只在 CAN 后端：
模拟器按时间线修改一辆虚拟叉车并编码为临时 CAN 帧，从而完整经过解码、策略与
发布链路。macOS 上的 UI 联调不需要真实硬件。

## 1. 运行

```sh
# 固定值
cargo run -p simulator -- --socket /tmp/forklift.sock \
    --speed 12 --soc 56 --direction reverse --rpm 1500

# 时间线场景
cargo run -p simulator -- --socket /tmp/forklift.sock --scenario scenario/reverse.toml
```

## 2. 命令行参数

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `--socket PATH` | `/tmp/forklift.sock` | IPC 路径 |
| `--speed F` | 0 | 初始车速 km/h |
| `--soc F` | 80 | 初始电量 % |
| `--rpm F` | 0 | 初始电机转速 |
| `--direction S` | neutral | forward / reverse / neutral |
| `--scenario FILE` | 无 | 场景文件（TOML） |
| `--tick_ms N` | 20 | 服务循环周期 |
| `--publish_hz N` | 25 | 状态发布频率 |

## 3. 场景文件

```toml
# scenario/reverse.toml — 倒车与过热演示
[[step]]
at_ms = 0
speed_kph = 5
direction = "forward"

[[step]]
at_ms = 2000
direction = "reverse"
speed_kph = 3

[[step]]
at_ms = 5000
fault = "motor_overheat"

[[step]]
at_ms = 8000
fault = "can_offline"

[[step]]
at_ms = 12000
fault = "recover"
```

| 字段 | 说明 |
| --- | --- |
| `at_ms` | 相对模拟开始的毫秒数；步骤按时间排序 |
| `speed_kph` / `soc_percent` / `rpm` / `motor_temp_c` | 直接写入虚拟车辆 |
| `direction` | `forward` / `reverse` / `neutral` |
| `fault` | `motor_overheat`（温度 95℃）、`battery_low`（SOC 10%）、`can_offline`（停止发帧）、`recover`（恢复正常） |

非法方向或故障名会在首次执行时报错并记录日志，服务继续运行。

## 4. UI 联调流程

```text
终端 A: cargo run -p simulator -- --socket /tmp/forklift.sock --speed 12 --soc 56
终端 B: （PocketJS UI 连接到 /tmp/forklift.sock）
```

观测点：

- `STATE_VEHICLE` 的 `speed_kph=12.0` 在 UI 上实时显示；
- 执行 `direction = reverse` 后，daemon 侧出现 `MockCameraBackend: video layer visible`；
- `fault = motor_overheat` 后，客户端收到 `EVENT_FAULT_RAISED` 且 UI 显示警告。

## 5. 与 daemon 的差异

| 项 | forklift-sim | forkliftd |
| --- | --- | --- |
| CAN 来源 | 场景时间线 | SocketCAN / Mock |
| ADC/Camera/Audio | mock | 真实后端或 mock |
| IPC/协议/服务循环 | 完全相同 | 完全相同 |

因此 UI 侧无法区分两者，这是 `implementation-plan.md` §2.1 的验收前提。
