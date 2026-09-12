//! 集成测试：后端采样 → 服务循环 → IPC → `protocol::Client`。
//!
//! 覆盖：握手、状态发布、PING/PONG、命令应答、故障事件、客户端重连。

use std::collections::VecDeque;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use forkliftd::backends::can::{CAN_ID_BATTERY, CAN_ID_MOTION, CAN_ID_MOTOR};
use forkliftd::backends::{
    CanBackend, CanError, CanFrame, McuBackend, MockAdcBackend, MockAudioBackend,
    MockCameraBackend, MockWatchdog,
};
use forkliftd::ipc::Server;
use forkliftd::service::{Backends, Service, ServiceConfig};
use protocol::mcu::{self, Frame, McuError};
use protocol::{Client, Direction, Message, RunMode, SoundId, FAULT_MOTOR_OVERHEAT};

/// 测试用 CAN 后端：前 10 次采样温度正常，之后注入过热帧。
struct TestCanBackend {
    polls: Arc<AtomicU32>,
    started_ms: Option<u64>,
}

impl CanBackend for TestCanBackend {
    /// 生成三帧临时 CAN 报文，并按轮次切换电机温度。
    fn poll(&mut self, out: &mut Vec<CanFrame>) -> Result<(), CanError> {
        let now = forkliftd::diagnostics::now_ms();
        let start = *self.started_ms.get_or_insert(now);
        let elapsed = now.saturating_sub(start);
        let polls = self.polls.fetch_add(1, Ordering::Relaxed);
        let temperature = if polls >= 10 { 95.0 } else { 45.0 };

        let mut motor = [0u8; 8];
        motor[0..2].copy_from_slice(&1500u16.to_le_bytes());
        motor[2] = (temperature + 40.0) as u8;
        let mut battery = [0u8; 8];
        battery[0] = 55;
        battery[1..3].copy_from_slice(&510u16.to_le_bytes());
        let mut motion = [0u8; 8];
        motion[0..2].copy_from_slice(&120u16.to_le_bytes()); // 12.0 km/h
        motion[2] = Direction::Forward.as_u8();
        motion[4] = RunMode::S.as_u8();

        out.push(CanFrame {
            id: CAN_ID_MOTOR,
            data: motor,
            dlc: 3,
            timestamp_ms: now,
        });
        out.push(CanFrame {
            id: CAN_ID_BATTERY,
            data: battery,
            dlc: 3,
            timestamp_ms: now,
        });
        out.push(CanFrame {
            id: CAN_ID_MOTION,
            data: motion,
            dlc: 6,
            timestamp_ms: now,
        });
        // 保留 elapsed 仅用于未来限速；当前每次 tick 都发帧。
        let _ = elapsed;
        Ok(())
    }
}

/// 测试用 MCU 后端：从探针注入上行帧，下行帧写回探针。
struct TestMcuBackend {
    incoming: Arc<Mutex<VecDeque<Frame>>>,
    sent: Arc<Mutex<Vec<Frame>>>,
}

impl McuBackend for TestMcuBackend {
    /// 取出探针注入的全部帧。
    fn poll(&mut self, out: &mut Vec<Frame>) -> Result<(), McuError> {
        let mut queue = self.incoming.lock().expect("mcu 注入队列锁");
        out.extend(queue.drain(..));
        Ok(())
    }

    /// 把发送帧记录到探针。
    fn send(&mut self, frame: &Frame) -> Result<(), McuError> {
        self.sent.lock().expect("mcu 发送队列锁").push(frame.clone());
        Ok(())
    }
}

/// 测试与 daemon 之间的 MCU 共享句柄。
#[derive(Clone, Default)]
struct McuProbe {
    incoming: Arc<Mutex<VecDeque<Frame>>>,
    sent: Arc<Mutex<Vec<Frame>>>,
}

impl McuProbe {
    /// 注入一帧模组上报。
    fn push(&self, frame: Frame) {
        self.incoming
            .lock()
            .expect("mcu 注入队列锁")
            .push_back(frame);
    }

    /// 取当前全部下行帧快照。
    fn sent_frames(&self) -> Vec<Frame> {
        self.sent.lock().expect("mcu 发送队列锁").clone()
    }
}

/// 等待 daemon 向模组发送某索引的帧。
fn wait_for_sent(probe: &McuProbe, timeout: Duration, index: mcu::Index) -> Frame {
    let deadline = Instant::now() + timeout;
    loop {
        if let Some(frame) = probe
            .sent_frames()
            .into_iter()
            .find(|frame| frame.index == index)
        {
            return frame;
        }
        assert!(Instant::now() < deadline, "等待模组发送超时：{index:?}");
        thread::sleep(Duration::from_millis(20));
    }
}

/// 生成唯一的 socket 路径，避免并行测试互撞。
fn socket_path(tag: &str) -> PathBuf {
    std::env::temp_dir().join(format!(
        "forklift-it-{}-{}.sock",
        std::process::id(),
        tag
    ))
}

/// 启动一个测试服务并返回 socket 路径。
fn spawn_service_with_mcu(tag: &str, polls: Arc<AtomicU32>) -> (PathBuf, McuProbe) {
    let path = socket_path(tag);
    let probe = McuProbe::default();
    let backends = Backends {
        can: Box::new(TestCanBackend {
            polls,
            started_ms: None,
        }),
        adc: Box::new(MockAdcBackend::new()),
        camera: Box::new(MockCameraBackend::new()),
        audio: Box::new(MockAudioBackend::new(70)),
        mcu: Box::new(TestMcuBackend {
            incoming: Arc::clone(&probe.incoming),
            sent: Arc::clone(&probe.sent),
        }),
        watchdog: Box::new(MockWatchdog::new()),
    };
    let (server, commands) = Server::bind(&path).expect("绑定测试 socket");
    let config = ServiceConfig {
        tick: Duration::from_millis(10),
        signal_timeout_ms: 500,
        publish_period_ms: 20,
        camera_enable: true,
        brightness: 80,
        volume: 70,
        mcu_enable: true,
        auth_path: socket_path(tag).with_extension("auth.toml"),
    };
    thread::spawn(move || Service::new(config, server, commands, backends).run());
    (path, probe)
}

/// 启动一个测试服务并返回 socket 路径。
fn spawn_service(tag: &str, polls: Arc<AtomicU32>) -> PathBuf {
    spawn_service_with_mcu(tag, polls).0
}

/// 等待一条满足条件的消息，超时即失败。
fn wait_for<T>(client: &mut Client, timeout: Duration, mut predicate: impl FnMut(&Message) -> Option<T>) -> T {
    let deadline = Instant::now() + timeout;
    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        assert!(!remaining.is_zero(), "等待消息超时");
        let (_, message) = client.recv_timeout(remaining).expect("接收消息");
        if let Some(value) = predicate(&message) {
            return value;
        }
    }
}

/// 主链路：状态、PONG、命令应答、故障事件、重连。
#[test]
fn simulator_style_backend_reaches_client_over_ipc() {
    let polls = Arc::new(AtomicU32::new(0));
    let path = spawn_service("main", Arc::clone(&polls));

    let mut client = Client::connect(&path).expect("连接服务");
    assert_eq!(client.handshake().expect("握手"), protocol::VERSION);

    // 1) 收到带真实车速的车辆状态。
    let speed = wait_for(&mut client, Duration::from_secs(3), |message| match message {
        Message::VehicleState(state) => Some(state.motion.speed_kph.value),
        _ => None,
    });
    assert!((speed - 12.0).abs() < 0.01);

    // 2) PING 得到同 nonce 的 PONG。
    client.send(&Message::Ping(0xabcd)).expect("发送 PING");
    let nonce = wait_for(&mut client, Duration::from_secs(2), |message| match message {
        Message::Pong(nonce) => Some(*nonce),
        _ => None,
    });
    assert_eq!(nonce, 0xabcd);

    // 3) 播放命令得到 RESP_OK。
    client
        .send(&Message::PlaySound(SoundId::Button))
        .expect("发送命令");
    wait_for(&mut client, Duration::from_secs(2), |message| match message {
        Message::Ok => Some(()),
        _ => None,
    });

    // 4) 温度过热后收到故障事件。
    let fault_id = wait_for(&mut client, Duration::from_secs(3), |message| match message {
        Message::FaultRaised(fault) => Some(fault.id),
        _ => None,
    });
    assert_eq!(fault_id, FAULT_MOTOR_OVERHEAT);

    // 5) 断开后重连，仍能收到状态。
    drop(client);
    let mut reconnected = Client::connect(&path).expect("重连服务");
    reconnected.handshake().expect("重连握手");
    wait_for(&mut reconnected, Duration::from_secs(3), |message| match message {
        Message::VehicleState(state) => Some(state.motion.speed_kph.value),
        _ => None,
    });

    std::fs::remove_file(&path).ok();
}

/// 刷卡与密码链路：模组上报 → UI 事件 → 回包/开机上报 → 密码分级。
#[test]
fn swipe_and_password_flow_over_ipc() {
    let polls = Arc::new(AtomicU32::new(0));
    let (path, probe) = spawn_service_with_mcu("auth", Arc::clone(&polls));
    let auth_path = socket_path("auth").with_extension("auth.toml");
    let _ = std::fs::remove_file(&auth_path);

    let mut client = Client::connect(&path).expect("连接服务");
    client.handshake().expect("握手");

    // 1) 注入一条刷卡成功上报。
    let report = mcu::SwipeReport {
        status: 1,
        index: 3,
        name: *b"ZHANG SA",
        card: [0x11, 0x22, 0x33, 0x44],
        id: [0x12, 0x34, 0x56, 0x78, 0x90, 0x12, 0x34, 0x56, 0x78],
        phone: [0; 6],
        driver_license: [0; 3],
        ic_license: [0; 3],
    };
    probe.push(
        Frame::new(mcu::CMD_SET, mcu::index::SWIPE_REPORT, report.encode()).expect("构造刷卡帧"),
    );

    // 2) UI 收到刷卡事件与已授权状态。
    let status = wait_for(&mut client, Duration::from_secs(3), |message| match message {
        Message::SwipeReport(report) => Some(report.status),
        _ => None,
    });
    assert_eq!(status, 1);
    let authorized = wait_for(&mut client, Duration::from_secs(3), |message| match message {
        Message::AuthState(state) => Some(state.authorized),
        _ => None,
    });
    assert!(authorized);

    // 3) 模组收到刷卡应答（0）与刷卡开机上报。
    let reply = wait_for_sent(&probe, Duration::from_secs(3), mcu::index::SWIPE_REPLY);
    assert_eq!(reply.data, vec![0]);
    let power_on = wait_for_sent(&probe, Duration::from_secs(3), mcu::index::POWER_ON_REPORT);
    assert_eq!(
        power_on.data,
        mcu::power_on_report(mcu::PowerOnType::Card, report.card)
    );

    // 4) 密码校验返回三级权限。
    client
        .send(&Message::VerifyPassword {
            password: "32431".to_string(),
        })
        .expect("发送密码校验");
    let level = wait_for(&mut client, Duration::from_secs(2), |message| match message {
        Message::AuthLevel(level) => Some(*level),
        _ => None,
    });
    assert_eq!(level, 2);

    // 5) 修改管理员密码：旧密码错误 → RESP_ERROR。
    client
        .send(&Message::SetAdminPassword {
            old_password: "00000".to_string(),
            new_password: "54321".to_string(),
        })
        .expect("发送改密请求");
    let code = wait_for(&mut client, Duration::from_secs(2), |message| match message {
        Message::Error { code, .. } => Some(*code),
        _ => None,
    });
    assert_eq!(code, 2001);

    drop(client);
    std::fs::remove_file(&path).ok();
    let _ = std::fs::remove_file(&auth_path);
}

/// 协议版本不符时握手必须失败。
#[test]
fn version_mismatch_is_rejected() {
    let polls = Arc::new(AtomicU32::new(0));
    let path = spawn_service("version", polls);
    let mut client = Client::connect(&path).expect("连接服务");
    client
        .send(&Message::Hello {
            client_version: protocol::VERSION + 1,
        })
        .expect("发送错误版本 HELLO");
    let (_, message) = client.recv_timeout(Duration::from_secs(2)).expect("接收拒绝帧");
    assert!(matches!(message, Message::Error { .. }));
    std::fs::remove_file(&path).ok();
}
