//! Fixed 16-byte frame header: `magic | version | type | length | sequence`.

use crate::codec::ProtocolError;
use crate::messages::MessageType;
use crate::{MAGIC, MAX_PAYLOAD, VERSION};

#[repr(C)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MessageHeader {
    pub magic: u32,
    pub version: u16,
    pub message_type: u16,
    pub payload_length: u32,
    pub sequence: u32,
}

impl MessageHeader {
    pub const SIZE: usize = 16;

    pub fn new(message_type: MessageType, payload_length: u32, sequence: u32) -> Self {
        Self {
            magic: MAGIC,
            version: VERSION,
            message_type: message_type.as_u16(),
            payload_length,
            sequence,
        }
    }

    pub fn to_bytes(self) -> [u8; Self::SIZE] {
        let mut bytes = [0u8; Self::SIZE];
        bytes[0..4].copy_from_slice(&self.magic.to_le_bytes());
        bytes[4..6].copy_from_slice(&self.version.to_le_bytes());
        bytes[6..8].copy_from_slice(&self.message_type.to_le_bytes());
        bytes[8..12].copy_from_slice(&self.payload_length.to_le_bytes());
        bytes[12..16].copy_from_slice(&self.sequence.to_le_bytes());
        bytes
    }

    pub fn from_bytes(frame: &[u8]) -> Result<Self, ProtocolError> {
        if frame.len() < Self::SIZE {
            return Err(ProtocolError::Truncated {
                needed: Self::SIZE,
                found: frame.len(),
            });
        }
        let magic = u32::from_le_bytes([frame[0], frame[1], frame[2], frame[3]]);
        if magic != MAGIC {
            return Err(ProtocolError::BadMagic { found: magic });
        }
        let version = u16::from_le_bytes([frame[4], frame[5]]);
        if version != VERSION {
            return Err(ProtocolError::UnsupportedVersion {
                found: version,
                supported: VERSION,
            });
        }
        let payload_length = u32::from_le_bytes([frame[8], frame[9], frame[10], frame[11]]);
        if payload_length as usize > MAX_PAYLOAD {
            return Err(ProtocolError::PayloadTooLarge {
                length: payload_length as usize,
                max: MAX_PAYLOAD,
            });
        }
        Ok(Self {
            magic,
            version,
            message_type: u16::from_le_bytes([frame[6], frame[7]]),
            payload_length,
            sequence: u32::from_le_bytes([frame[12], frame[13], frame[14], frame[15]]),
        })
    }

    pub fn message_type(&self) -> Result<MessageType, ProtocolError> {
        MessageType::try_from(self.message_type)
    }
}
