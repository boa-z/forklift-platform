//! UI 可以发送的命令。集合刻意保持最小；UI 需要但这里没有的能力，
//! 应该做成 daemon 策略，而不是新增命令。

use crate::codec::ProtocolError;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SoundId {
    Button = 0,
    Warning = 1,
    Reverse = 2,
    Fault = 3,
    Startup = 4,
    // v4：与参考工程语音表对齐的提示/报警音（追加，不复用编号）。
    CardSwipe = 5,
    CardOk = 6,
    CardFail = 7,
    Overspeed = 8,
    OverspeedHigh = 9,
    OverspeedCritical = 10,
    Seatbelt = 11,
    SeatOff = 12,
    ObstacleFar = 13,
    ObstacleNear = 14,
    ObstacleBrake = 15,
    Collision = 16,
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
            5 => Ok(Self::CardSwipe),
            6 => Ok(Self::CardOk),
            7 => Ok(Self::CardFail),
            8 => Ok(Self::Overspeed),
            9 => Ok(Self::OverspeedHigh),
            10 => Ok(Self::OverspeedCritical),
            11 => Ok(Self::Seatbelt),
            12 => Ok(Self::SeatOff),
            13 => Ok(Self::ObstacleFar),
            14 => Ok(Self::ObstacleNear),
            15 => Ok(Self::ObstacleBrake),
            16 => Ok(Self::Collision),
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
