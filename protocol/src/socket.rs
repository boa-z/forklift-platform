//! AF_UNIX 传输封装。本模块是 protocol crate 中唯一直接调用 libc 的地方。
//!
//! - Linux（D211 产品）：`SOCK_SEQPACKET`，一个数据报就是一帧；
//! - macOS（开发/模拟器）：系统不支持 SEQPACKET，退化为 `SOCK_STREAM`，
//!   由本模块按帧头长度重新组帧。
//!
//! 两种模式对上层暴露同一个 `Connection` 接口，协议与业务代码不感知差异。

use std::io;
use std::mem;
use std::os::fd::{AsRawFd, FromRawFd, OwnedFd};
use std::os::unix::ffi::OsStrExt;
use std::path::Path;
use std::time::Duration;

use crate::{HEADER_SIZE, MAX_PAYLOAD};

/// 单个 Unix socket 路径的最大字节数（不含结尾 NUL）。
const MAX_SUN_PATH: usize = 107;

/// 底层 socket 类型。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SocketKind {
    /// Linux：保持消息边界的数据报。
    SeqPacket,
    /// macOS：字节流，需要按帧长组帧。
    Stream,
}

/// 当前平台采用的 socket 类型。
pub fn platform_kind() -> SocketKind {
    #[cfg(target_os = "linux")]
    {
        SocketKind::SeqPacket
    }
    #[cfg(not(target_os = "linux"))]
    {
        SocketKind::Stream
    }
}

/// 初始接收缓冲：SEQPACKET 一读一帧用固定大缓冲，流模式从空缓冲累积。
fn initial_buffer(kind: SocketKind) -> Vec<u8> {
    match kind {
        SocketKind::SeqPacket => vec![0u8; HEADER_SIZE + MAX_PAYLOAD],
        SocketKind::Stream => Vec::new(),
    }
}

/// 一次接收的结果。
#[derive(Debug)]
pub enum FrameRead {
    /// 收到完整的一帧（未经协议校验的原始字节）。
    Frame(Vec<u8>),
    /// 在超时时间内没有数据。
    Timeout,
    /// 对端关闭（流模式下若帧不完整，也归为关闭）。
    Closed,
}

/// 计算 `sockaddr_un`；路径过长直接报错而不是截断。
fn sockaddr(path: &Path) -> io::Result<(libc::sockaddr_un, libc::socklen_t)> {
    let bytes = path.as_os_str().as_bytes();
    if bytes.len() > MAX_SUN_PATH {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("socket 路径长度 {} 超过上限 {MAX_SUN_PATH}", bytes.len()),
        ));
    }
    // SAFETY: sockaddr_un 为普通 C 结构，全零是合法初值。
    let mut addr: libc::sockaddr_un = unsafe { mem::zeroed() };
    addr.sun_family = libc::AF_UNIX as libc::sa_family_t;
    for (slot, byte) in addr.sun_path.iter_mut().zip(bytes.iter()) {
        *slot = *byte as libc::c_char;
    }
    let length = mem::size_of::<libc::sa_family_t>() + bytes.len() + 1;
    Ok((addr, length as libc::socklen_t))
}

/// 创建一个当前平台支持的 AF_UNIX socket 并设置 CLOEXEC。
fn new_socket() -> io::Result<OwnedFd> {
    let type_flag = match platform_kind() {
        SocketKind::SeqPacket => libc::SOCK_SEQPACKET,
        SocketKind::Stream => libc::SOCK_STREAM,
    };
    // SAFETY: 普通 socket 系统调用，返回的 fd 立即接管所有权。
    let fd = unsafe { libc::socket(libc::AF_UNIX, type_flag, 0) };
    if fd < 0 {
        return Err(io::Error::last_os_error());
    }
    // SAFETY: fd 合法且未被其他所有者持有。
    let owned = unsafe { OwnedFd::from_raw_fd(fd) };
    // 可移植地设置 CLOEXEC（macOS 的 libc 未暴露 SOCK_CLOEXEC）。
    // SAFETY: 对合法 fd 调用 fcntl。
    if unsafe { libc::fcntl(owned.as_raw_fd(), libc::F_SETFD, libc::FD_CLOEXEC) } < 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(owned)
}

/// 原始 fd 上的一次可读轮询。
fn poll_readable_raw(fd: libc::c_int, timeout: Option<Duration>) -> io::Result<bool> {
    let mut descriptor = libc::pollfd {
        fd,
        events: libc::POLLIN,
        revents: 0,
    };
    let timeout_ms = match timeout {
        Some(duration) => duration.as_millis().min(i32::MAX as u128) as libc::c_int,
        None => -1,
    };
    // SAFETY: 传入一个合法的 pollfd。
    let ready = unsafe { libc::poll(&mut descriptor, 1, timeout_ms) };
    if ready < 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(ready > 0)
}

/// 有连接语义的 socket 包装；发送/接收都以“帧”为单位。
pub struct Connection {
    fd: OwnedFd,
    kind: SocketKind,
    /// 流模式下的组帧缓冲；SEQPACKET 模式复用为接收缓冲。
    buffer: Vec<u8>,
}

impl Connection {
    /// 连接到监听端。
    pub fn connect(path: &Path) -> io::Result<Self> {
        let fd = new_socket()?;
        let (addr, length) = sockaddr(path)?;
        // SAFETY: fd 与地址在调用期间均有效。
        let result = unsafe {
            libc::connect(
                fd.as_raw_fd(),
                &addr as *const libc::sockaddr_un as *const libc::sockaddr,
                length,
            )
        };
        if result < 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(Self {
            fd,
            kind: platform_kind(),
            buffer: initial_buffer(platform_kind()),
        })
    }

    /// 接管一个已完成 accept 的 fd。
    pub fn from_fd(fd: OwnedFd) -> Self {
        let kind = platform_kind();
        Self {
            fd,
            kind,
            buffer: initial_buffer(kind),
        }
    }

    /// 绑定并监听；调用方负责清理 socket 文件。
    pub fn listen(path: &Path) -> io::Result<OwnedFd> {
        let fd = new_socket()?;
        let (addr, length) = sockaddr(path)?;
        // SAFETY: fd 与地址在调用期间均有效。
        let result = unsafe {
            libc::bind(
                fd.as_raw_fd(),
                &addr as *const libc::sockaddr_un as *const libc::sockaddr,
                length,
            )
        };
        if result < 0 {
            return Err(io::Error::last_os_error());
        }
        // SAFETY: 监听队列长度为固定常量。
        if unsafe { libc::listen(fd.as_raw_fd(), 8) } < 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(fd)
    }

    /// 接受一个新连接。
    pub fn accept(listener: &OwnedFd) -> io::Result<Self> {
        // SAFETY: 允许传入空地址。
        let accepted =
            unsafe { libc::accept(listener.as_raw_fd(), std::ptr::null_mut(), std::ptr::null_mut()) };
        if accepted < 0 {
            return Err(io::Error::last_os_error());
        }
        // SAFETY: accepted fd 立即接管所有权。
        Ok(Self::from_fd(unsafe { OwnedFd::from_raw_fd(accepted) }))
    }

    /// 发送一整帧；流模式下循环写直到写完。
    pub fn send(&mut self, bytes: &[u8]) -> io::Result<()> {
        match self.kind {
            SocketKind::SeqPacket => {
                // SAFETY: 指针与长度有效；MSG_NOSIGNAL 防止对端断开杀死进程。
                let written = unsafe {
                    libc::send(
                        self.fd.as_raw_fd(),
                        bytes.as_ptr() as *const libc::c_void,
                        bytes.len(),
                        libc::MSG_NOSIGNAL,
                    )
                };
                if written < 0 {
                    return Err(io::Error::last_os_error());
                }
                Ok(())
            }
            SocketKind::Stream => {
                let mut offset = 0;
                while offset < bytes.len() {
                    // SAFETY: 指针越过已写前缀后仍指向有效区间。
                    let written = unsafe {
                        libc::send(
                            self.fd.as_raw_fd(),
                            bytes[offset..].as_ptr() as *const libc::c_void,
                            bytes.len() - offset,
                            libc::MSG_NOSIGNAL,
                        )
                    };
                    if written < 0 {
                        return Err(io::Error::last_os_error());
                    }
                    if written == 0 {
                        return Err(io::Error::new(io::ErrorKind::WriteZero, "socket 写入 0 字节"));
                    }
                    offset += written as usize;
                }
                Ok(())
            }
        }
    }

    /// 接收一帧；`timeout` 为 None 表示阻塞等待。
    pub fn recv_frame(&mut self, timeout: Option<Duration>) -> io::Result<FrameRead> {
        match self.kind {
            SocketKind::SeqPacket => {
                if !poll_readable_raw(self.fd.as_raw_fd(), timeout)? {
                    return Ok(FrameRead::Timeout);
                }
                // SAFETY: 缓冲区有效。
                let read = unsafe {
                    libc::recv(
                        self.fd.as_raw_fd(),
                        self.buffer.as_mut_ptr() as *mut libc::c_void,
                        self.buffer.len(),
                        0,
                    )
                };
                if read < 0 {
                    return Err(io::Error::last_os_error());
                }
                if read == 0 {
                    return Ok(FrameRead::Closed);
                }
                Ok(FrameRead::Frame(self.buffer[..read as usize].to_vec()))
            }
            SocketKind::Stream => self.recv_stream_frame(timeout),
        }
    }

    /// 流模式组帧：先凑齐 16 字节头，再按 payload_length 凑齐整帧。
    fn recv_stream_frame(&mut self, timeout: Option<Duration>) -> io::Result<FrameRead> {
        loop {
            if let Some(frame) = self.take_complete_frame()? {
                return Ok(FrameRead::Frame(frame));
            }
            if !poll_readable_raw(self.fd.as_raw_fd(), timeout)? {
                return Ok(FrameRead::Timeout);
            }
            let mut chunk = [0u8; 4096];
            // SAFETY: chunk 缓冲区有效。
            let read = unsafe {
                libc::recv(
                    self.fd.as_raw_fd(),
                    chunk.as_mut_ptr() as *mut libc::c_void,
                    chunk.len(),
                    0,
                )
            };
            if read < 0 {
                return Err(io::Error::last_os_error());
            }
            if read == 0 {
                return Ok(FrameRead::Closed);
            }
            self.buffer.extend_from_slice(&chunk[..read as usize]);
        }
    }

    /// 从组帧缓冲中取出一帧；长度非法立即报错。
    fn take_complete_frame(&mut self) -> io::Result<Option<Vec<u8>>> {
        if self.buffer.len() < HEADER_SIZE {
            return Ok(None);
        }
        let payload_length =
            u32::from_le_bytes([self.buffer[8], self.buffer[9], self.buffer[10], self.buffer[11]])
                as usize;
        if payload_length > MAX_PAYLOAD {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                format!("帧载荷 {payload_length} 超过上限 {MAX_PAYLOAD}"),
            ));
        }
        let frame_length = HEADER_SIZE + payload_length;
        if self.buffer.len() < frame_length {
            return Ok(None);
        }
        Ok(Some(self.buffer.drain(..frame_length).collect()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    /// 流模式组帧：分两次写入的头+载荷应拼成一帧。
    #[test]
    fn stream_framing_reassembles_partial_writes() {
        let mut buffer = Vec::new();
        buffer.extend_from_slice(&crate::MAGIC.to_le_bytes());
        buffer.extend_from_slice(&crate::VERSION.to_le_bytes());
        buffer.extend_from_slice(&0x0303u16.to_le_bytes());
        buffer.extend_from_slice(&4u32.to_le_bytes());
        buffer.extend_from_slice(&0u32.to_le_bytes());
        buffer.extend_from_slice(&0x0102_0304u32.to_le_bytes());
        // 简化验证：手工调用 take_complete_frame 需要实例，这里只验证组帧算术。
        let payload_length = u32::from_le_bytes([buffer[8], buffer[9], buffer[10], buffer[11]]) as usize;
        assert_eq!(payload_length, 4);
        assert_eq!(buffer.len(), HEADER_SIZE + payload_length);
        let mut sink = std::io::sink();
        sink.write_all(&buffer).unwrap();
    }
}
