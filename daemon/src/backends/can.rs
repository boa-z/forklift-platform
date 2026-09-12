//! CAN 后端与解码器。
//!
//! 下方解码 ID 在真实车型 CAN 矩阵确认前都是**临时占位**，仅用于打通
//! 数据链路；UI 永远看不到这些常量。

use thiserror::Error;

use crate::vehicle::VehicleUpdate;
use protocol::{Direction, RunMode};

pub const CAN_ID_MOTOR: u32 = 0x301;
pub const CAN_ID_BATTERY: u32 = 0x302;
pub const CAN_ID_MOTION: u32 = 0x303;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CanFrame {
    pub id: u32,
    pub data: [u8; 8],
    pub dlc: u8,
    pub timestamp_ms: u64,
}

#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum CanError {
    #[error("SocketCAN backend is not implemented yet")]
    Unsupported,
    #[error("CAN I/O: {0}")]
    Io(String),
}

pub trait CanBackend: Send {
    /// 取走上一次调用以来收到的所有帧。
    fn poll(&mut self, out: &mut Vec<CanFrame>) -> Result<(), CanError>;
}

/// M1：真实 SocketCAN。接口接通前返回 Unsupported，让服务层把缺口暴露为
/// 健康状态而不是空转。
pub struct SocketCanBackend {
    pub interface: String,
}

impl SocketCanBackend {
    /// 记录 CAN 接口名；真实收发在 M1 接入。
    pub fn new(interface: impl Into<String>) -> Self {
        Self {
            interface: interface.into(),
        }
    }
}

impl CanBackend for SocketCanBackend {
    /// M1 前明确返回 Unsupported，让健康模型暴露缺口而不是空转。
    fn poll(&mut self, _out: &mut Vec<CanFrame>) -> Result<(), CanError> {
        Err(CanError::Unsupported)
    }
}

/// 确定性 mock：20ms 循环、每 50ms 发三帧，速度缓慢爬升、电量缓慢下降。
#[derive(Default)]
pub struct MockCanBackend {
    last_emit_ms: Option<u64>,
    started_ms: Option<u64>,
    stopped: bool,
}

impl MockCanBackend {
    /// 创建 mock CAN 后端。
    pub fn new() -> Self {
        Self::default()
    }

    /// 模拟总线断开（后续不再发帧）。
    pub fn set_stopped(&mut self, stopped: bool) {
        self.stopped = stopped;
    }

    /// 依据启动以来的相位生成三帧占位报文。
    fn frames(&mut self, now_ms: u64) -> Vec<CanFrame> {
        let start = *self.started_ms.get_or_insert(now_ms);
        let elapsed = now_ms.saturating_sub(start);
        let phase = (elapsed % 20_000) as f32 / 20_000.0;
        let speed_kph = 12.0 * phase;
        let soc = 80.0 - 20.0 * phase;
        let rpm = 1_200.0 + 600.0 * phase;
        let temp = 45.0 + 35.0 * phase;

        let mut motor = [0u8; 8];
        motor[0..2].copy_from_slice(&(rpm as u16).to_le_bytes());
        motor[2] = (temp + 40.0) as u8;

        let mut battery = [0u8; 8];
        battery[0] = soc as u8;
        let voltage = ((48.0 + 6.0 * phase) * 10.0) as u16;
        battery[1..3].copy_from_slice(&voltage.to_le_bytes());
        let current = ((15.0 + 10.0 * phase) * 10.0) as i16;
        battery[3..5].copy_from_slice(&current.to_le_bytes());

        let mut motion = [0u8; 8];
        motion[0..2].copy_from_slice(&((speed_kph * 10.0) as u16).to_le_bytes());
        motion[2] = Direction::Forward.as_u8();
        motion[3] = 0u8; // steer angle 0
        motion[4] = RunMode::S.as_u8();
        motion[5] = 0u8; // parking brake off

        vec![
            CanFrame {
                id: CAN_ID_MOTOR,
                data: motor,
                dlc: 3,
                timestamp_ms: now_ms,
            },
            CanFrame {
                id: CAN_ID_BATTERY,
                data: battery,
                dlc: 5,
                timestamp_ms: now_ms,
            },
            CanFrame {
                id: CAN_ID_MOTION,
                data: motion,
                dlc: 6,
                timestamp_ms: now_ms,
            },
        ]
    }
}

impl CanBackend for MockCanBackend {
    /// 每 50ms 发一帧组；总线断开时不产生数据。
    fn poll(&mut self, out: &mut Vec<CanFrame>) -> Result<(), CanError> {
        let now_ms = crate::diagnostics::now_ms();
        if self.stopped {
            return Ok(());
        }
        let due = match self.last_emit_ms {
            Some(last) => now_ms.saturating_sub(last) >= 50,
            None => true,
        };
        if due {
            out.extend(self.frames(now_ms));
            self.last_emit_ms = Some(now_ms);
        }
        Ok(())
    }
}

/// 把单帧占位报文解码为部分更新。
pub fn decode(frame: &CanFrame) -> VehicleUpdate {
    let mut update = VehicleUpdate::default();
    match frame.id {
        CAN_ID_MOTOR => {
            update.rpm = Some(u16::from_le_bytes([frame.data[0], frame.data[1]]) as f32);
            update.motor_temp_c = Some(frame.data[2] as f32 - 40.0);
        }
        CAN_ID_BATTERY => {
            update.soc_percent = Some(frame.data[0] as f32);
            update.voltage_v = Some(u16::from_le_bytes([frame.data[1], frame.data[2]]) as f32 / 10.0);
            update.current_a =
                Some(i16::from_le_bytes([frame.data[3], frame.data[4]]) as f32 / 10.0);
        }
        CAN_ID_MOTION => {
            update.speed_kph =
                Some(u16::from_le_bytes([frame.data[0], frame.data[1]]) as f32 / 10.0);
            update.direction = Direction::from_u8(frame.data[2]).ok();
            update.steer_angle_deg = Some(frame.data[3] as i8 as f32);
            update.run_mode = RunMode::from_u8(frame.data[4]).ok();
            update.parking_brake = Some(frame.data[5] != 0);
            update.controller_online = Some([true, true, false]);
        }
        _ => {}
    }
    update
}

/// 解码一组帧并合并；`can_frame_seen` 标记本批是否收到数据。
pub fn decode_frames(frames: &[CanFrame]) -> VehicleUpdate {
    let mut update = VehicleUpdate::default();
    for frame in frames {
        update.merge(&decode(frame));
    }
    update.can_frame_seen = !frames.is_empty();
    update
}

#[cfg(test)]
mod tests {
    use super::*;

    /// mock 帧应解码出可信的速度、SOC 与方向。
    #[test]
    fn mock_frames_decode_to_plausible_values() {
        let mut backend = MockCanBackend::new();
        // 手动把起始时间提前，避免测试依赖真实时钟。
        let now = crate::diagnostics::now_ms();
        backend.started_ms = Some(now.saturating_sub(10_000));
        let mut frames = Vec::new();
        backend.poll(&mut frames).unwrap();
        assert_eq!(frames.len(), 3);
        let update = decode_frames(&frames);
        assert!(update.can_frame_seen);
        assert!(update.speed_kph.unwrap() > 5.0);
        assert!(update.soc_percent.unwrap() > 60.0);
        assert_eq!(update.direction, Some(Direction::Forward));
    }

    /// 总线断开后不再产生帧。
    #[test]
    fn stopped_mock_emits_nothing() {
        let mut backend = MockCanBackend::new();
        backend.set_stopped(true);
        let mut frames = Vec::new();
        backend.poll(&mut frames).unwrap();
        assert!(frames.is_empty());
    }

    /// SocketCAN 在实现前必须报告 Unsupported。
    #[test]
    fn socketcan_reports_unsupported() {
        let mut backend = SocketCanBackend::new("can0");
        let mut frames = Vec::new();
        assert_eq!(backend.poll(&mut frames), Err(CanError::Unsupported));
    }
}
