//! `forkliftd` 入口：解析参数、加载配置、选择后端、绑定 IPC、进入服务循环。

use std::path::PathBuf;
use std::process::ExitCode;

use clap::Parser;
use env_logger::Env;
use forkliftd::backends::{
    AicCameraBackend, AlsaAudioBackend, IioAdcBackend, LinuxWatchdog, MockAdcBackend,
    MockAudioBackend, MockCameraBackend, MockCanBackend, MockWatchdog, SocketCanBackend,
};
use forkliftd::config::Config;
use forkliftd::ipc::Server;
use forkliftd::service::{Backends, Service, ServiceConfig};

/// 命令行参数。
#[derive(Debug, Parser)]
#[command(name = "forkliftd", about = "叉车仪表平台守护进程")]
struct Args {
    /// 覆盖配置中的 IPC socket 路径。
    #[arg(long, value_name = "PATH")]
    socket: Option<PathBuf>,
    /// 配置文件路径（缺省 /etc/forklift/forklift.toml，不存在则用默认值）。
    #[arg(long, value_name = "FILE")]
    config: Option<PathBuf>,
    /// 使用真实硬件后端（默认使用 mock）。
    #[arg(long)]
    real_hardware: bool,
}

/// 按配置选择后端：mock 全量替换，真实硬件返回 Unsupported 由健康模型暴露。
fn build_backends(config: &Config) -> Backends {
    if config.use_mock_hardware {
        Backends {
            can: Box::new(MockCanBackend::new()),
            adc: Box::new(MockAdcBackend::new()),
            camera: Box::new(MockCameraBackend::new()),
            audio: Box::new(MockAudioBackend::new(config.volume)),
            watchdog: Box::new(MockWatchdog::new()),
        }
    } else {
        Backends {
            can: Box::new(SocketCanBackend::new(config.can_interface.clone())),
            adc: Box::new(IioAdcBackend),
            camera: Box::new(AicCameraBackend),
            audio: Box::new(AlsaAudioBackend),
            watchdog: Box::new(LinuxWatchdog),
        }
    }
}

/// 进程入口。
fn main() -> ExitCode {
    let args = Args::parse();
    let mut config = match Config::load(args.config.as_deref()) {
        Ok(config) => config,
        Err(error) => {
            eprintln!("forkliftd: 配置加载失败：{error}");
            return ExitCode::FAILURE;
        }
    };
    if let Some(socket) = args.socket {
        config.socket_path = socket;
    }
    if args.real_hardware {
        config.use_mock_hardware = false;
    }

    env_logger::Builder::from_env(Env::default().default_filter_or(config.log_level.clone())).init();
    log::info!(
        target: "system",
        "forkliftd 启动：socket={} 后端={}",
        config.socket_path.display(),
        if config.use_mock_hardware { "mock" } else { "hardware" }
    );

    let backends = build_backends(&config);
    let (server, commands) = match Server::bind(&config.socket_path) {
        Ok(bound) => bound,
        Err(error) => {
            log::error!(target: "ipc", "IPC 绑定失败：{error}");
            return ExitCode::FAILURE;
        }
    };

    Service::new(ServiceConfig::from(&config), server, commands, backends).run()
}
