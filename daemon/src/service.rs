//! 服务循环：把后端采样收敛为 `VehicleState`，执行故障与相机策略，处理命令，
//! 并按节流频率通过 IPC 发布状态与事件。`forkliftd` 与 `forklift-sim` 共用。

use std::sync::mpsc::Receiver;
use std::thread;
use std::time::Duration;

use protocol::{
    ConnectivityEvent, Direction, HealthState, Message, SignalQuality, SystemState, VehicleState,
};

use crate::backends::{
    AdcBackend, AdcChannel, AudioBackend, CameraBackend, CameraHealth, CanBackend, WatchdogBackend,
};
use crate::config::Config;
use crate::diagnostics::{now_ms, sample_memory};
use crate::fault::{FaultChange, FaultManager};
use crate::ipc::{ClientCommand, Server};
use crate::vehicle::{VehicleModel, VehicleUpdate};

/// 后端集合；服务循环只通过这些 trait 访问硬件。
pub struct Backends {
    pub can: Box<dyn CanBackend>,
    pub adc: Box<dyn AdcBackend>,
    pub camera: Box<dyn CameraBackend>,
    pub audio: Box<dyn AudioBackend>,
    pub watchdog: Box<dyn WatchdogBackend>,
}

/// 服务循环参数（由 `Config` 派生，simulator 也可直接构造）。
#[derive(Debug, Clone, Copy)]
pub struct ServiceConfig {
    /// 主循环周期。
    pub tick: Duration,
    /// 信号超时阈值。
    pub signal_timeout_ms: u64,
    /// `STATE_VEHICLE` 发布周期。
    pub publish_period_ms: u64,
    /// 是否启用倒车相机策略。
    pub camera_enable: bool,
    /// 启动还原的亮度。
    pub brightness: u8,
    /// 启动还原的音量。
    pub volume: u8,
}

impl From<&Config> for ServiceConfig {
    /// 从运行配置派生服务参数。
    fn from(config: &Config) -> Self {
        Self {
            tick: config.tick_duration(),
            signal_timeout_ms: config.signal_timeout_ms,
            publish_period_ms: config.publish_period_ms(),
            camera_enable: config.camera_enable,
            brightness: config.brightness,
            volume: config.volume,
        }
    }
}

pub struct Service {
    config: ServiceConfig,
    model: VehicleModel,
    faults: FaultManager,
    backends: Backends,
    server: Server,
    commands: Receiver<ClientCommand>,
    last_publish_ms: u64,
    last_system_ms: u64,
    last_adc_ms: u64,
    last_feed_ms: u64,
    last_can_frame_ms: Option<u64>,
    can_supported: bool,
    adc_supported: bool,
    watchdog_supported: bool,
    camera_expected: bool,
    camera_visible: bool,
    last_camera_online: bool,
    brightness: u8,
    volume: u8,
    started_ms: u64,
}

impl Service {
    /// 组装服务；调用方负责绑定 IPC 与选择后端实现。
    pub fn new(
        config: ServiceConfig,
        server: Server,
        commands: Receiver<ClientCommand>,
        backends: Backends,
    ) -> Self {
        let now = now_ms();
        let mut service = Self {
            config,
            model: VehicleModel::new(now),
            faults: FaultManager::new(),
            backends,
            server,
            commands,
            last_publish_ms: 0,
            last_system_ms: 0,
            last_adc_ms: 0,
            last_feed_ms: 0,
            last_can_frame_ms: None,
            can_supported: false,
            adc_supported: false,
            watchdog_supported: false,
            camera_expected: false,
            camera_visible: false,
            last_camera_online: false,
            brightness: config.brightness,
            volume: config.volume,
            started_ms: now,
        };
        service.apply_initial_volume();
        service
    }

    /// 将配置中的音量下发到音频后端（失败只记录，不阻塞启动）。
    fn apply_initial_volume(&mut self) {
        if let Err(error) = self.backends.audio.set_volume(self.volume) {
            log::warn!(target: "audio", "启动音量设置失败：{error}");
        }
    }

    /// 永久运行主循环。
    pub fn run(mut self) -> ! {
        loop {
            self.tick();
            thread::sleep(self.config.tick);
        }
    }

    /// 单次迭代：采样、策略、命令、发布。
    pub fn tick(&mut self) {
        let now = now_ms();
        self.sample_can(now);
        self.sample_adc(now);
        self.model.evaluate_timeouts(now, self.config.signal_timeout_ms);
        self.apply_camera_policy(now);
        self.evaluate_faults(now);
        self.handle_commands();
        self.feed_watchdog(now);
        self.publish(now);
    }

    /// 读取 CAN 帧并合并进车辆状态；记录最近一帧时间用于在线判定。
    fn sample_can(&mut self, now: u64) {
        let mut frames = Vec::new();
        match self.backends.can.poll(&mut frames) {
            Ok(()) => {
                self.can_supported = true;
                if !frames.is_empty() {
                    self.last_can_frame_ms = Some(now);
                }
                let update = crate::backends::can::decode_frames(&frames);
                self.model.apply(&update, now);
            }
            Err(error) => {
                self.can_supported = false;
                log::debug!(target: "can", "CAN 采样不可用：{error}");
            }
        }
    }

    /// 每 500ms 读取一次 ADC，写入液压压力信号。
    fn sample_adc(&mut self, now: u64) {
        if now.saturating_sub(self.last_adc_ms) < 500 {
            return;
        }
        self.last_adc_ms = now;
        match self
            .backends
            .adc
            .read_channel(AdcChannel::HydraulicPressure)
        {
            Ok(value) => {
                self.adc_supported = true;
                let update = VehicleUpdate {
                    pressure_mpa: Some(value),
                    ..VehicleUpdate::default()
                };
                self.model.apply(&update, now);
            }
            Err(error) => {
                self.adc_supported = false;
                log::debug!(target: "adc", "ADC 采样不可用：{error}");
            }
        }
    }

    /// 倒车相机策略：前进/空挡隐藏视频层，倒车显示；变化时才调用后端。
    fn apply_camera_policy(&mut self, now: u64) {
        let reverse = {
            let direction = &self.model.state().motion.direction;
            direction.quality == SignalQuality::Valid && direction.value == Direction::Reverse
        };
        let expected = self.config.camera_enable && reverse;
        self.camera_expected = expected;
        if expected != self.camera_visible {
            match self.backends.camera.set_visible(expected) {
                Ok(()) => self.camera_visible = expected,
                Err(error) => log::warn!(target: "camera", "视频层切换失败：{error}"),
            }
        }
        let online = matches!(self.backends.camera.health(), CameraHealth::Healthy);
        self.model.set_camera_online(online);
        self.publish_camera_policy_event(now);
    }

    /// 相机离线/恢复时发布连接性事件（仅在变化时）。
    fn publish_camera_policy_event(&mut self, now: u64) {
        let camera_online = self.model.state().connectivity.camera_online;
        if camera_online != self.last_camera_online {
            self.last_camera_online = camera_online;
            self.server.publish(&Message::Connectivity(ConnectivityEvent {
                timestamp_ms: now,
                can_online: self.model.state().connectivity.can_online,
                camera_online,
            }));
        }
    }

    /// 更新 CAN 在线状态并执行故障规则。
    fn evaluate_faults(&mut self, now: u64) {
        let can_online = self
            .last_can_frame_ms
            .map(|stamp| now.saturating_sub(stamp) <= self.config.signal_timeout_ms)
            .unwrap_or(false);
        self.model.set_can_online(can_online);

        let mut changes = self.faults.evaluate(self.model.state(), now);
        let camera_expected = self.camera_expected;
        let camera_online = self.model.state().connectivity.camera_online;
        changes.extend(self.faults.evaluate_camera(camera_expected, camera_online, now));
        for change in changes {
            match change {
                FaultChange::Raised(fault) => {
                    log::warn!(target: "fault", "故障产生：id=0x{:04x} 严重度={:?}", fault.id, fault.severity);
                    self.server.publish(&Message::FaultRaised(fault));
                }
                FaultChange::Cleared(fault) => {
                    log::info!(target: "fault", "故障清除：id=0x{:04x}", fault.id);
                    self.server.publish(&Message::FaultCleared(fault));
                }
            }
        }
    }

    /// 处理 UI 命令；失败只记录，不让服务循环退出。
    fn handle_commands(&mut self) {
        while let Ok(command) = self.commands.try_recv() {
            match command.message {
                Message::PlaySound(sound) => {
                    if let Err(error) = self.backends.audio.play(sound) {
                        log::warn!(target: "audio", "播放失败：{error}");
                    }
                }
                Message::SetVolume(volume) => {
                    if let Err(error) = self.backends.audio.set_volume(volume) {
                        log::warn!(target: "audio", "音量设置失败：{error}");
                    } else {
                        self.volume = volume;
                    }
                }
                Message::SetBrightness(brightness) => {
                    // 背光后端在 M8 接入 PWM/sysfs；先记录目标值。
                    self.brightness = brightness;
                    log::info!(target: "system", "亮度请求：{brightness}");
                }
                other => {
                    log::warn!(target: "ipc", "客户端 #{} 的命令被忽略：{other:?}", command.client_id);
                }
            }
        }
    }

    /// 每秒喂一次看门狗；后端不支持时只记录一次。
    fn feed_watchdog(&mut self, now: u64) {
        if now.saturating_sub(self.last_feed_ms) < 1_000 {
            return;
        }
        self.last_feed_ms = now;
        if let Err(error) = self.backends.watchdog.feed() {
            if self.watchdog_supported {
                log::warn!(target: "watchdog", "喂狗失败：{error}");
            } else {
                log::debug!(target: "watchdog", "看门狗后端不可用：{error}");
            }
            self.watchdog_supported = false;
        } else {
            self.watchdog_supported = true;
        }
    }

    /// 按节流频率发布车辆状态、故障快照与系统状态。
    fn publish(&mut self, now: u64) {
        if now.saturating_sub(self.last_publish_ms) >= self.config.publish_period_ms {
            self.last_publish_ms = now;
            self.server
                .publish(&Message::VehicleState(Box::new(self.model.state().clone())));
            self.server.publish(&Message::Faults(self.faults.snapshot(now)));
        }
        if now.saturating_sub(self.last_system_ms) >= 1_000 {
            self.last_system_ms = now;
            let system = self.system_state(now);
            self.server.publish(&Message::System(system));
        }
    }

    /// 组装系统健康与内存遥测。
    fn system_state(&self, now: u64) -> SystemState {
        let can_online = self.model.state().connectivity.can_online;
        let memory = sample_memory();
        SystemState {
            timestamp_ms: now,
            uptime_ms: now.saturating_sub(self.started_ms),
            health: [
                if !self.can_supported {
                    HealthState::Unknown
                } else if can_online {
                    HealthState::Healthy
                } else {
                    HealthState::Degraded
                },
                if self.adc_supported {
                    HealthState::Healthy
                } else {
                    HealthState::Unknown
                },
                match self.backends.camera.health() {
                    CameraHealth::Healthy => HealthState::Healthy,
                    CameraHealth::Degraded => HealthState::Degraded,
                    CameraHealth::Failed => HealthState::Failed,
                    CameraHealth::Unknown => HealthState::Unknown,
                },
                HealthState::Healthy,
                if self.server.client_count() == 0 {
                    HealthState::Degraded
                } else {
                    HealthState::Healthy
                },
            ],
            rss_kb: memory.rss_kb,
            mem_available_kb: memory.mem_available_kb,
        }
    }

    /// 只读访问当前车辆状态（测试与诊断用）。
    pub fn state(&self) -> &VehicleState {
        self.model.state()
    }
}
