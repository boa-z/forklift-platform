//! Versioned binary IPC shared by `forkliftd`, `forklift-sim`, and the
//! PocketJS platform bridge.
//!
//! Layout: 16-byte header (`magic | version | type | length | sequence`)
//! followed by a little-endian payload. `SOCK_SEQPACKET` preserves message
//! boundaries; every frame is still length-checked before decoding.

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
pub const VERSION: u16 = 1;
pub const MAX_PAYLOAD: usize = 64 * 1024;
pub const HEADER_SIZE: usize = MessageHeader::SIZE;
