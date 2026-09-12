//! 版本化二进制 IPC：`forkliftd`、`forklift-sim` 与 PocketJS platform bridge
//! 共用。
//!
//! 布局：16 字节帧头（`magic | version | type | length | sequence`）+ 小端
//! 载荷。`SOCK_SEQPACKET` 保留消息边界；每一帧仍然会先做长度校验再解码。

pub mod client;
pub mod codec;
pub mod command;
pub mod event;
pub mod header;
pub mod messages;
pub mod socket;
pub mod state;

pub use client::{Client, ClientError};
pub use codec::{decode, encode, ProtocolError};
pub use command::SoundId;
pub use event::{
    ConnectivityEvent, Fault, FaultSnapshot, FaultSeverity, HealthState, SystemState,
    FAULT_ADC_FAILURE, FAULT_AUDIO_FAILURE, FAULT_BATTERY_LOW, FAULT_CAMERA_OFFLINE,
    FAULT_CAN_OFFLINE, FAULT_MOTOR_OVERHEAT, FAULT_STORAGE_FAILURE,
};
pub use header::MessageHeader;
pub use messages::{Message, MessageType};
pub use state::{
    BatteryState, ConnectivityState, Direction, HydraulicState, IoState, MotionState, MotorState,
    RunMode, Signal, SignalQuality, VehicleInfo, VehicleState, WireValue,
};

/// `'F' 'L' 'K' 'T'` little-endian.
pub const MAGIC: u32 = 0x544b_4c46;
pub const VERSION: u16 = 3;
pub const MAX_PAYLOAD: usize = 64 * 1024;
pub const HEADER_SIZE: usize = MessageHeader::SIZE;
