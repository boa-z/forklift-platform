//! 生成 TypeScript 侧协议测试使用的金样帧（JSON：name + hex）。
//!
//! 用法：`cargo run -p protocol --example emit_golden > ui/tests/golden/protocol.json`
//! TS 测试会解码这些帧并回编码客户端消息，两边协议由此保持同步。

use protocol::{
    encode, mcu, AntiDismantleEvent, AuthStateEvent, ConnectivityEvent, Direction, Fault,
    FaultSeverity, FaultSnapshot, HealthState, Message, RtcEvent, Signal, SoundId, SystemState,
    VehicleState, FAULT_MOTOR_OVERHEAT, VERSION,
};

/// 把字节序列转换为十六进制字符串。
fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// 生成所有金样帧（名称固定，TS 测试按名称取用）。
fn main() {
    // 用首元素初始化，避免 clippy 的 vec_init_then_push。
    let mut frames: Vec<(&str, Vec<u8>)> =
        vec![("hello", encode(1, &Message::Hello { client_version: VERSION }))];
    frames.push(("server_version", encode(1, &Message::ServerVersion(VERSION))));
    frames.push(("ping", encode(2, &Message::Ping(0x0102_0304))));
    frames.push((
        "error",
        encode(
            3,
            &Message::Error {
                code: 7,
                message: "bad frame".to_string(),
            },
        ),
    ));
    frames.push(("play_sound", encode(4, &Message::PlaySound(SoundId::Button))));
    frames.push(("set_volume", encode(5, &Message::SetVolume(70))));
    frames.push(("set_brightness", encode(6, &Message::SetBrightness(80))));
    frames.push((
        "connectivity",
        encode(
            7,
            &Message::Connectivity(ConnectivityEvent {
                timestamp_ms: 99,
                can_online: true,
                camera_online: false,
            }),
        ),
    ));
    frames.push((
        "fault_raised",
        encode(
            8,
            &Message::FaultRaised(Fault::new(
                FAULT_MOTOR_OVERHEAT,
                FaultSeverity::Critical,
                10,
            )),
        ),
    ));
    frames.push((
        "faults",
        encode(
            9,
            &Message::Faults(FaultSnapshot {
                timestamp_ms: 42,
                faults: vec![Fault::new(FAULT_MOTOR_OVERHEAT, FaultSeverity::Critical, 10)],
            }),
        ),
    ));
    frames.push((
        "system",
        encode(
            10,
            &Message::System(SystemState {
                timestamp_ms: 7,
                uptime_ms: 1234,
                health: [
                    HealthState::Healthy,
                    HealthState::Unknown,
                    HealthState::Degraded,
                    HealthState::Healthy,
                    HealthState::Healthy,
                ],
                rss_kb: 100,
                mem_available_kb: 200,
            }),
        ),
    ));

    let mut state = VehicleState::unavailable(123_456_789);
    state.motion.speed_kph = Signal::new(12.5, 123_456_700);
    state.motion.direction = Signal::new(Direction::Reverse, 123_456_700);
    state.motion.parking_brake = Signal::new(true, 123_456_700);
    state.motion.steer_angle_deg = Signal::new(-15.0, 123_456_700);
    state.battery.soc_percent = Signal::new(56.0, 123_456_700);
    state.battery.voltage_v = Signal::new(51.2, 123_456_700);
    state.connectivity.can_online = true;
    state.connectivity.camera_online = true;
    frames.push(("vehicle_state", encode(11, &Message::VehicleState(Box::new(state)))));

    // v5：授权/MCU 相关事件与命令。
    frames.push((
        "swipe_report",
        encode(
            12,
            &Message::SwipeReport(mcu::SwipeReport {
                status: 1,
                index: 3,
                name: *b"ZHANG SA",
                card: [0x11, 0x22, 0x33, 0x44],
                id: [0x12, 0x34, 0x56, 0x78, 0x90, 0x12, 0x34, 0x56, 0x78],
                phone: [0; 6],
                driver_license: [0; 3],
                ic_license: [0; 3],
            }),
        ),
    ));
    frames.push((
        "auth_state",
        encode(
            13,
            &Message::AuthState(AuthStateEvent {
                level: 2,
                authorized: true,
            }),
        ),
    ));
    frames.push((
        "anti_dismantle",
        encode(
            14,
            &Message::AntiDismantle(AntiDismantleEvent {
                enabled: true,
                alarm: false,
            }),
        ),
    ));
    frames.push((
        "rtc",
        encode(
            15,
            &Message::Rtc(RtcEvent {
                year: 26,
                month: 9,
                day: 13,
                hour: 8,
                minute: 30,
                second: 5,
            }),
        ),
    ));
    frames.push(("auth_level", encode(16, &Message::AuthLevel(2))));
    frames.push((
        "verify_password",
        encode(
            17,
            &Message::VerifyPassword {
                password: "32431".to_string(),
            },
        ),
    ));
    frames.push((
        "set_admin_password",
        encode(
            18,
            &Message::SetAdminPassword {
                old_password: "22222".to_string(),
                new_password: "54321".to_string(),
            },
        ),
    ));
    frames.push((
        "enter_license_tail",
        encode(
            19,
            &Message::EnterLicenseTail {
                digits: "5678".to_string(),
            },
        ),
    ));
    frames.push((
        "report_power_on",
        encode(
            20,
            &Message::ReportPowerOn {
                kind: 1,
                card: [0x11, 0x22, 0x33, 0x44],
            },
        ),
    ));
    frames.push((
        "swipe_reply",
        encode(21, &Message::SwipeReply { status: 0 }),
    ));
    frames.push((
        "set_anti_dismantle",
        encode(22, &Message::SetAntiDismantle { enabled: true }),
    ));

    let json: Vec<String> = frames
        .into_iter()
        .map(|(name, bytes)| format!("{{\"name\":\"{name}\",\"hex\":\"{}\"}}", hex(&bytes)))
        .collect();
    println!("[{}]", json.join(","));
}
