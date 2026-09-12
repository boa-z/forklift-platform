//! Wire-format tests: round trips, malformed frames, and the golden header.

use protocol::{
    decode, encode, Direction, Fault, FaultSeverity, FaultSnapshot, Message, RunMode, Signal,
    SignalQuality, SoundId, VehicleState, HEADER_SIZE, MAGIC, MAX_PAYLOAD, VERSION,
};

/// 构造包含典型取值的车辆状态。
fn sample_state() -> VehicleState {
    let mut state = VehicleState::unavailable(0);
    state.motion.speed_kph = Signal::new(12.5, 1_000);
    state.motion.direction = Signal::new(Direction::Reverse, 1_000);
    state.motion.parking_brake = Signal::new(true, 1_000);
    state.motion.steer_angle_deg = Signal::new(-15.0, 1_000);
    state.motion.run_mode = Signal::new(RunMode::S, 1_000);
    state.battery.soc_percent = Signal::new(56.0, 1_000);
    state.battery.voltage_v = Signal::new(51.2, 1_000);
    state.battery.current_a = Signal::new(12.5, 1_000);
    state.io.seat_switch = Signal::new(true, 1_000);
    state.connectivity.can_online = true;
    state.vehicle.controller_online = [true, true, false];
    state
}

/// 车辆状态编解码应完全还原。
#[test]
fn vehicle_state_round_trip() {
    let state = sample_state();
    let frame = encode(7, &Message::VehicleState(Box::new(state.clone())));
    let payload_length = u32::from_le_bytes([frame[8], frame[9], frame[10], frame[11]]) as usize;
    assert_eq!(frame.len() - HEADER_SIZE, payload_length);
    let (header, message) = decode(&frame).expect("frame decodes");
    assert_eq!(header.sequence, 7);
    assert_eq!(header.version, VERSION);
    assert_eq!(message, Message::VehicleState(Box::new(state)));
}

/// 故障快照编解码应完全还原。
#[test]
fn fault_snapshot_round_trip() {
    let snapshot = FaultSnapshot {
        timestamp_ms: 42,
        faults: vec![
            Fault::new(0x0001, FaultSeverity::Critical, 10),
            Fault::new(0x0002, FaultSeverity::Warning, 20),
        ],
    };
    let frame = encode(1, &Message::Faults(snapshot.clone()));
    let (_, message) = decode(&frame).unwrap();
    assert_eq!(message, Message::Faults(snapshot));
}

/// 命令类消息（音效/音量/亮度/PING）编解码应完全还原。
#[test]
fn command_messages_round_trip() {
    for message in [
        Message::PlaySound(SoundId::Reverse),
        Message::SetVolume(70),
        Message::SetBrightness(80),
        Message::Ping(0xdead_beef),
    ] {
        let frame = encode(2, &message);
        let (_, decoded) = decode(&frame).unwrap();
        assert_eq!(decoded, message);
    }
}

/// 金样：PING 帧头与载荷必须为约定的小端字节。
#[test]
fn golden_ping_header_is_little_endian() {
    let frame = encode(0x1122_3344, &Message::Ping(0x0102_0304));
    assert_eq!(&frame[0..4], &MAGIC.to_le_bytes());
    assert_eq!(&frame[4..6], &VERSION.to_le_bytes());
    assert_eq!(&frame[6..8], &0x0303u16.to_le_bytes());
    assert_eq!(&frame[8..12], &4u32.to_le_bytes());
    assert_eq!(&frame[12..16], &0x1122_3344u32.to_le_bytes());
    assert_eq!(&frame[16..20], &0x0102_0304u32.to_le_bytes());
}

/// magic 错误必须被拒绝。
#[test]
fn header_rejects_bad_magic() {
    let mut frame = encode(1, &Message::Ok);
    frame[0] = 0;
    assert!(matches!(decode(&frame), Err(protocol::ProtocolError::BadMagic { .. })));
}

/// 协议版本不支持必须被拒绝。
#[test]
fn header_rejects_unknown_version() {
    let mut frame = encode(1, &Message::Ok);
    frame[4] = 9;
    assert!(matches!(
        decode(&frame),
        Err(protocol::ProtocolError::UnsupportedVersion { found: 9, .. })
    ));
}

/// 载荷超过 64 KiB 上限必须被拒绝。
#[test]
fn header_rejects_oversized_payload() {
    let mut frame = encode(1, &Message::Ok);
    let too_big = (MAX_PAYLOAD + 1) as u32;
    frame[8..12].copy_from_slice(&too_big.to_le_bytes());
    assert!(matches!(
        decode(&frame),
        Err(protocol::ProtocolError::PayloadTooLarge { .. })
    ));
}

/// 帧头不足 16 字节必须被拒绝。
#[test]
fn header_rejects_truncated_frame() {
    let frame = encode(1, &Message::Ok);
    assert!(matches!(
        decode(&frame[..HEADER_SIZE - 1]),
        Err(protocol::ProtocolError::Truncated { .. })
    ));
}

/// 未知消息类型必须被拒绝。
#[test]
fn decode_rejects_unknown_message_type() {
    let mut frame = encode(1, &Message::Ok);
    frame[6..8].copy_from_slice(&0x7fffu16.to_le_bytes());
    assert!(matches!(
        decode(&frame),
        Err(protocol::ProtocolError::UnknownMessageType { .. })
    ));
}

/// 帧头长度与实际载荷不一致必须被拒绝。
#[test]
fn decode_rejects_length_mismatch() {
    let mut frame = encode(1, &Message::Ping(1));
    frame[8..12].copy_from_slice(&5u32.to_le_bytes());
    assert!(matches!(
        decode(&frame),
        Err(protocol::ProtocolError::LengthMismatch { .. })
    ));
}

/// 超时后信号质量降级为 Stale，值保留。
#[test]
fn signal_evaluates_to_stale_after_timeout() {
    let mut signal = Signal::new(10.0f32, 1_000);
    assert_eq!(signal.evaluate(1_500, 1_000), SignalQuality::Valid);
    assert_eq!(signal.evaluate(2_500, 1_000), SignalQuality::Stale);
    assert_eq!(signal.quality, SignalQuality::Stale);
    assert_eq!(signal.value, 10.0);
}

/// Unavailable 信号不因超时被改写。
#[test]
fn unavailable_signal_stays_unavailable() {
    let mut signal = Signal::<f32>::unavailable();
    assert_eq!(signal.evaluate(10_000, 100), SignalQuality::Unavailable);
}
