# VehicleState 与 Signal

本文说明 daemon 对外发布的唯一事实来源。线格式（字节序、字段顺序）见
`protocol.md`；UI 只读本模型的逻辑视图。

## 1. Signal 语义

```rust
Signal<T> { value: T, timestamp_ms: u64, quality: SignalQuality }
SignalQuality = Valid | Stale | Invalid | Unavailable
```

| 状态 | 触发条件 | UI 表现 |
| --- | --- | --- |
| `Valid` | 在超时窗口内更新 | 正常显示数值 |
| `Stale` | 超过 `signal_timeout_ms` 未更新（默认 500ms） | 显示 `--` 或灰色 |
| `Invalid` | 后端明确报告数据非法（保留值） | 显示故障样式 |
| `Unavailable` | 该信号尚无数据源 | 显示 `--` |

规则：

- **daemon 不重写旧值**；超时只降级 quality，value 保留最后一次采样。
- `evaluate_timeouts()` 每个 tick 执行一次，判定统一在 daemon 侧，UI 不做超时逻辑。

## 2. 字段清单

| 分组 | 字段 | 类型 | 参考仪表对应字段 |
| --- | --- | --- | --- |
| motion | `speed_kph` | f32 | `uintSpeed`（0.1 km/h 换算后） |
| motion | `direction` | Neutral/Forward/Reverse | `uintForwardGear` / `uintReverseGear` |
| motion | `parking_brake` | bool | `uintHandbrakeSwitch` |
| motion | `steer_angle_deg` | f32 | `sintWheelSteerAngle` |
| motion | `run_mode` | None/S/E/P | `uintRunMode` |
| battery | `soc_percent` | f32 | `uintSoc` / `uintBatterySoc` |
| battery | `voltage_v` | f32 | `floatBatteryVoltage` |
| battery | `current_a` | f32 | `floatBatteryCurrent`（含 32000 偏移解码） |
| motor | `rpm` | f32 | 牵引控制器转速 |
| motor | `temperature_c` | f32 | 电机温度（原始值 −40） |
| hydraulics | `pressure_mpa` | f32 | ADC GPAI7 标定后 |
| io | `seat_switch` | bool | `uintSeatSwitch` |
| io | `seatbelt` | bool | `uintSafebeltSwitch` |
| io | `key_on` | bool | 钥匙开关 |
| connectivity | `can_online` | bool | `boolCanCommunicationReceived` 派生 |
| connectivity | `camera_online` | bool | 相机后端健康 |
| vehicle | `odometer_km` | f32 | `uintOdometer` |
| vehicle | `work_hours` | f32 | `uintWorkhour` |
| vehicle | `controller_online[3]` | [bool; 3] | 牵引/油泵/转向控制器在线 |

尚未纳入第一版的参考字段（牵引/油泵计时、控制器软件版本、单体电池电压温度、
加热状态）在后续 milestone 按同一 `Signal` 模式补充，协议版本号随字段变化递增。

## 3. 数据流

```text
CAN 帧/ADC 采样
      ↓  解码（daemon 内部，UI 不可见）
VehicleUpdate（部分更新，None 字段保持旧值）
      ↓  VehicleModel::apply()
VehicleState（全部字段带 Signal）
      ↓  20–30 Hz 节流
STATE_VEHICLE
```

## 4. 更新节流

- 后端采样：CAN ≤100 Hz、ADC 每 500ms（当前实现）。
- 状态发布：`publish_hz`（默认 25 Hz）。
- 事件（故障、连接性）：状态变化立即发布，不受节流限制。
