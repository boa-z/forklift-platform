//! `forkliftctl`：daemon 联调 CLI（设备上无 UI 时验证 IPC/授权/模组链路）。
//!
//! 用法：
//!   forkliftctl [--socket PATH] ping
//!   forkliftctl [--socket PATH] settings
//!   forkliftctl [--socket PATH] set-settings <flags>
//!   forkliftctl [--socket PATH] password <密码>
//!   forkliftctl [--socket PATH] set-password <旧密码> <新密码>
//!   forkliftctl [--socket PATH] swipe <status>
//!   forkliftctl [--socket PATH] power-on <kind>
//!   forkliftctl [--socket PATH] watch [秒数] [--all]

use std::process::ExitCode;
use std::time::{Duration, Instant};

use protocol::{Client, Message};

/// 发送一条命令并等待满足条件的应答，打印结果。
fn request(
    client: &mut Client,
    message: Message,
    mut match_fn: impl FnMut(&Message) -> Option<String>,
) -> Result<(), String> {
    client.send(&message).map_err(|error| error.to_string())?;
    let deadline = Instant::now() + Duration::from_secs(3);
    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Err("等待应答超时".to_string());
        }
        let (_, incoming) = client
            .recv_timeout(remaining)
            .map_err(|error| error.to_string())?;
        if let Some(text) = match_fn(&incoming) {
            println!("{text}");
            return Ok(());
        }
    }
}

/// 打印设置位域与含义。
fn describe_flags(flags: u8) -> String {
    let names = [
        (1u8 << 0, "自检"),
        (1u8 << 1, "授权"),
        (1u8 << 2, "密码开机"),
        (1u8 << 3, "防拆"),
    ];
    let enabled: Vec<&str> = names
        .iter()
        .filter(|(bit, _)| flags & bit != 0)
        .map(|(_, name)| *name)
        .collect();
    format!("settings=0b{flags:08b} [{}]", enabled.join(","))
}

/// 解析并执行子命令。
fn main() -> ExitCode {
    let mut args: Vec<String> = std::env::args().skip(1).collect();
    let mut socket = "/run/forklift/forkliftd.sock".to_string();
    if args.first().map(String::as_str) == Some("--socket") {
        if args.len() < 2 {
            eprintln!("--socket 缺少路径");
            return ExitCode::FAILURE;
        }
        socket = args[1].clone();
        args.drain(0..2);
    }
    let Some(command) = args.first().cloned() else {
        eprintln!("用法：forkliftctl [--socket PATH] <ping|settings|set-settings <flags>|password <pwd>|set-password <old> <new>|swipe <status>|power-on <kind>|watch [secs]>");
        return ExitCode::FAILURE;
    };

    let mut client = match Client::connect(&socket) {
        Ok(client) => client,
        Err(error) => {
            eprintln!("连接 {socket} 失败：{error}");
            return ExitCode::FAILURE;
        }
    };
    if let Err(error) = client.handshake() {
        eprintln!("握手失败：{error}");
        return ExitCode::FAILURE;
    }

    let result: Result<(), String> = match command.as_str() {
        "ping" => request(&mut client, Message::Ping(0x1234), |message| match message {
            Message::Pong(nonce) if *nonce == 0x1234 => Some("pong 0x1234".to_string()),
            _ => None,
        }),
        "settings" => request(&mut client, Message::GetSettings, |message| match message {
            Message::Settings { flags } => Some(describe_flags(*flags)),
            _ => None,
        }),
        "set-settings" => {
            let flags = args
                .get(1)
                .and_then(|text| text.parse::<u8>().ok())
                .ok_or_else(|| "set-settings 需要 0-255 的位域".to_string());
            match flags {
                Ok(flags) => request(&mut client, Message::SetSettings { flags }, |message| match message {
                    Message::Settings { flags } => Some(describe_flags(*flags)),
                    _ => None,
                }),
                Err(error) => Err(error),
            }
        }
        "password" => {
            let password = args.get(1).cloned().unwrap_or_default();
            request(
                &mut client,
                Message::VerifyPassword { password },
                |message| match message {
                    Message::AuthLevel(level) => Some(format!("auth level={level}")),
                    _ => None,
                },
            )
        }
        "set-password" => {
            let old_password = args.get(1).cloned().unwrap_or_default();
            let new_password = args.get(2).cloned().unwrap_or_default();
            request(
                &mut client,
                Message::SetAdminPassword {
                    old_password,
                    new_password,
                },
                |message| match message {
                    Message::Ok => Some("ok".to_string()),
                    Message::Error { code, message } => Some(format!("error {code}: {message}")),
                    _ => None,
                },
            )
        }
        "swipe" => {
            let status = args
                .get(1)
                .and_then(|text| text.parse::<u8>().ok())
                .unwrap_or(0);
            match client.send(&Message::SwipeReply { status }) {
                Ok(_) => Ok(()),
                Err(error) => Err(error.to_string()),
            }
        }
        "power-on" => {
            let kind = args
                .get(1)
                .and_then(|text| text.parse::<u8>().ok())
                .unwrap_or(1);
            match client.send(&Message::ReportPowerOn {
                kind,
                card: [0; 4],
            }) {
                Ok(_) => Ok(()),
                Err(error) => Err(error.to_string()),
            }
        }
        "watch" => {
            let all = args.iter().any(|text| text == "--all");
            let seconds = args
                .iter()
                .skip(1)
                .find_map(|text| text.parse::<u64>().ok())
                .unwrap_or(5);
            if all {
                println!("watch {seconds}s（全部消息）");
            } else {
                println!("watch {seconds}s（仅事件：刷卡/授权/防拆/RTC/故障变化；--all 看全部）");
            }
            let mut state_frames = 0u64;
            let deadline = Instant::now() + Duration::from_secs(seconds);
            while Instant::now() < deadline {
                let remaining = deadline.saturating_duration_since(Instant::now());
                match client.recv_timeout(remaining.min(Duration::from_secs(1))) {
                    Ok((_, message)) => match message {
                        Message::VehicleState(_) | Message::Faults(_) if !all => {
                            state_frames += 1;
                        }
                        other => println!("{other:?}"),
                    },
                    Err(_) => continue,
                }
            }
            if !all {
                println!("（已过滤 {state_frames} 条状态/故障快照）");
            }
            Ok(())
        }
        other => Err(format!("未知命令：{other}")),
    };

    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("forkliftctl: {error}");
            ExitCode::FAILURE
        }
    }
}
