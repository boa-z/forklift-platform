//! Message types and their payload codecs.

use crate::codec::{ProtocolError, Reader, Writer};
use crate::command::SoundId;
use crate::event::{ConnectivityEvent, Fault, FaultSnapshot, SystemState};
use crate::state::VehicleState;

pub const MAX_ERROR_MESSAGE: usize = 128;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u16)]
pub enum MessageType {
    Hello = 0x0001,
    ClientVersion = 0x0002,
    ServerVersion = 0x0003,

    StateVehicle = 0x0100,
    StateFaults = 0x0101,
    StateSystem = 0x0102,

    EventFaultRaised = 0x0200,
    EventFaultCleared = 0x0201,
    EventConnectivity = 0x0202,

    CmdPlaySound = 0x0300,
    CmdSetVolume = 0x0301,
    CmdSetBrightness = 0x0302,
    CmdPing = 0x0303,

    RespOk = 0x0400,
    RespError = 0x0401,
    RespPong = 0x0402,
}

impl MessageType {
    pub fn as_u16(self) -> u16 {
        self as u16
    }
}

impl TryFrom<u16> for MessageType {
    type Error = ProtocolError;

    fn try_from(value: u16) -> Result<Self, Self::Error> {
        match value {
            0x0001 => Ok(Self::Hello),
            0x0002 => Ok(Self::ClientVersion),
            0x0003 => Ok(Self::ServerVersion),
            0x0100 => Ok(Self::StateVehicle),
            0x0101 => Ok(Self::StateFaults),
            0x0102 => Ok(Self::StateSystem),
            0x0200 => Ok(Self::EventFaultRaised),
            0x0201 => Ok(Self::EventFaultCleared),
            0x0202 => Ok(Self::EventConnectivity),
            0x0300 => Ok(Self::CmdPlaySound),
            0x0301 => Ok(Self::CmdSetVolume),
            0x0302 => Ok(Self::CmdSetBrightness),
            0x0303 => Ok(Self::CmdPing),
            0x0400 => Ok(Self::RespOk),
            0x0401 => Ok(Self::RespError),
            0x0402 => Ok(Self::RespPong),
            other => Err(ProtocolError::UnknownMessageType { found: other }),
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum Message {
    /// Client → daemon handshake: the protocol version the UI speaks.
    Hello { client_version: u16 },
    ClientVersion(u16),
    ServerVersion(u16),

    VehicleState(Box<VehicleState>),
    Faults(FaultSnapshot),
    System(SystemState),

    FaultRaised(Fault),
    FaultCleared(Fault),
    Connectivity(ConnectivityEvent),

    PlaySound(SoundId),
    SetVolume(u8),
    SetBrightness(u8),
    Ping(u32),

    Ok,
    Error { code: u16, message: String },
    Pong(u32),
}

impl Message {
    pub fn message_type(&self) -> MessageType {
        match self {
            Self::Hello { .. } => MessageType::Hello,
            Self::ClientVersion(_) => MessageType::ClientVersion,
            Self::ServerVersion(_) => MessageType::ServerVersion,
            Self::VehicleState(_) => MessageType::StateVehicle,
            Self::Faults(_) => MessageType::StateFaults,
            Self::System(_) => MessageType::StateSystem,
            Self::FaultRaised(_) => MessageType::EventFaultRaised,
            Self::FaultCleared(_) => MessageType::EventFaultCleared,
            Self::Connectivity(_) => MessageType::EventConnectivity,
            Self::PlaySound(_) => MessageType::CmdPlaySound,
            Self::SetVolume(_) => MessageType::CmdSetVolume,
            Self::SetBrightness(_) => MessageType::CmdSetBrightness,
            Self::Ping(_) => MessageType::CmdPing,
            Self::Ok => MessageType::RespOk,
            Self::Error { .. } => MessageType::RespError,
            Self::Pong(_) => MessageType::RespPong,
        }
    }

    pub fn encode_payload(&self, writer: &mut Writer) {
        match self {
            Self::Hello { client_version } => writer.put_u16(*client_version),
            Self::ClientVersion(version) | Self::ServerVersion(version) => writer.put_u16(*version),
            Self::VehicleState(state) => state.encode(writer),
            Self::Faults(snapshot) => snapshot.encode(writer),
            Self::System(system) => system.encode(writer),
            Self::FaultRaised(fault) | Self::FaultCleared(fault) => fault.encode(writer),
            Self::Connectivity(event) => event.encode(writer),
            Self::PlaySound(sound) => writer.put_u8(sound.as_u8()),
            Self::SetVolume(volume) | Self::SetBrightness(volume) => writer.put_u8(*volume),
            Self::Ping(nonce) | Self::Pong(nonce) => writer.put_u32(*nonce),
            Self::Ok => {}
            Self::Error { code, message } => {
                writer.put_u16(*code);
                // Encoding failures cannot happen for bounded daemon strings;
                // truncate instead of failing the frame.
                let truncated: String = message.chars().take(MAX_ERROR_MESSAGE).collect();
                let _ = writer.put_string(&truncated);
            }
        }
    }

    pub fn decode(message_type: MessageType, reader: &mut Reader<'_>) -> Result<Self, ProtocolError> {
        Ok(match message_type {
            MessageType::Hello => Self::Hello {
                client_version: reader.u16()?,
            },
            MessageType::ClientVersion => Self::ClientVersion(reader.u16()?),
            MessageType::ServerVersion => Self::ServerVersion(reader.u16()?),
            MessageType::StateVehicle => Self::VehicleState(Box::new(VehicleState::decode(reader)?)),
            MessageType::StateFaults => Self::Faults(FaultSnapshot::decode(reader)?),
            MessageType::StateSystem => Self::System(SystemState::decode(reader)?),
            MessageType::EventFaultRaised => Self::FaultRaised(Fault::decode(reader)?),
            MessageType::EventFaultCleared => Self::FaultCleared(Fault::decode(reader)?),
            MessageType::EventConnectivity => Self::Connectivity(ConnectivityEvent::decode(reader)?),
            MessageType::CmdPlaySound => Self::PlaySound(SoundId::from_u8(reader.u8()?)?),
            MessageType::CmdSetVolume => Self::SetVolume(reader.u8()?),
            MessageType::CmdSetBrightness => Self::SetBrightness(reader.u8()?),
            MessageType::CmdPing => Self::Ping(reader.u32()?),
            MessageType::RespOk => Self::Ok,
            MessageType::RespError => Self::Error {
                code: reader.u16()?,
                message: reader.string(MAX_ERROR_MESSAGE)?,
            },
            MessageType::RespPong => Self::Pong(reader.u32()?),
        })
    }
}
