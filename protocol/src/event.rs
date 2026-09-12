//! Fault and connectivity events. Faults are daemon-owned; the UI only
//! renders severities and ids it knows how to localize.

use crate::codec::{ProtocolError, Reader, Writer};

pub const MAX_FAULTS: usize = 64;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FaultSeverity {
    Info = 0,
    Warning = 1,
    Critical = 2,
}

impl FaultSeverity {
    /// 由线格式值还原故障级别。
    pub fn from_u8(value: u8) -> Result<Self, ProtocolError> {
        match value {
            0 => Ok(Self::Info),
            1 => Ok(Self::Warning),
            2 => Ok(Self::Critical),
            other => Err(ProtocolError::InvalidEnum {
                field: "FaultSeverity",
                value: other as u32,
            }),
        }
    }

    /// 故障级别的线格式值。
    pub fn as_u8(self) -> u8 {
        self as u8
    }
}

pub const FAULT_MOTOR_OVERHEAT: u32 = 0x0001;
pub const FAULT_BATTERY_LOW: u32 = 0x0002;
pub const FAULT_CAN_OFFLINE: u32 = 0x0003;
pub const FAULT_ADC_FAILURE: u32 = 0x0004;
pub const FAULT_CAMERA_OFFLINE: u32 = 0x0005;
pub const FAULT_AUDIO_FAILURE: u32 = 0x0006;
pub const FAULT_STORAGE_FAILURE: u32 = 0x0007;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Fault {
    pub id: u32,
    pub severity: FaultSeverity,
    pub active: bool,
    pub first_seen_ms: u64,
    pub last_seen_ms: u64,
    pub occurrence_count: u32,
}

impl Fault {
    /// 首次产生一条 active 故障。
    pub fn new(id: u32, severity: FaultSeverity, now_ms: u64) -> Self {
        Self {
            id,
            severity,
            active: true,
            first_seen_ms: now_ms,
            last_seen_ms: now_ms,
            occurrence_count: 1,
        }
    }

    /// 序列化一条故障记录。
    pub fn encode(&self, writer: &mut Writer) {
        writer.put_u32(self.id);
        writer.put_u8(self.severity.as_u8());
        writer.put_bool(self.active);
        writer.put_u64(self.first_seen_ms);
        writer.put_u64(self.last_seen_ms);
        writer.put_u32(self.occurrence_count);
    }

    /// 反序列化一条故障记录。
    pub fn decode(reader: &mut Reader<'_>) -> Result<Self, ProtocolError> {
        Ok(Self {
            id: reader.u32()?,
            severity: FaultSeverity::from_u8(reader.u8()?)?,
            active: reader.bool()?,
            first_seen_ms: reader.u64()?,
            last_seen_ms: reader.u64()?,
            occurrence_count: reader.u32()?,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct FaultSnapshot {
    pub timestamp_ms: u64,
    pub faults: Vec<Fault>,
}

impl FaultSnapshot {
    /// 当前 active 故障条数。
    pub fn active_count(&self) -> usize {
        self.faults.iter().filter(|fault| fault.active).count()
    }

    /// 序列化故障快照（条数上限 64）。
    pub fn encode(&self, writer: &mut Writer) {
        writer.put_u64(self.timestamp_ms);
        let count = self.faults.len().min(MAX_FAULTS);
        writer.put_u16(count as u16);
        for fault in self.faults.iter().take(count) {
            fault.encode(writer);
        }
    }

    /// 反序列化故障快照。
    pub fn decode(reader: &mut Reader<'_>) -> Result<Self, ProtocolError> {
        let timestamp_ms = reader.u64()?;
        let count = reader.u16()? as usize;
        if count > MAX_FAULTS {
            return Err(ProtocolError::InvalidEnum {
                field: "FaultSnapshot.count",
                value: count as u32,
            });
        }
        let mut faults = Vec::with_capacity(count);
        for _ in 0..count {
            faults.push(Fault::decode(reader)?);
        }
        Ok(Self {
            timestamp_ms,
            faults,
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ConnectivityEvent {
    pub timestamp_ms: u64,
    pub can_online: bool,
    pub camera_online: bool,
}

impl ConnectivityEvent {
    /// 序列化连接性事件。
    pub fn encode(&self, writer: &mut Writer) {
        writer.put_u64(self.timestamp_ms);
        writer.put_bool(self.can_online);
        writer.put_bool(self.camera_online);
    }

    /// 反序列化连接性事件。
    pub fn decode(reader: &mut Reader<'_>) -> Result<Self, ProtocolError> {
        Ok(Self {
            timestamp_ms: reader.u64()?,
            can_online: reader.bool()?,
            camera_online: reader.bool()?,
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HealthState {
    Healthy = 0,
    Degraded = 1,
    Failed = 2,
    Unknown = 3,
}

impl HealthState {
    /// 由线格式值还原健康状态。
    pub fn from_u8(value: u8) -> Result<Self, ProtocolError> {
        match value {
            0 => Ok(Self::Healthy),
            1 => Ok(Self::Degraded),
            2 => Ok(Self::Failed),
            3 => Ok(Self::Unknown),
            other => Err(ProtocolError::InvalidEnum {
                field: "HealthState",
                value: other as u32,
            }),
        }
    }

    /// 健康状态的线格式值。
    pub fn as_u8(self) -> u8 {
        self as u8
    }
}

pub const HEALTH_SUBSYSTEMS: usize = 5; // can, adc, camera, audio, ipc

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SystemState {
    pub timestamp_ms: u64,
    pub uptime_ms: u64,
    pub health: [HealthState; HEALTH_SUBSYSTEMS],
    pub rss_kb: u32,
    pub mem_available_kb: u32,
}

impl Default for SystemState {
    /// 默认系统状态：未知健康、零遥测。
    fn default() -> Self {
        Self {
            timestamp_ms: 0,
            uptime_ms: 0,
            health: [HealthState::Unknown; HEALTH_SUBSYSTEMS],
            rss_kb: 0,
            mem_available_kb: 0,
        }
    }
}

impl SystemState {
    /// 序列化系统状态。
    pub fn encode(&self, writer: &mut Writer) {
        writer.put_u64(self.timestamp_ms);
        writer.put_u64(self.uptime_ms);
        for state in self.health {
            writer.put_u8(state.as_u8());
        }
        writer.put_u32(self.rss_kb);
        writer.put_u32(self.mem_available_kb);
    }

    /// 反序列化系统状态。
    pub fn decode(reader: &mut Reader<'_>) -> Result<Self, ProtocolError> {
        let timestamp_ms = reader.u64()?;
        let uptime_ms = reader.u64()?;
        let mut health = [HealthState::Unknown; HEALTH_SUBSYSTEMS];
        for entry in health.iter_mut() {
            *entry = HealthState::from_u8(reader.u8()?)?;
        }
        Ok(Self {
            timestamp_ms,
            uptime_ms,
            health,
            rss_kb: reader.u32()?,
            mem_available_kb: reader.u32()?,
        })
    }
}
