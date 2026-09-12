//! `forklift-sim` 入口：命令行初始值 + 可选场景文件，驱动与 `forkliftd`
//! 完全相同的服务循环与 IPC 协议，供 macOS 上的 UI 联调。

mod sim;

use std::path::PathBuf;
use std::process::ExitCode;
use std::time::Duration;

use clap::Parser;
use env_logger::Env;
use forkliftd::backends::{MockAdcBackend, MockAudioBackend, MockCameraBackend, MockWatchdog};
use forkliftd::ipc::Server;
use forkliftd::service::{Backends, Service, ServiceConfig};
use protocol::Direction;
use sim::{Scenario, SimCanBackend, SimMcuBackend, SimVehicle};

/// 命令行参数。
#[derive(Debug, Parser)]
#[command(name = "forklift-sim", about = "叉车仪表场景模拟器")]
struct Args {
    /// IPC socket 路径。
    #[arg(long, value_name = "PATH", default_value = "/tmp/forklift.sock")]
    socket: PathBuf,
    /// 初始车速（km/h）。
    #[arg(long, default_value_t = 0.0)]
    speed: f32,
    /// 初始电量（%）。
    #[arg(long, default_value_t = 80.0)]
    soc: f32,
    /// 初始电机转速。
    #[arg(long, default_value_t = 0.0)]
    rpm: f32,
    /// 初始方向：forward / reverse / neutral。
    #[arg(long, default_value = "neutral")]
    direction: String,
    /// 场景文件（TOML `[[step]]` 数组）。
    #[arg(long, value_name = "FILE")]
    scenario: Option<PathBuf>,
    /// 服务循环周期（毫秒）。
    #[arg(long, default_value_t = 20)]
    tick_ms: u64,
    /// `STATE_VEHICLE` 发布频率。
    #[arg(long, default_value_t = 25)]
    publish_hz: u32,
}

/// 解析方向字符串。
fn parse_direction(value: &str) -> Result<Direction, String> {
    match value {
        "forward" => Ok(Direction::Forward),
        "reverse" => Ok(Direction::Reverse),
        "neutral" => Ok(Direction::Neutral),
        other => Err(format!("非法方向 {other}（应为 forward/reverse/neutral）")),
    }
}

/// 进程入口。
fn main() -> ExitCode {
    let args = Args::parse();
    env_logger::Builder::from_env(Env::default().default_filter_or("info")).init();

    let direction = match parse_direction(&args.direction) {
        Ok(direction) => direction,
        Err(message) => {
            eprintln!("forklift-sim: {message}");
            return ExitCode::FAILURE;
        }
    };
    let scenario = match &args.scenario {
        Some(path) => match Scenario::load(path) {
            Ok(scenario) => scenario,
            Err(error) => {
                eprintln!("forklift-sim: {error}");
                return ExitCode::FAILURE;
            }
        },
        None => Scenario::default(),
    };

    let initial = SimVehicle {
        speed_kph: args.speed,
        soc_percent: args.soc,
        rpm: args.rpm,
        direction,
        ..SimVehicle::default()
    };

    let backends = Backends {
        can: Box::new(SimCanBackend::new(initial, scenario.clone())),
        adc: Box::new(MockAdcBackend::new()),
        camera: Box::new(MockCameraBackend::new()),
        audio: Box::new(MockAudioBackend::new(70)),
        mcu: Box::new(SimMcuBackend::new(scenario)),
        watchdog: Box::new(MockWatchdog::new()),
    };
    let (server, commands) = match Server::bind(&args.socket) {
        Ok(bound) => bound,
        Err(error) => {
            eprintln!("forklift-sim: IPC 绑定失败：{error}");
            return ExitCode::FAILURE;
        }
    };
    let config = ServiceConfig {
        tick: Duration::from_millis(args.tick_ms.max(1)),
        signal_timeout_ms: 500,
        publish_period_ms: (1000 / args.publish_hz.max(1) as u64).max(1),
        camera_enable: true,
        brightness: 80,
        volume: 70,
        mcu_enable: true,
        auth_path: std::env::temp_dir().join("forklift-sim-auth.toml"),
    };
    log::info!(target: "sim", "模拟器启动：socket={}", args.socket.display());
    Service::new(config, server, commands, backends).run()
}
