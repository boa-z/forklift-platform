//! MCU（模组）串口后端：trait、mock 与 Linux tty 实现。
//!
//! 协议编解码在 `protocol::mcu`；这里只负责字节流的打开/读写与帧队列。
//! tty 是非阻塞 raw 8N1，读写都在服务循环的每个 tick 内完成。

use std::collections::VecDeque;
use std::fs::File;
use std::os::fd::{AsFd, AsRawFd};
use std::os::unix::fs::OpenOptionsExt;
use std::path::Path;

use protocol::mcu::{Frame, FrameDecoder, McuError};

/// 轮询一次得到的结果：完整帧队列。
pub trait McuBackend: Send {
    /// 把已经收到的完整帧追加到 `out`；无数据时保持为空。
    fn poll(&mut self, out: &mut Vec<Frame>) -> Result<(), McuError>;
    /// 发送一帧；驱动暂满时返回错误，由调用方下个周期重试。
    fn send(&mut self, frame: &Frame) -> Result<(), McuError>;
    /// 链路是否在线（串口打开成功即视为在线）。
    fn online(&self) -> bool {
        true
    }
}

/// mock 后端：测试与模拟器用；可注入接收帧并记录发送帧。
#[derive(Default)]
pub struct MockMcuBackend {
    incoming: VecDeque<Frame>,
    sent: Vec<Frame>,
    online: bool,
}

impl MockMcuBackend {
    /// 新建 mock：默认在线。
    pub fn new() -> Self {
        Self {
            incoming: VecDeque::new(),
            sent: Vec::new(),
            online: true,
        }
    }

    /// 注入一帧模拟的模组上报。
    pub fn push_incoming(&mut self, frame: Frame) {
        self.incoming.push_back(frame);
    }

    /// 取走并清空已发送的帧（测试断言用）。
    pub fn take_sent(&mut self) -> Vec<Frame> {
        std::mem::take(&mut self.sent)
    }

    /// 设置链路在线标志。
    pub fn set_online(&mut self, online: bool) {
        self.online = online;
    }
}

impl McuBackend for MockMcuBackend {
    /// 取出全部注入帧。
    fn poll(&mut self, out: &mut Vec<Frame>) -> Result<(), McuError> {
        out.extend(self.incoming.drain(..));
        Ok(())
    }

    /// 记录发送帧。
    fn send(&mut self, frame: &Frame) -> Result<(), McuError> {
        self.sent.push(frame.clone());
        Ok(())
    }

    /// 返回注入的在线标志。
    fn online(&self) -> bool {
        self.online
    }
}

/// Linux tty 后端：raw 8N1、无流控、非阻塞读写。
pub struct SerialMcuBackend {
    file: File,
    decoder: FrameDecoder,
    online: bool,
}

/// 波特率数值转 nix 常量；不支持的速率返回 `UnsupportedBaud`。
fn baud_rate(baud: u32) -> Result<nix::sys::termios::BaudRate, McuError> {
    use nix::sys::termios::BaudRate;
    match baud {
        9600 => Ok(BaudRate::B9600),
        19200 => Ok(BaudRate::B19200),
        38400 => Ok(BaudRate::B38400),
        57600 => Ok(BaudRate::B57600),
        115200 => Ok(BaudRate::B115200),
        230400 => Ok(BaudRate::B230400),
        other => Err(McuError::UnsupportedBaud { baud: other }),
    }
}

impl SerialMcuBackend {
    /// 打开并配置串口：raw 8N1、无流控、非阻塞。
    pub fn open(path: &Path, baud: u32) -> Result<Self, McuError> {
        use nix::sys::termios::{self, ControlFlags, SetArg};

        let speed = baud_rate(baud)?;
        let file = std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .custom_flags(nix::libc::O_NOCTTY | nix::libc::O_NONBLOCK)
            .open(path)
            .map_err(|error| McuError::Io {
                message: format!("open {}: {error}", path.display()),
            })?;
        let mut tty = termios::tcgetattr(file.as_fd()).map_err(|error| McuError::Io {
            message: format!("tcgetattr: {error}"),
        })?;
        termios::cfmakeraw(&mut tty);
        tty.control_flags |= ControlFlags::CLOCAL | ControlFlags::CREAD | ControlFlags::CS8;
        tty.control_flags &= !(ControlFlags::PARENB | ControlFlags::CSTOPB | ControlFlags::CRTSCTS);
        termios::cfsetispeed(&mut tty, speed).map_err(|error| McuError::Io {
            message: format!("cfsetispeed: {error}"),
        })?;
        termios::cfsetospeed(&mut tty, speed).map_err(|error| McuError::Io {
            message: format!("cfsetospeed: {error}"),
        })?;
        termios::tcsetattr(file.as_fd(), SetArg::TCSANOW, &tty).map_err(|error| McuError::Io {
            message: format!("tcsetattr: {error}"),
        })?;
        termios::tcflush(file.as_fd(), termios::FlushArg::TCIOFLUSH).map_err(|error| {
            McuError::Io {
                message: format!("tcflush: {error}"),
            }
        })?;
        Ok(Self {
            file,
            decoder: FrameDecoder::default(),
            online: true,
        })
    }
}

impl McuBackend for SerialMcuBackend {
    /// 非阻塞读取 tty；EAGAIN 视为无数据。
    fn poll(&mut self, out: &mut Vec<Frame>) -> Result<(), McuError> {
        use nix::errno::Errno;
        let raw = self.file.as_raw_fd();
        let mut buffer = [0u8; 256];
        loop {
            match nix::unistd::read(raw, &mut buffer) {
                Ok(0) => break,
                Ok(count) => out.extend(self.decoder.push(&buffer[..count])),
                Err(error) if error == Errno::EAGAIN || error == Errno::EWOULDBLOCK => break,
                Err(Errno::EINTR) => continue,
                Err(error) => {
                    self.online = false;
                    return Err(McuError::Io {
                        message: format!("read: {error}"),
                    });
                }
            }
        }
        self.online = true;
        Ok(())
    }

    /// 非阻塞写一帧；驱动暂满时返回错误由调用方重试。
    fn send(&mut self, frame: &Frame) -> Result<(), McuError> {
        use nix::errno::Errno;
        let bytes = frame.encode();
        let mut written = 0usize;
        while written < bytes.len() {
            match nix::unistd::write(&self.file, &bytes[written..]) {
                Ok(0) => break,
                Ok(count) => written += count,
                Err(Errno::EINTR) => continue,
                Err(error) if error == Errno::EAGAIN || error == Errno::EWOULDBLOCK => {
                    return Err(McuError::Io {
                        message: "tx buffer full".to_string(),
                    });
                }
                Err(error) => {
                    self.online = false;
                    return Err(McuError::Io {
                        message: format!("write: {error}"),
                    });
                }
            }
        }
        Ok(())
    }

    /// 串口打开成功即在线（读写错误会置为离线）。
    fn online(&self) -> bool {
        self.online
    }
}
