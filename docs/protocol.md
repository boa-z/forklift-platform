# Forklift IPC 协议（protocol v5）

`protocol` crate 是 `forkliftd`、`forklift-sim`、集成测试与 PocketJS platform bridge
共用的唯一协议实现。本文档是测试与联调的对照表。

## 1. 传输

- `AF_UNIX` + `SOCK_SEQPACKET`，默认路径 `/run/forklift/forkliftd.sock`（开发用
  `--socket` 覆盖）。
- SEQPACKET 保留消息边界；接收方仍按帧头长度校验，截断/超长帧一律拒绝。
- 不允许 TCP、HTTP、WebSocket、gRPC、DBus。

## 2. 帧格式

16 字节头 + 小端 payload：

| 偏移 | 长度 | 字段 | 说明 |
| --- | --- | --- | --- |
| 0 | 4 | `magic` | `0x544B4C46`（`'F''L''K''T'` 小端） |
| 4 | 2 | `version` | 当前 `4`（v2 `battery.charging`，v3 `io.anti_dismantle`，v4 SoundId 语音表）；不等于本版本直接断开 |
| 6 | 2 | `message_type` | 见消息目录 |
| 8 | 4 | `payload_length` | 必须 ≤ `MAX_PAYLOAD`（64 KiB）且与实际长度一致 |
| 12 | 4 | `sequence` | 发送方递增序号，回包可据此对账 |

拒绝规则：magic 错、版本不支持、未知消息类型、payload 超限、长度不一致、载荷越界、
枚举值越界、非 UTF-8 字符串。

## 3. 握手与版本

```text
client                          daemon
  |  HELLO { client_version: 5 }  |
  |------------------------------>|
  |  SERVER_VERSION { 5 }         |
  |<------------------------------|
  |  STATE_* / EVENT_* ...        |
```

版本不一致时 daemon 回 `RESP_ERROR` 并断开；client（`protocol::Client::handshake`）
在 5 秒内未收到 `SERVER_VERSION` 或版本不符即报错，禁止静默继续。

## 4. 消息目录

方向：`D→C` daemon→client，`C→D` client→daemon。

| 类型码 | 名称 | 方向 | payload |
| --- | --- | --- | --- |
| 0x0001 | `HELLO` | C→D | `u16` client_version |
| 0x0002 | `CLIENT_VERSION` | C→D | `u16` |
| 0x0003 | `SERVER_VERSION` | D→C | `u16` |
| 0x0100 | `STATE_VEHICLE` | D→C | `VehicleState` |
| 0x0101 | `STATE_FAULTS` | D→C | `FaultSnapshot` |
| 0x0102 | `STATE_SYSTEM` | D→C | `SystemState` |
| 0x0200 | `EVENT_FAULT_RAISED` | D→C | `Fault` |
| 0x0201 | `EVENT_FAULT_CLEARED` | D→C | `Fault` |
| 0x0202 | `EVENT_CONNECTIVITY` | D→C | `ConnectivityEvent` |
| 0x0203 | `EVENT_SWIPE_REPORT` | D→C | 35B 刷卡上报（status/index/name/card/id/phone/驾照/IC 证） |
| 0x0204 | `EVENT_AUTH_STATE` | D→C | `u8` level（0 用户/1 管理员/2 超级管理员）+ `bool` authorized |
| 0x0205 | `EVENT_ANTI_DISMANTLE` | D→C | `bool` enabled + `bool` alarm |
| 0x0206 | `EVENT_RTC` | D→C | 6B：YY MM DD hh mm ss |
| 0x0300 | `CMD_PLAY_SOUND` | C→D | `u8` SoundId（0 Button/1 Warning/2 Reverse/3 Fault/4 Startup） |
| 0x0301 | `CMD_SET_VOLUME` | C→D | `u8` 0–100 |
| 0x0302 | `CMD_SET_BRIGHTNESS` | C→D | `u8` 0–100 |
| 0x0303 | `CMD_PING` | C→D | `u32` nonce |
| 0x0304 | `CMD_REPORT_POWER_ON` | C→D | `u8` kind（0 密码/1 刷卡/4 蓝牙）+ 4B 卡号 |
| 0x0305 | `CMD_SWIPE_REPLY` | C→D | `u8` 结果（0 成功） |
| 0x0306 | `CMD_VERIFY_PASSWORD` | C→D | 字符串密码；应答 `RESP_AUTH_LEVEL` |
| 0x0307 | `CMD_SET_ADMIN_PASSWORD` | C→D | 旧密码 + 新密码；应答 `RESP_OK`/`RESP_ERROR`(2001) |
| 0x0308 | `CMD_ENTER_LICENSE_TAIL` | C→D | 身份证后 4/6 位；应答 `RESP_ERROR`(2002/2003) 或不正确 |
| 0x0309 | `CMD_SET_ANTI_DISMANTLE` | C→D | `bool` enabled |
| 0x0400 | `RESP_OK` | D→C | 空 |
| 0x0401 | `RESP_ERROR` | D→C | `u16` code + 长度前缀字符串（≤128 字符） |
| 0x0402 | `RESP_PONG` | D→C | `u32` nonce |
| 0x0403 | `RESP_AUTH_LEVEL` | D→C | `u8` level（0/1/2） |

错误码：1001 协议/校验失败、1002 握手顺序或版本不满足、2001 改密失败、
2002 身份证尾号不正确、2003 无待认证刷卡。

## 5. VehicleState（0x0100）

固定顺序编码（全部小端）：

| 顺序 | 字段 | 类型 |
| --- | --- | --- |
| 1 | `timestamp_ms` | u64 |
| 2 | `motion.speed_kph` | Signal\<f32\> |
| 3 | `motion.direction` | Signal\<u8\>（0 Neutral/1 Forward/2 Reverse） |
| 4 | `motion.parking_brake` | Signal\<bool\> |
| 5 | `motion.steer_angle_deg` | Signal\<f32\> |
| 6 | `motion.run_mode` | Signal\<u8\>（0 无/1 S/2 E/3 P） |
| 7 | `battery.soc_percent` | Signal\<f32\> |
| 8 | `battery.voltage_v` | Signal\<f32\> |
| 9 | `battery.current_a` | Signal\<f32\> |
| 10 | `motor.rpm` | Signal\<f32\> |
| 11 | `motor.temperature_c` | Signal\<f32\> |
| 12 | `hydraulics.pressure_mpa` | Signal\<f32\> |
| 13 | `io.seat_switch` | Signal\<bool\> |
| 14 | `io.seatbelt` | Signal\<bool\> |
| 15 | `io.key_on` | Signal\<bool\> |
| 16 | `connectivity.can_online` | bool |
| 17 | `connectivity.camera_online` | bool |
| 18 | `vehicle.odometer_km` | Signal\<f32\> |
| 19 | `vehicle.work_hours` | Signal\<f32\> |
| 20 | `vehicle.controller_online[3]` | 3 × bool（traction/pump/steer） |

`Signal<T>` 编码：`value` + `timestamp_ms:u64` + `quality:u8`
（0 Valid / 1 Stale / 2 Invalid / 3 Unavailable）。**daemon 不重写超时值**，只把
quality 置为 Stale；UI 依据 quality 显示 `--`。

## 6. 事件与系统状态

- `Fault`：`id:u32`、`severity:u8`（0 Info/1 Warning/2 Critical）、`active:bool`、
  `first_seen_ms:u64`、`last_seen_ms:u64`、`occurrence_count:u32`。
  已定义 id：0x0001 motor_overheat、0x0002 battery_low、0x0003 can_offline、
  0x0004 adc_failure、0x0005 camera_offline、0x0006 audio_failure、0x0007 storage_failure。
- `FaultSnapshot`：`timestamp_ms` + `u16` 条数（≤64）+ 逐条 `Fault`。
- `SystemState`：`timestamp_ms`、`uptime_ms`、`health[5]`（can/adc/camera/audio/ipc，
  0 Healthy/1 Degraded/2 Failed/3 Unknown）、`rss_kb`、`mem_available_kb`。

## 7. 发布节流语义（daemon 侧约定）

- 内部信号更新 ≤100 Hz；`STATE_VEHICLE` 以 20–30 Hz 发布。
- `EVENT_*` 在状态变化时立即发送（故障产生/清除、方向切换、CAN/相机离线）。
- 单个状态帧远小于 4 KiB；IPC 禁止传输图像、音频 PCM、大资产。

## 8. 测试

```sh
cargo test -p protocol          # 帧 codec、消息 round trip、MCU 协议
```

覆盖：VehicleState/Fault/命令 round trip、金样帧头字节、坏 magic、未知版本、
超长 payload、截断帧、未知消息类型、长度不一致、Signal 超时语义，以及 MCU
XOR8 帧/刷卡上报/实时 TLV 的解码与重同步。
集成（sim ↔ client、刷卡与密码链路）见 `daemon/tests/ipc_integration.rs`。
