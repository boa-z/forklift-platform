//! Commands the UI may send. The set is deliberately small; anything the UI
//! needs that is not here belongs in a daemon policy, not in a new command.

use crate::codec::ProtocolError;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SoundId {
    Button = 0,
    Warning = 1,
    Reverse = 2,
    Fault = 3,
    Startup = 4,
}

impl SoundId {
    /// 由线格式值还原音效枚举，未知值报错。
    pub fn from_u8(value: u8) -> Result<Self, ProtocolError> {
        match value {
            0 => Ok(Self::Button),
            1 => Ok(Self::Warning),
            2 => Ok(Self::Reverse),
            3 => Ok(Self::Fault),
            4 => Ok(Self::Startup),
            other => Err(ProtocolError::InvalidEnum {
                field: "SoundId",
                value: other as u32,
            }),
        }
    }

    /// 音效的线格式值。
    pub fn as_u8(self) -> u8 {
        self as u8
    }
}
