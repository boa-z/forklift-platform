//! Wire primitives for the versioned binary protocol.
//!
//! Every integer is little-endian; the wire layout never depends on Rust's
//! `repr(C)` or target endianness.

use thiserror::Error;

use crate::messages::Message;
use crate::state;
use crate::{MAX_PAYLOAD, VERSION};

#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum ProtocolError {
    #[error("truncated frame: needed {needed} bytes, found {found}")]
    Truncated { needed: usize, found: usize },
    #[error("bad magic: 0x{found:08x}")]
    BadMagic { found: u32 },
    #[error("unsupported protocol version {found} (supported {supported})")]
    UnsupportedVersion { found: u16, supported: u16 },
    #[error("unknown message type 0x{found:04x}")]
    UnknownMessageType { found: u16 },
    #[error("payload of {length} bytes exceeds the {max}-byte limit")]
    PayloadTooLarge { length: usize, max: usize },
    #[error("payload length mismatch: header says {expected}, decoded {found}")]
    LengthMismatch { expected: usize, found: usize },
    #[error("invalid enum value {value} for {field}")]
    InvalidEnum { field: &'static str, value: u32 },
    #[error("invalid UTF-8 string")]
    InvalidUtf8,
    #[error("string exceeds its length limit")]
    StringTooLong,
}

/// Little-endian payload writer.
#[derive(Default)]
pub struct Writer {
    buf: Vec<u8>,
}

impl Writer {
    /// 创建空写入器。
    pub fn new() -> Self {
        Self { buf: Vec::new() }
    }

    /// 预分配容量创建写入器。
    pub fn with_capacity(capacity: usize) -> Self {
        Self {
            buf: Vec::with_capacity(capacity),
        }
    }

    /// 取出底层字节。
    pub fn into_vec(self) -> Vec<u8> {
        self.buf
    }

    /// 当前已写入字节数。
    pub fn len(&self) -> usize {
        self.buf.len()
    }

    /// 是否尚未写入任何字节。
    pub fn is_empty(&self) -> bool {
        self.buf.is_empty()
    }

    /// 写入 1 字节。
    pub fn put_u8(&mut self, value: u8) {
        self.buf.push(value);
    }

    /// 以 1 字节写入布尔值。
    pub fn put_bool(&mut self, value: bool) {
        self.buf.push(u8::from(value));
    }

    /// 以小端写入 u16。
    pub fn put_u16(&mut self, value: u16) {
        self.buf.extend_from_slice(&value.to_le_bytes());
    }

    /// 以小端写入 u32。
    pub fn put_u32(&mut self, value: u32) {
        self.buf.extend_from_slice(&value.to_le_bytes());
    }

    /// 以小端写入 u64。
    pub fn put_u64(&mut self, value: u64) {
        self.buf.extend_from_slice(&value.to_le_bytes());
    }

    /// 以小端写入 i32。
    pub fn put_i32(&mut self, value: i32) {
        self.buf.extend_from_slice(&value.to_le_bytes());
    }

    /// 按 IEEE-754 位模式写入 f32。
    pub fn put_f32(&mut self, value: f32) {
        self.buf.extend_from_slice(&value.to_le_bytes());
    }

    /// 写入原始字节。
    pub fn put_bytes(&mut self, bytes: &[u8]) {
        self.buf.extend_from_slice(bytes);
    }

    /// Length-prefixed (`u16`) UTF-8 string.
    /// 写入 `u16` 长度前缀的 UTF-8 字符串。
    pub fn put_string(&mut self, value: &str) -> Result<(), ProtocolError> {
        if value.len() > u16::MAX as usize {
            return Err(ProtocolError::StringTooLong);
        }
        self.put_u16(value.len() as u16);
        self.put_bytes(value.as_bytes());
        Ok(())
    }
}

/// Bounds-checked little-endian reader.
pub struct Reader<'a> {
    buf: &'a [u8],
    pos: usize,
}

impl<'a> Reader<'a> {
    /// 从字节切片创建读取器。
    pub fn new(buf: &'a [u8]) -> Self {
        Self { buf, pos: 0 }
    }

    /// 剩余未读字节数。
    pub fn remaining(&self) -> usize {
        self.buf.len().saturating_sub(self.pos)
    }

    /// 取走 `length` 字节，越界时报错。
    fn take(&mut self, length: usize) -> Result<&'a [u8], ProtocolError> {
        if self.remaining() < length {
            return Err(ProtocolError::Truncated {
                needed: length,
                found: self.remaining(),
            });
        }
        let slice = &self.buf[self.pos..self.pos + length];
        self.pos += length;
        Ok(slice)
    }

    /// 读取 1 字节。
    pub fn u8(&mut self) -> Result<u8, ProtocolError> {
        Ok(self.take(1)?[0])
    }

    /// 读取 1 字节布尔值（非零为真）。
    pub fn bool(&mut self) -> Result<bool, ProtocolError> {
        Ok(self.u8()? != 0)
    }

    /// 读取小端 u16。
    pub fn u16(&mut self) -> Result<u16, ProtocolError> {
        let bytes = self.take(2)?;
        Ok(u16::from_le_bytes([bytes[0], bytes[1]]))
    }

    /// 读取小端 u32。
    pub fn u32(&mut self) -> Result<u32, ProtocolError> {
        let bytes = self.take(4)?;
        Ok(u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]))
    }

    /// 读取小端 u64。
    pub fn u64(&mut self) -> Result<u64, ProtocolError> {
        let bytes = self.take(8)?;
        let mut array = [0u8; 8];
        array.copy_from_slice(bytes);
        Ok(u64::from_le_bytes(array))
    }

    /// 读取小端 i32。
    pub fn i32(&mut self) -> Result<i32, ProtocolError> {
        Ok(self.u32()? as i32)
    }

    /// 读取 IEEE-754 位模式的 f32。
    pub fn f32(&mut self) -> Result<f32, ProtocolError> {
        Ok(f32::from_bits(self.u32()?))
    }

    /// 读取长度前缀字符串，并限制最大长度。
    pub fn string(&mut self, max_length: usize) -> Result<String, ProtocolError> {
        let length = self.u16()? as usize;
        if length > max_length {
            return Err(ProtocolError::StringTooLong);
        }
        let bytes = self.take(length)?;
        String::from_utf8(bytes.to_vec()).map_err(|_| ProtocolError::InvalidUtf8)
    }
}

/// 把一条消息编码为完整帧（帧头 + 载荷）。
pub fn encode(sequence: u32, message: &Message) -> Vec<u8> {
    let mut payload = Writer::with_capacity(256);
    message.encode_payload(&mut payload);
    let payload = payload.into_vec();
    debug_assert!(payload.len() <= MAX_PAYLOAD);

    let header = crate::header::MessageHeader::new(message.message_type(), payload.len() as u32, sequence);
    let mut frame = Vec::with_capacity(crate::HEADER_SIZE + payload.len());
    frame.extend_from_slice(&header.to_bytes());
    frame.extend_from_slice(&payload);
    frame
}

/// 解码完整帧；多余或缺失字节都会被拒绝。
pub fn decode(frame: &[u8]) -> Result<(crate::header::MessageHeader, Message), ProtocolError> {
    let header = crate::header::MessageHeader::from_bytes(frame)?;
    let payload = &frame[crate::HEADER_SIZE..];
    if payload.len() != header.payload_length as usize {
        return Err(ProtocolError::LengthMismatch {
            expected: header.payload_length as usize,
            found: payload.len(),
        });
    }
    let mut reader = Reader::new(payload);
    let message = Message::decode(header.message_type()?, &mut reader)?;
    if reader.remaining() != 0 {
        return Err(ProtocolError::LengthMismatch {
            expected: payload.len(),
            found: payload.len() - reader.remaining(),
        });
    }
    Ok((header, message))
}

/// 编码一条 `STATE_VEHICLE` 车辆状态帧。
pub fn encode_vehicle_state(sequence: u32, state: &state::VehicleState) -> Vec<u8> {
    encode(sequence, &Message::VehicleState(Box::new(state.clone())))
}

/// 当前支持的协议版本。
pub fn supported_version() -> u16 {
    VERSION
}
