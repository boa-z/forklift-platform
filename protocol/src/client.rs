//! 阻塞式 IPC 客户端：模拟器、集成测试与平台 bridge 参考实现共用。
//! 封装在 `socket::Connection` 之上，Linux 走 SEQPACKET、macOS 走流式组帧。

use std::io;
use std::path::Path;
use std::time::Duration;

use thiserror::Error;

use crate::codec::{decode, encode, ProtocolError};
use crate::header::MessageHeader;
use crate::messages::Message;
use crate::socket::{Connection, FrameRead};
use crate::{HEADER_SIZE, MAX_PAYLOAD, VERSION};

#[derive(Debug, Error)]
pub enum ClientError {
    #[error("连接 {path} 失败：{source}")]
    Connect { path: String, source: io::Error },
    #[error("socket：{0}")]
    Io(#[from] io::Error),
    #[error("协议：{0}")]
    Protocol(#[from] ProtocolError),
    #[error("帧长度 {0} 超出接收缓冲")]
    Oversized(usize),
    #[error("daemon 已关闭连接")]
    Closed,
    #[error("接收超时")]
    Timeout,
    #[error("协议版本不匹配：客户端 {client}，daemon {daemon}")]
    VersionMismatch { client: u16, daemon: u16 },
    #[error("daemon 拒绝握手：{0}")]
    Refused(String),
    #[error("握手期间收到非预期消息：{0:?}")]
    UnexpectedHandshake(Box<Message>),
}

pub struct Client {
    connection: Connection,
    sequence: u32,
}

impl Client {
    /// 连接到 daemon/simulator 的 socket。
    pub fn connect(path: impl AsRef<Path>) -> Result<Self, ClientError> {
        let path = path.as_ref();
        let connection = Connection::connect(path).map_err(|source| ClientError::Connect {
            path: path.display().to_string(),
            source,
        })?;
        Ok(Self {
            connection,
            sequence: 1,
        })
    }

    /// 下一个发送序号（只读）。
    pub fn sequence(&self) -> u32 {
        self.sequence
    }

    /// 取号并自增；回包可据此对账。
    fn take_sequence(&mut self) -> u32 {
        let sequence = self.sequence;
        self.sequence = self.sequence.wrapping_add(1);
        sequence
    }

    /// 发送一条消息，返回本次使用的序号。
    pub fn send(&mut self, message: &Message) -> Result<u32, ClientError> {
        let sequence = self.take_sequence();
        let frame = encode(sequence, message);
        self.connection.send(&frame)?;
        Ok(sequence)
    }

    /// 阻塞接收一条消息。
    pub fn recv(&mut self) -> Result<(MessageHeader, Message), ClientError> {
        self.recv_frame(None)
    }

    /// 带超时接收一条消息。
    pub fn recv_timeout(&mut self, timeout: Duration) -> Result<(MessageHeader, Message), ClientError> {
        self.recv_frame(Some(timeout))
    }

    /// 接收并解码一帧，把传输结果映射为客户端错误。
    fn recv_frame(
        &mut self,
        timeout: Option<Duration>,
    ) -> Result<(MessageHeader, Message), ClientError> {
        match self.connection.recv_frame(timeout)? {
            FrameRead::Frame(bytes) => {
                if bytes.len() > HEADER_SIZE + MAX_PAYLOAD {
                    return Err(ClientError::Oversized(bytes.len()));
                }
                let (header, message) = decode(&bytes)?;
                Ok((header, message))
            }
            FrameRead::Timeout => Err(ClientError::Timeout),
            FrameRead::Closed => Err(ClientError::Closed),
        }
    }

    /// 发送 HELLO 并等待 SERVER_VERSION；版本不符直接报错，不静默继续。
    pub fn handshake(&mut self) -> Result<u16, ClientError> {
        self.send(&Message::Hello {
            client_version: VERSION,
        })?;
        let (_, message) = self.recv_timeout(Duration::from_secs(5))?;
        match message {
            Message::ServerVersion(daemon) => {
                if daemon != VERSION {
                    return Err(ClientError::VersionMismatch {
                        client: VERSION,
                        daemon,
                    });
                }
                Ok(daemon)
            }
            Message::Error { message, .. } => Err(ClientError::Refused(message)),
            other => Err(ClientError::UnexpectedHandshake(Box::new(other))),
        }
    }
}
