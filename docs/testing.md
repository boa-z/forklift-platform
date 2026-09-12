# 测试与验收

三层测试对应 `architecture-spec.md` §35。硬件测试不进入普通 CI。

## 1. 单元与集成现状

| 层 | 位置 | 用例数 | 覆盖 |
| --- | --- | --- | --- |
| protocol 线格式 | `protocol/tests/wire.rs` | 12 | round trip、金样帧头、坏 magic/版本/类型/长度、超长、截断、Signal 超时 |
| daemon 单元 | `daemon/src/**` 内嵌 | 23 | 配置解析、VehicleModel/超时、故障滞回、mock 后端、IPC 帧校验 |
| simulator 单元 | `simulator/src/sim.rs` | 4 | 场景时间线、故障注入、非法方向、场景文件解析 |
| IPC 集成 | `daemon/tests/ipc_integration.rs` | 2 | 握手、状态、PING、命令应答、故障事件、重连、版本拒绝 |
| UI 协议交叉 | `ui/tests/protocol.test.ts` | 5 | 解码 Rust 金样帧并回编码客户端消息逐字节比对 |
| UI 平台 API | `ui/tests/platform.test.ts` | 1 | Mock 传输下握手、状态订阅、命令、PING |
| 端到端检查 | `tools/ui-sim-check.ts` | 1 | 启动 forklift-sim，TS 平台层验证状态/故障/PING/命令 |

## 2. 运行方式

```sh
# macOS（本地快速迭代；传输走流式组帧兜底）
cargo test --workspace

# Linux builder（权威路径：原生 SOCK_SEQPACKET，与 D211 一致）
D211_REMOTE=user@host tools/test-remote.sh
D211_REMOTE=user@host D211_REMOTE_PORT=2222 tools/test-remote.sh

# UI 层（Bun）
cd ui && bun test                       # 协议金样 + 平台 API
bun tools/ui-sim-check.ts               # 端到端：Rust sim ↔ TS 平台层

# 协议金样重新生成（Rust 侧改动协议后必须执行）
cargo run -q -p protocol --example emit_golden > ui/tests/golden/protocol.json

# clippy（提交前必须过）
cargo clippy --workspace --all-targets -- -D warnings
```

`tools/test-remote.sh` 会把工作区 rsync 到 builder（默认 `~/forklift-platform`），
执行 `cargo test` 与 clippy；macOS 与 Linux 的差异仅在传输实现，
协议与业务测试完全一致。

## 3. 异常场景覆盖（spec §36）

| 场景 | 状态 | 说明 |
| --- | --- | --- |
| daemon 不可用 | 已覆盖 | `Client::connect` 返回错误 |
| UI 断线 | 已覆盖 | 服务端连接线程退出并清理广播表 |
| UI 重连 | 已覆盖 | 集成测试重新连接并收到状态 |
| 半包/分片 | 已覆盖 | 流模式组帧测试（Linux 下由 SEQPACKET 天然规避） |
| 非法 magic/版本/类型/长度 | 已覆盖 | protocol 单元测试 |
| 超大 payload | 已覆盖 | 帧头拒绝 + 流模式组帧上限 |
| daemon 重启 | 待补 | 需要进程级测试（M1 前加入） |

## 4. 第一阶段验收清单（spec §48）

| 项 | 状态 |
| --- | --- |
| `cargo test --workspace` 通过 | ✅（Mac 与 Linux） |
| `cargo clippy --workspace -- -D warnings` 通过 | ✅ |
| `forkliftd` 可独立运行 | ✅ mock 后端 |
| `forklift-sim` 可独立运行 | ✅ |
| UI 可连接 simulator | ⏳ 等 PocketJS platform API（M1） |
| VehicleState 更新正常 | ✅ 集成测试断言 |
| UI 命令 → daemon | ✅ PING/播放命令集成测试 |
| Fault event 正常 | ✅ 过热注入集成测试 |
| daemon 重启后 UI 可重连 | ⏳ 进程级测试待补 |
| UI 重启不影响 daemon | ✅ 单客户端断开不影响服务 |

## 5. 硬件测试（后续 milestone）

| 项 | 依赖 |
| --- | --- |
| SocketCAN 收发 | M1 真实控制器或 CAN 分析仪 |
| IIO ADC 标定 | 实际传感器 |
| VIN → DE 视频层 | 摄像头模组 |
| ALSA 播放 | 板载 Codec |
| 触摸/显示 | D211 实机（PocketJS host 已具备） |
