//! 消息类型及其载荷编解码。

use crate::codec::{ProtocolError, Reader, Writer};
use crate::command::SoundId;
use crate::event::{
    AntiDismantleEvent, AuthStateEvent, ConnectivityEvent, Fault, FaultSnapshot, RtcEvent,
    SystemState,
};
use crate::mcu::SwipeReport;
use crate::state::VehicleState;

pub const MAX_ERROR_MESSAGE: usize = 128;
/// 密码/身份证尾号等客户端字符串的上限。
pub const MAX_PASSWORD: usize = 32;

/// 写入有界字符串；超出上限时截断（编码端不失败）。
fn put_bounded_string(writer: &mut Writer, value: &str) {
    let bounded: String = value.chars().take(MAX_PASSWORD).collect();
    let _ = writer.put_string(&bounded);
}

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
    EventSwipeReport = 0x0203,
    EventAuthState = 0x0204,
    EventAntiDismantle = 0x0205,
    EventRtc = 0x0206,

    CmdPlaySound = 0x0300,
    CmdSetVolume = 0x0301,
    CmdSetBrightness = 0x0302,
    CmdPing = 0x0303,
    CmdReportPowerOn = 0x0304,
    CmdSwipeReply = 0x0305,
    CmdVerifyPassword = 0x0306,
    CmdSetAdminPassword = 0x0307,
    CmdEnterLicenseTail = 0x0308,
    CmdSetAntiDismantle = 0x0309,
    CmdGetSettings = 0x030A,
    CmdSetSettings = 0x030B,

    RespOk = 0x0400,
    RespError = 0x0401,
    RespPong = 0x0402,
    RespAuthLevel = 0x0403,
    RespSettings = 0x0404,
}

impl MessageType {
    /// 类型码的线格式值。
    pub fn as_u16(self) -> u16 {
        self as u16
    }
}

impl TryFrom<u16> for MessageType {
    type Error = ProtocolError;

    /// 由线格式类型码还原枚举，未知值报错。
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
            0x0203 => Ok(Self::EventSwipeReport),
            0x0204 => Ok(Self::EventAuthState),
            0x0205 => Ok(Self::EventAntiDismantle),
            0x0206 => Ok(Self::EventRtc),
            0x0300 => Ok(Self::CmdPlaySound),
            0x0301 => Ok(Self::CmdSetVolume),
            0x0302 => Ok(Self::CmdSetBrightness),
            0x0303 => Ok(Self::CmdPing),
            0x0304 => Ok(Self::CmdReportPowerOn),
            0x0305 => Ok(Self::CmdSwipeReply),
            0x0306 => Ok(Self::CmdVerifyPassword),
            0x0307 => Ok(Self::CmdSetAdminPassword),
            0x0308 => Ok(Self::CmdEnterLicenseTail),
            0x0309 => Ok(Self::CmdSetAntiDismantle),
            0x030a => Ok(Self::CmdGetSettings),
            0x030b => Ok(Self::CmdSetSettings),
            0x0400 => Ok(Self::RespOk),
            0x0401 => Ok(Self::RespError),
            0x0402 => Ok(Self::RespPong),
            0x0403 => Ok(Self::RespAuthLevel),
            0x0404 => Ok(Self::RespSettings),
            other => Err(ProtocolError::UnknownMessageType { found: other }),
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum Message {
    /// 客户端 → daemon 握手：声明 UI 使用的协议版本。
    Hello { client_version: u16 },
    ClientVersion(u16),
    ServerVersion(u16),

    VehicleState(Box<VehicleState>),
    Faults(FaultSnapshot),
    System(SystemState),

    FaultRaised(Fault),
    FaultCleared(Fault),
    Connectivity(ConnectivityEvent),
    /// 模组上报的刷卡信息（UI 展示并做双重认证）。
    SwipeReport(SwipeReport),
    /// 授权状态变化（权限级别/是否已授权）。
    AuthState(AuthStateEvent),
    /// 防拆状态（使能/报警）。
    AntiDismantle(AntiDismantleEvent),
    /// 模组 RTC 时间。
    Rtc(RtcEvent),

    PlaySound(SoundId),
    SetVolume(u8),
    SetBrightness(u8),
    Ping(u32),
    /// UI → daemon：上报本次开机方式（密码/刷卡/蓝牙）。
    ReportPowerOn { kind: u8, card: [u8; 4] },
    /// UI → daemon：回给模组的刷卡处理结果。
    SwipeReply { status: u8 },
    /// UI → daemon：校验设置密码，返回权限级别。
    VerifyPassword { password: String },
    /// UI → daemon：修改管理员密码。
    SetAdminPassword {
        old_password: String,
        new_password: String,
    },
    /// UI → daemon：双重认证的身份证后 4/6 位。
    EnterLicenseTail { digits: String },
    /// UI → daemon：设置防拆使能。
    SetAntiDismantle { enabled: bool },
    /// UI → daemon：查询 UI 设置位域。
    GetSettings,
    /// UI → daemon：写入 UI 设置位域。
    SetSettings { flags: u8 },

    Ok,
    Error { code: u16, message: String },
    Pong(u32),
    /// daemon → UI：密码校验结果（0=用户，1=管理员，2=超级管理员）。
    AuthLevel(u8),
    /// daemon → UI：UI 设置位域（bit0 自检/bit1 授权/bit2 密码开机/bit3 防拆）。
    Settings { flags: u8 },
}

impl Message {
    /// 消息对应的类型码。
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
            Self::SwipeReport(_) => MessageType::EventSwipeReport,
            Self::AuthState(_) => MessageType::EventAuthState,
            Self::AntiDismantle(_) => MessageType::EventAntiDismantle,
            Self::Rtc(_) => MessageType::EventRtc,
            Self::PlaySound(_) => MessageType::CmdPlaySound,
            Self::SetVolume(_) => MessageType::CmdSetVolume,
            Self::SetBrightness(_) => MessageType::CmdSetBrightness,
            Self::Ping(_) => MessageType::CmdPing,
            Self::ReportPowerOn { .. } => MessageType::CmdReportPowerOn,
            Self::SwipeReply { .. } => MessageType::CmdSwipeReply,
            Self::VerifyPassword { .. } => MessageType::CmdVerifyPassword,
            Self::SetAdminPassword { .. } => MessageType::CmdSetAdminPassword,
            Self::EnterLicenseTail { .. } => MessageType::CmdEnterLicenseTail,
            Self::SetAntiDismantle { .. } => MessageType::CmdSetAntiDismantle,
            Self::GetSettings => MessageType::CmdGetSettings,
            Self::SetSettings { .. } => MessageType::CmdSetSettings,
            Self::Ok => MessageType::RespOk,
            Self::Error { .. } => MessageType::RespError,
            Self::Pong(_) => MessageType::RespPong,
            Self::AuthLevel(_) => MessageType::RespAuthLevel,
            Self::Settings { .. } => MessageType::RespSettings,
        }
    }

    /// 按消息类型写入载荷。
    pub fn encode_payload(&self, writer: &mut Writer) {
        match self {
            Self::Hello { client_version } => writer.put_u16(*client_version),
            Self::ClientVersion(version) | Self::ServerVersion(version) => writer.put_u16(*version),
            Self::VehicleState(state) => state.encode(writer),
            Self::Faults(snapshot) => snapshot.encode(writer),
            Self::System(system) => system.encode(writer),
            Self::FaultRaised(fault) | Self::FaultCleared(fault) => fault.encode(writer),
            Self::Connectivity(event) => event.encode(writer),
            Self::SwipeReport(report) => writer.put_bytes(&report.encode()),
            Self::AuthState(state) => state.encode(writer),
            Self::AntiDismantle(state) => state.encode(writer),
            Self::Rtc(rtc) => rtc.encode(writer),
            Self::PlaySound(sound) => writer.put_u8(sound.as_u8()),
            Self::SetVolume(volume) | Self::SetBrightness(volume) => writer.put_u8(*volume),
            Self::Ping(nonce) | Self::Pong(nonce) => writer.put_u32(*nonce),
            Self::ReportPowerOn { kind, card } => {
                writer.put_u8(*kind);
                writer.put_bytes(card);
            }
            Self::SwipeReply { status } => writer.put_u8(*status),
            Self::VerifyPassword { password } => put_bounded_string(writer, password),
            Self::SetAdminPassword {
                old_password,
                new_password,
            } => {
                put_bounded_string(writer, old_password);
                put_bounded_string(writer, new_password);
            }
            Self::EnterLicenseTail { digits } => put_bounded_string(writer, digits),
            Self::SetAntiDismantle { enabled } => writer.put_bool(*enabled),
            Self::GetSettings => {}
            Self::SetSettings { flags } | Self::Settings { flags } => writer.put_u8(*flags),
            Self::Ok => {}
            Self::Error { code, message } => {
                writer.put_u16(*code);
                // Encoding failures cannot happen for bounded daemon strings;
                // truncate instead of failing the frame.
                let truncated: String = message.chars().take(MAX_ERROR_MESSAGE).collect();
                let _ = writer.put_string(&truncated);
            }
            Self::AuthLevel(level) => writer.put_u8(*level),
        }
    }

    /// 按消息类型解析载荷。
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
            MessageType::EventSwipeReport => {
                let bytes = reader.take(crate::mcu::SWIPE_REPORT_LEN)?;
                Self::SwipeReport(SwipeReport::decode(bytes).map_err(|error| {
                    ProtocolError::InvalidMcuPayload {
                        message: error.to_string(),
                    }
                })?)
            }
            MessageType::EventAuthState => Self::AuthState(AuthStateEvent::decode(reader)?),
            MessageType::EventAntiDismantle => {
                Self::AntiDismantle(AntiDismantleEvent::decode(reader)?)
            }
            MessageType::EventRtc => Self::Rtc(RtcEvent::decode(reader)?),
            MessageType::CmdPlaySound => Self::PlaySound(SoundId::from_u8(reader.u8()?)?),
            MessageType::CmdSetVolume => Self::SetVolume(reader.u8()?),
            MessageType::CmdSetBrightness => Self::SetBrightness(reader.u8()?),
            MessageType::CmdPing => Self::Ping(reader.u32()?),
            MessageType::CmdReportPowerOn => {
                let kind = reader.u8()?;
                let mut card = [0u8; 4];
                card.copy_from_slice(reader.take(4)?);
                Self::ReportPowerOn { kind, card }
            }
            MessageType::CmdSwipeReply => Self::SwipeReply {
                status: reader.u8()?,
            },
            MessageType::CmdVerifyPassword => Self::VerifyPassword {
                password: reader.string(MAX_PASSWORD)?,
            },
            MessageType::CmdSetAdminPassword => Self::SetAdminPassword {
                old_password: reader.string(MAX_PASSWORD)?,
                new_password: reader.string(MAX_PASSWORD)?,
            },
            MessageType::CmdEnterLicenseTail => Self::EnterLicenseTail {
                digits: reader.string(MAX_PASSWORD)?,
            },
            MessageType::CmdSetAntiDismantle => Self::SetAntiDismantle {
                enabled: reader.bool()?,
            },
            MessageType::CmdGetSettings => Self::GetSettings,
            MessageType::CmdSetSettings => Self::SetSettings { flags: reader.u8()? },
            MessageType::RespOk => Self::Ok,
            MessageType::RespError => Self::Error {
                code: reader.u16()?,
                message: reader.string(MAX_ERROR_MESSAGE)?,
            },
            MessageType::RespPong => Self::Pong(reader.u32()?),
            MessageType::RespAuthLevel => Self::AuthLevel(reader.u8()?),
            MessageType::RespSettings => Self::Settings { flags: reader.u8()? },
        })
    }
}
