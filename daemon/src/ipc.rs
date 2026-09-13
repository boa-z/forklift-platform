//! 版本化 IPC 服务端。
//!
//! 一条连接一个线程：线程内完成握手、读取客户端命令、并写出 `publish()`
//! 推送的帧。底层传输由 `protocol::socket::Connection` 屏蔽平台差异。

use std::io;
use std::os::fd::OwnedFd;
use std::path::Path;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::mpsc::{self, Receiver, Sender, TryRecvError};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use protocol::socket::{Connection, FrameRead};
use protocol::{decode, encode, Message, VERSION};

/// 单条客户端命令，由服务循环消费并产生副作用。
#[derive(Debug, Clone, PartialEq)]
pub struct ClientCommand {
    /// 连接编号，仅用于日志与诊断。
    pub client_id: u64,
    /// 已通过帧校验的客户端消息。
    pub message: Message,
}

/// 单个客户端的发送句柄。
struct ClientHandle {
    /// 连接编号。
    id: u64,
    /// 待发送帧通道；接收端断开后由 `publish` 清理。
    tx: Sender<Vec<u8>>,
}

/// IPC 服务端；`publish` 可被任意线程调用。
pub struct Server {
    /// 当前连接表。
    clients: Arc<Mutex<Vec<ClientHandle>>>,
    /// 服务端消息序号（递增，用于对账）。
    sequence: AtomicU32,
}

/// 最多同时服务的客户端数量（UI + 诊断工具足够）。
const MAX_CLIENTS: usize = 8;

/// 错误码：协议/校验失败。
const ERROR_CODE_PROTOCOL: u16 = 1001;
/// 错误码：握手顺序或版本不满足。
const ERROR_CODE_HANDSHAKE: u16 = 1002;

impl Server {
    /// 绑定 socket 并启动接受线程，返回服务端与命令接收端。
    pub fn bind(path: &Path) -> io::Result<(Self, Receiver<ClientCommand>)> {
        if let Some(parent) = path.parent() {
            if !parent.as_os_str().is_empty() {
                std::fs::create_dir_all(parent)?;
            }
        }
        // 清理上次异常退出留下的 socket 文件。
        if path.exists() {
            std::fs::remove_file(path)?;
        }
        let listener = Connection::listen(path)?;
        let clients = Arc::new(Mutex::new(Vec::new()));
        let (command_tx, command_rx) = mpsc::channel();
        let accept_clients = Arc::clone(&clients);
        thread::Builder::new()
            .name("ipc-accept".to_string())
            .spawn(move || accept_loop(listener, accept_clients, command_tx))?;
        Ok((
            Self {
                clients,
                sequence: AtomicU32::new(1),
            },
            command_rx,
        ))
    }

    /// 向所有连接广播一条消息；断开连接的句柄会被移除。
    pub fn publish(&self, message: &Message) {
        let sequence = self.sequence.fetch_add(1, Ordering::Relaxed);
        let frame = encode(sequence, message);
        let mut clients = self.clients.lock().expect("连接表互斥锁中毒");
        clients.retain(|client| client.tx.send(frame.clone()).is_ok());
    }

    /// 当前连接数（诊断用）。
    pub fn client_count(&self) -> usize {
        self.clients.lock().map(|list| list.len()).unwrap_or(0)
    }
}

/// 接受循环：为每个新连接创建发送通道并派生服务线程。
fn accept_loop(
    listener: OwnedFd,
    clients: Arc<Mutex<Vec<ClientHandle>>>,
    command_tx: Sender<ClientCommand>,
) {
    let mut next_id: u64 = 1;
    loop {
        let mut connection = match Connection::accept(&listener) {
            Ok(connection) => connection,
            Err(error) => {
                log::warn!(target: "ipc", "accept 失败：{error}");
                thread::sleep(Duration::from_millis(100));
                continue;
            }
        };
        {
            let list = clients.lock().expect("连接表互斥锁中毒");
            if list.len() >= MAX_CLIENTS {
                log::warn!(target: "ipc", "连接数已达上限 {MAX_CLIENTS}，拒绝新连接");
                let frame = encode(
                    0,
                    &Message::Error {
                        code: ERROR_CODE_HANDSHAKE,
                        message: "too many clients".to_string(),
                    },
                );
                let _ = connection.send(&frame);
                drop(list);
                continue;
            }
            let (tx, rx) = mpsc::channel();
            let id = next_id;
            next_id = next_id.wrapping_add(1);
            drop(list);
            let thread_clients = Arc::clone(&clients);
            let thread_commands = command_tx.clone();
            // 注意：此时尚未注册进广播表，握手成功后才由连接线程注册，
            // 保证客户端先收到 SERVER_VERSION 再收到状态帧。
            let spawned = thread::Builder::new()
                .name(format!("ipc-client-{id}"))
                .spawn(move || {
                    serve_client(id, connection, rx, tx, thread_commands, thread_clients)
                });
            if let Err(error) = spawned {
                log::error!(target: "ipc", "创建连接线程失败：{error}");
            }
        }
    }
}

/// 单连接服务循环：先握手，再注册进广播表并处理命令。
fn serve_client(
    id: u64,
    mut connection: Connection,
    rx: Receiver<Vec<u8>>,
    outbound: Sender<Vec<u8>>,
    command_tx: Sender<ClientCommand>,
    clients: Arc<Mutex<Vec<ClientHandle>>>,
) {
    log::info!(target: "ipc", "客户端 #{id} 已连接");
    let mut handshaked = false;
    'serve: loop {
        // 先耗尽待发送队列。
        loop {
            match rx.try_recv() {
                Ok(frame) => {
                    if connection.send(&frame).is_err() {
                        break 'serve;
                    }
                }
                Err(TryRecvError::Empty) => break,
                Err(TryRecvError::Disconnected) => break 'serve,
            }
        }

        // 再读取并处理一个客户端帧（50ms 超时以便回到发送队列）。
        let frame = match connection.recv_frame(Some(Duration::from_millis(50))) {
            Ok(FrameRead::Frame(frame)) => frame,
            Ok(FrameRead::Timeout) => continue,
            Ok(FrameRead::Closed) | Err(_) => break,
        };
        let message = match decode(&frame) {
            Ok((_, message)) => message,
            Err(error) => {
                log::warn!(target: "ipc", "客户端 #{id} 帧非法：{error}");
                send_error(&mut connection, ERROR_CODE_PROTOCOL, &error.to_string());
                break;
            }
        };

        if !handshaked {
            match message {
                Message::Hello { client_version } => {
                    if client_version != VERSION {
                        log::warn!(
                            target: "ipc",
                            "客户端 #{id} 协议版本 {client_version} 与本地 {VERSION} 不匹配"
                        );
                        send_error(&mut connection, ERROR_CODE_HANDSHAKE, "protocol version mismatch");
                        break;
                    }
                    send_message(&mut connection, &Message::ServerVersion(VERSION));
                    handshaked = true;
                    // 握手成功后加入广播表；此前不会收到任何状态帧。
                    clients
                        .lock()
                        .expect("连接表互斥锁中毒")
                        .push(ClientHandle {
                            id,
                            tx: outbound.clone(),
                        });
                }
                other => {
                    log::warn!(target: "ipc", "客户端 #{id} 未握手就发送 {other:?}");
                    send_error(&mut connection, ERROR_CODE_HANDSHAKE, "expected HELLO");
                    break;
                }
            }
            continue;
        }

        match message {
            Message::Ping(nonce) => {
                send_message(&mut connection, &Message::Pong(nonce));
            }
            // 授权/设置类命令由服务循环处理并自行应答（AuthLevel/Settings/Ok/Error）。
            Message::VerifyPassword { .. }
            | Message::SetAdminPassword { .. }
            | Message::EnterLicenseTail { .. }
            | Message::GetSettings
            | Message::SetSettings { .. } => {
                if command_tx
                    .send(ClientCommand {
                        client_id: id,
                        message: message.clone(),
                    })
                    .is_err()
                {
                    log::error!(target: "ipc", "服务循环已退出，命令通道关闭");
                    break;
                }
            }
            Message::PlaySound(_)
            | Message::SetVolume(_)
            | Message::SetBrightness(_)
            | Message::ReportPowerOn { .. }
            | Message::SwipeReply { .. }
            | Message::SetAntiDismantle { .. } => {
                if command_tx
                    .send(ClientCommand {
                        client_id: id,
                        message: message.clone(),
                    })
                    .is_err()
                {
                    log::error!(target: "ipc", "服务循环已退出，命令通道关闭");
                    break;
                }
                send_message(&mut connection, &Message::Ok);
            }
            Message::Hello { .. } => {
                send_error(&mut connection, ERROR_CODE_HANDSHAKE, "duplicate HELLO");
            }
            other => {
                log::warn!(target: "ipc", "客户端 #{id} 发送了不支持的帧 {other:?}");
                send_error(&mut connection, ERROR_CODE_PROTOCOL, "unsupported message from client");
            }
        }
    }

    // 连接结束：从连接表移除自己，释放发送句柄。
    if let Ok(mut list) = clients.lock() {
        list.retain(|handle| handle.id != id);
    }
    log::info!(target: "ipc", "客户端 #{id} 已断开");
}

/// 发送一条协议帧，返回是否成功。
fn send_message(connection: &mut Connection, message: &Message) -> bool {
    let frame = encode(0, message);
    connection.send(&frame).is_ok()
}

/// 发送 RESP_ERROR。
fn send_error(connection: &mut Connection, code: u16, message: &str) {
    let _ = send_message(
        connection,
        &Message::Error {
            code,
            message: message.to_string(),
        },
    );
}
