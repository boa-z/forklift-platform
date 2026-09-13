//! 服务循环：把后端采样收敛为 `VehicleState`，执行故障与相机策略，处理命令，
//! 并按节流频率通过 IPC 发布状态与事件。`forkliftd` 与 `forklift-sim` 共用。

use std::path::PathBuf;
use std::sync::mpsc::Receiver;
use std::thread;
use std::time::Duration;

use protocol::{
    mcu, AntiDismantleEvent, AuthStateEvent, ConnectivityEvent, Direction, HealthState, Message,
    RtcEvent, SignalQuality, SystemState, VehicleState,
};

use crate::auth::{AuthManager, SwipeOutcome};
use crate::backends::{
    AdcBackend, AdcChannel, AudioBackend, CameraBackend, CameraHealth, CanBackend, McuBackend,
    WatchdogBackend,
};
use crate::settings::{SettingsStore, SETTING_ANTI_DISMANTLE};
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
    pub mcu: Box<dyn McuBackend>,
    pub watchdog: Box<dyn WatchdogBackend>,
}

/// 服务循环参数（由 `Config` 派生，simulator 也可直接构造）。
#[derive(Debug, Clone)]
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
    /// 是否启用 MCU 串口链路。
    pub mcu_enable: bool,
    /// 管理员密码等授权状态的持久化路径。
    pub auth_path: PathBuf,
    /// UI 设置位域的持久化路径。
    pub settings_path: PathBuf,
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
            mcu_enable: config.mcu_enable,
            auth_path: config.auth_path.clone(),
            settings_path: config.settings_path.clone(),
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
    auth: AuthManager,
    settings: SettingsStore,
    settings_applied: bool,
    last_rtc_query_ms: u64,
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
        let auth = AuthManager::load(&config.auth_path);
        let mut service = Self {
            config: config.clone(),
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
            auth,
            settings: SettingsStore::load(&config.settings_path),
            settings_applied: false,
            last_rtc_query_ms: 0,
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
        self.sample_mcu(now);
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

    /// 轮询 MCU 帧并分发；启用时每 1s 查询一次 RTC。
    fn sample_mcu(&mut self, now: u64) {
        if !self.config.mcu_enable {
            return;
        }
        let mut frames = Vec::new();
        match self.backends.mcu.poll(&mut frames) {
            Ok(()) => {}
            Err(error) => log::debug!(target: "mcu", "MCU 采样不可用：{error}"),
        }
        for frame in &frames {
            self.handle_mcu_frame(frame);
        }
        if !self.settings_applied {
            self.settings_applied = true;
            if self.settings.flags() & SETTING_ANTI_DISMANTLE != 0 {
                self.auth.set_anti_dismantle(true);
                self.send_mcu(mcu::CMD_SET, mcu::index::ANTI_DISMANTLE, vec![1]);
            }
        }
        if now.saturating_sub(self.last_rtc_query_ms) >= 1_000 {
            self.last_rtc_query_ms = now;
            self.send_mcu(mcu::CMD_QUERY, mcu::index::RTC, vec![0; 6]);
        }
    }

    /// 向模组发送一帧；失败只记录，不影响服务循环。
    fn send_mcu(&mut self, cmd: u8, index: mcu::Index, data: Vec<u8>) {
        if !self.config.mcu_enable {
            return;
        }
        match mcu::Frame::new(cmd, index, data) {
            Ok(frame) => {
                if let Err(error) = self.backends.mcu.send(&frame) {
                    log::warn!(target: "mcu", "MCU 发送失败：{error}");
                }
            }
            Err(error) => log::warn!(target: "mcu", "MCU 帧构造失败：{error}"),
        }
    }

    /// 分发一条模组上报帧（刷卡/防拆/RTC/功能配置/沉默期）。
    fn handle_mcu_frame(&mut self, frame: &mcu::Frame) {
        match (frame.cmd, frame.index) {
            (mcu::CMD_SET, mcu::index::SWIPE_REPORT) => self.on_swipe_frame(&frame.data),
            (mcu::CMD_SET, mcu::index::ANTI_DISMANTLE_REPORT) => {
                let alarm = frame.data.first().copied().unwrap_or(0) != 0;
                self.auth.set_anti_dismantle_alarm(alarm);
                let (enabled, alarm) = self.auth.anti_dismantle();
                self.server
                    .publish(&Message::AntiDismantle(AntiDismantleEvent { enabled, alarm }));
            }
            (mcu::CMD_QUERY_RESP, mcu::index::RTC) | (mcu::CMD_SET_RESP, mcu::index::RTC) => {
                if let Ok(rtc) = mcu::RtcTime::decode(&frame.data) {
                    let event = RtcEvent {
                        year: rtc.year,
                        month: rtc.month,
                        day: rtc.day,
                        hour: rtc.hour,
                        minute: rtc.minute,
                        second: rtc.second,
                    };
                    self.server.publish(&Message::Rtc(event));
                }
            }
            (mcu::CMD_QUERY_RESP, mcu::index::MODULE_CONFIG)
            | (mcu::CMD_SET_RESP, mcu::index::MODULE_CONFIG) => {
                if let Ok(config) = mcu::ModuleConfig::decode(&frame.data) {
                    self.auth.dual_auth = config.dual_auth;
                }
            }
            (mcu::CMD_QUERY_RESP, mcu::index::SILENT_TIME)
            | (mcu::CMD_SET_RESP, mcu::index::SILENT_TIME) => {
                if let Ok(silent) = mcu::SilentTime::decode(&frame.data) {
                    self.auth.set_silent(silent);
                }
            }
            _ => {}
        }
    }

    /// 刷卡上报：更新授权状态、回复模组，授权通过后上报开机方式。
    fn on_swipe_frame(&mut self, data: &[u8]) {
        let Ok(report) = mcu::SwipeReport::decode(data) else {
            return;
        };
        let outcome = self.auth.on_swipe(&report);
        self.server.publish(&Message::SwipeReport(report.clone()));
        let reply_status: u8 = match outcome {
            SwipeOutcome::Authorized | SwipeOutcome::NeedsLicenseTail => 0,
            SwipeOutcome::Reported(_) => 1,
        };
        self.send_mcu(mcu::CMD_SET, mcu::index::SWIPE_REPLY, vec![reply_status]);
        self.publish_auth();
        if matches!(outcome, SwipeOutcome::Authorized) {
            let kind = if report.is_bluetooth() {
                mcu::PowerOnType::Bluetooth
            } else {
                mcu::PowerOnType::Card
            };
            self.send_mcu(
                mcu::CMD_SET,
                mcu::index::POWER_ON_REPORT,
                mcu::power_on_report(kind, report.card),
            );
        }
    }

    /// 广播授权状态（权限级别/是否已授权）。
    fn publish_auth(&mut self) {
        self.server.publish(&Message::AuthState(AuthStateEvent {
            level: self.auth.level(),
            authorized: self.auth.authorized(),
        }));
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
                Message::VerifyPassword { password } => {
                    let level = self.auth.verify(&password);
                    self.server.publish(&Message::AuthLevel(level));
                    self.publish_auth();
                }
                Message::SetAdminPassword {
                    old_password,
                    new_password,
                } => match self.auth.set_admin_password(&old_password, &new_password) {
                    Ok(()) => self.server.publish(&Message::Ok),
                    Err(error) => {
                        log::warn!(target: "auth", "修改管理员密码失败：{error}");
                        self.server.publish(&Message::Error {
                            code: 2001,
                            message: error.to_string(),
                        });
                    }
                },
                Message::EnterLicenseTail { digits } => match self.auth.enter_license_tail(&digits) {
                    Ok(true) => {
                        self.publish_auth();
                        self.send_mcu(mcu::CMD_SET, mcu::index::SWIPE_REPLY, vec![0]);
                    }
                    Ok(false) => self.server.publish(&Message::Error {
                        code: 2002,
                        message: "身份证尾号不正确".to_string(),
                    }),
                    Err(error) => self.server.publish(&Message::Error {
                        code: 2003,
                        message: error.to_string(),
                    }),
                },
                Message::ReportPowerOn { kind, card } => {
                    let power_on = match kind {
                        0 => Some(mcu::PowerOnType::Password),
                        1 => Some(mcu::PowerOnType::Card),
                        4 => Some(mcu::PowerOnType::Bluetooth),
                        _ => None,
                    };
                    if let Some(power_on) = power_on {
                        self.send_mcu(
                            mcu::CMD_SET,
                            mcu::index::POWER_ON_REPORT,
                            mcu::power_on_report(power_on, card),
                        );
                    }
                }
                Message::SwipeReply { status } => {
                    self.send_mcu(mcu::CMD_SET, mcu::index::SWIPE_REPLY, vec![status]);
                }
                Message::SetAntiDismantle { enabled } => {
                    self.auth.set_anti_dismantle(enabled);
                    self.send_mcu(
                        mcu::CMD_SET,
                        mcu::index::ANTI_DISMANTLE,
                        vec![u8::from(enabled)],
                    );
                    let mut flags = self.settings.flags();
                    if enabled {
                        flags |= SETTING_ANTI_DISMANTLE;
                    } else {
                        flags &= !SETTING_ANTI_DISMANTLE;
                    }
                    if let Err(error) = self.settings.set_flags(flags) {
                        log::warn!(target: "settings", "写入防拆设置失败：{error}");
                    }
                    let (enabled, alarm) = self.auth.anti_dismantle();
                    self.server
                        .publish(&Message::AntiDismantle(AntiDismantleEvent { enabled, alarm }));
                }
                Message::GetSettings => {
                    self.server.publish(&Message::Settings {
                        flags: self.settings.flags(),
                    });
                }
                Message::SetSettings { flags } => match self.settings.set_flags(flags) {
                    Ok(()) => {
                        self.server.publish(&Message::Settings { flags });
                        self.server.publish(&Message::Ok);
                    }
                    Err(error) => {
                        log::warn!(target: "settings", "写入设置失败：{error}");
                        self.server.publish(&Message::Error {
                            code: 2004,
                            message: error.to_string(),
                        });
                    }
                },
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
