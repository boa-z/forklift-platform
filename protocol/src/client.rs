//! Blocking IPC client shared by the simulator, integration tests, and the
//! platform bridge reference implementation.

use std::os::fd::OwnedFd;
use std::path::Path;
use std::time::Duration;

use thiserror::Error;

use crate::codec::{decode, encode, ProtocolError};
use crate::header::MessageHeader;
use crate::messages::Message;
use crate::socket;
use crate::{HEADER_SIZE, MAX_PAYLOAD, VERSION};

#[derive(Debug, Error)]
pub enum ClientError {
    #[error("connect {path}: {source}")]
    Connect { path: String, source: std::io::Error },
    #[error("socket: {0}")]
    Io(#[from] std::io::Error),
    #[error("protocol: {0}")]
    Protocol(#[from] ProtocolError),
    #[error("frame of {0} bytes exceeds the receive buffer")]
    Oversized(usize),
    #[error("daemon closed the connection")]
    Closed,
    #[error("receive timed out")]
    Timeout,
    #[error("protocol version mismatch: client {client}, daemon {daemon}")]
    VersionMismatch { client: u16, daemon: u16 },
    #[error("daemon refused the handshake: {0}")]
    Refused(String),
    #[error("unexpected message during handshake: {0:?}")]
    UnexpectedHandshake(Box<Message>),
}

pub struct Client {
    fd: OwnedFd,
    sequence: u32,
    buffer: Vec<u8>,
}

impl Client {
    pub fn connect(path: impl AsRef<Path>) -> Result<Self, ClientError> {
        let path = path.as_ref();
        let fd = socket::connect(path).map_err(|source| ClientError::Connect {
            path: path.display().to_string(),
            source,
        })?;
        Ok(Self {
            fd,
            sequence: 1,
            buffer: vec![0u8; HEADER_SIZE + MAX_PAYLOAD],
        })
    }

    pub fn sequence(&self) -> u32 {
        self.sequence
    }

    fn take_sequence(&mut self) -> u32 {
        let sequence = self.sequence;
        self.sequence = self.sequence.wrapping_add(1);
        sequence
    }

    pub fn send(&mut self, message: &Message) -> Result<u32, ClientError> {
        let sequence = self.take_sequence();
        let frame = encode(sequence, message);
        socket::send(&self.fd, &frame)?;
        Ok(sequence)
    }

    pub fn recv(&mut self) -> Result<(MessageHeader, Message), ClientError> {
        self.recv_frame(None)
    }

    pub fn recv_timeout(&mut self, timeout: Duration) -> Result<(MessageHeader, Message), ClientError> {
        self.recv_frame(Some(timeout))
    }

    fn recv_frame(&mut self, timeout: Option<Duration>) -> Result<(MessageHeader, Message), ClientError> {
        if !socket::poll_readable(&self.fd, timeout)? {
            return Err(ClientError::Timeout);
        }
        let read = socket::recv(&self.fd, &mut self.buffer)?;
        if read == 0 {
            return Err(ClientError::Closed);
        }
        let frame = &self.buffer[..read];
        if frame.len() > HEADER_SIZE + MAX_PAYLOAD {
            return Err(ClientError::Oversized(frame.len()));
        }
        let (header, message) = decode(frame)?;
        Ok((header, message))
    }

    /// Sends `HELLO` and waits for the daemon's `SERVER_VERSION`.
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
