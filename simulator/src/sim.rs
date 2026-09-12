//! 场景模拟后端：按时间线修改一辆虚拟叉车的状态，并编码为与 daemon mock
//! 相同的临时 CAN 帧（0x301/0x302/0x303），从而完整经过解码与策略链路；
//! 同时提供 MCU 场景后端（刷卡/防拆注入 + RTC 回应）供授权链路联调。

use std::collections::VecDeque;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use forkliftd::backends::{CanBackend, CanFrame, CanError, McuBackend};
use forkliftd::diagnostics::now_ms;
use protocol::mcu::{self, Frame, McuError};
use protocol::{Direction, RunMode};
use serde::Deserialize;
use thiserror::Error;

/// 虚拟车辆状态（模拟器内部使用，编码后进入 CAN 帧）。
#[derive(Debug, Clone, Copy)]
pub struct SimVehicle {
    pub speed_kph: f32,
    pub soc_percent: f32,
    pub rpm: f32,
    pub motor_temp_c: f32,
    pub direction: Direction,
    pub can_online: bool,
    pub charging: bool,
    pub anti_dismantle: bool,
}

impl Default for SimVehicle {
    /// 默认一辆静止、电量 80% 的叉车。
    fn default() -> Self {
        Self {
            speed_kph: 0.0,
            soc_percent: 80.0,
            rpm: 0.0,
            motor_temp_c: 25.0,
            direction: Direction::Neutral,
            can_online: true,
            charging: false,
            anti_dismantle: false,
        }
    }
}

/// 场景中的一次刷卡注入。
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct McuSwipeStep {
    /// 模组上报状态：0 失败/1 授权成功/2 重复/3 其它卡/4 关机/5 沉默期。
    pub status: u8,
    /// 卡号（8 位十六进制，默认 11223344）。
    pub card: Option<String>,
    /// 18 位身份证号（双重认证测试用；默认全 0）。
    pub id: Option<String>,
    /// 姓名（ASCII，最多 8 字符）。
    pub name: Option<String>,
}

/// 场景中的一步：到 `at_ms` 时把给定字段写入虚拟车辆。
#[derive(Debug, Clone, Default, Deserialize)]
pub struct Step {
    /// 相对模拟开始的毫秒数。
    pub at_ms: u64,
    /// 目标车速。
    pub speed_kph: Option<f32>,
    /// 目标 SOC。
    pub soc_percent: Option<f32>,
    /// 目标电机转速。
    pub rpm: Option<f32>,
    /// 目标电机温度。
    pub motor_temp_c: Option<f32>,
    /// `forward` / `reverse` / `neutral`。
    pub direction: Option<String>,
    /// 充电条件注入。
    pub charging: Option<bool>,
    /// 防拆卸拆除标志注入（CAN 路径）。
    pub anti_dismantle: Option<bool>,
    /// `motor_overheat` / `battery_low` / `can_offline` 便捷故障注入。
    pub fault: Option<String>,
    /// 模组刷卡上报注入。
    pub mcu_swipe: Option<McuSwipeStep>,
    /// 模组防拆报警注入。
    pub mcu_anti_dismantle: Option<bool>,
}

/// 场景文件：TOML 中的 `[[step]]` 数组。
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Scenario {
    /// 启动时上报的模组功能配置：是否启用双重认证。
    pub dual_auth: Option<bool>,
    #[serde(rename = "step", default)]
    pub steps: Vec<Step>,
}

#[derive(Debug, Error)]
pub enum ScenarioError {
    #[error("读取场景文件 {path}：{source}")]
    Read { path: String, source: std::io::Error },
    #[error("解析场景文件 {path}：{source}")]
    Parse { path: String, source: toml::de::Error },
    #[error("非法方向值：{0}（应为 forward/reverse/neutral）")]
    Direction(String),
    #[error("非法故障名：{0}")]
    Fault(String),
}

impl Scenario {
    /// 从 TOML 文件加载并按时间排序；`at_ms` 相同的步骤保持文件顺序。
    pub fn load(path: &Path) -> Result<Self, ScenarioError> {
        let text = std::fs::read_to_string(path).map_err(|source| ScenarioError::Read {
            path: path.display().to_string(),
            source,
        })?;
        let mut scenario: Scenario =
            toml::from_str(&text).map_err(|source| ScenarioError::Parse {
                path: path.display().to_string(),
                source,
            })?;
        scenario.steps.sort_by_key(|step| step.at_ms);
        Ok(scenario)
    }

    /// 把到期的步骤应用到虚拟车辆；返回本次实际应用的步骤数。
    pub fn apply(&self, elapsed_ms: u64, vehicle: &mut SimVehicle) -> Result<usize, ScenarioError> {
        let mut applied = 0;
        for step in &self.steps {
            if step.at_ms > elapsed_ms {
                break;
            }
            if let Some(speed) = step.speed_kph {
                vehicle.speed_kph = speed;
            }
            if let Some(soc) = step.soc_percent {
                vehicle.soc_percent = soc;
            }
            if let Some(rpm) = step.rpm {
                vehicle.rpm = rpm;
            }
            if let Some(temp) = step.motor_temp_c {
                vehicle.motor_temp_c = temp;
            }
            if let Some(direction) = &step.direction {
                vehicle.direction = match direction.as_str() {
                    "forward" => Direction::Forward,
                    "reverse" => Direction::Reverse,
                    "neutral" => Direction::Neutral,
                    other => return Err(ScenarioError::Direction(other.to_string())),
                };
            }
            if let Some(charging) = step.charging {
                vehicle.charging = charging;
            }
            if let Some(removed) = step.anti_dismantle {
                vehicle.anti_dismantle = removed;
            }
            if let Some(fault) = &step.fault {
                match fault.as_str() {
                    "motor_overheat" => vehicle.motor_temp_c = 95.0,
                    "battery_low" => vehicle.soc_percent = 10.0,
                    "can_offline" => vehicle.can_online = false,
                    "recover" => {
                        vehicle.can_online = true;
                        vehicle.motor_temp_c = 45.0;
                        vehicle.soc_percent = 60.0;
                    }
                    other => return Err(ScenarioError::Fault(other.to_string())),
                }
            }
            applied += 1;
        }
        Ok(applied)
    }
}

/// 把虚拟车辆状态编码为三帧临时 CAN 报文。
pub fn encode_frames(vehicle: &SimVehicle, now_ms: u64) -> Vec<CanFrame> {
    let mut motor = [0u8; 8];
    motor[0..2].copy_from_slice(&(vehicle.rpm as u16).to_le_bytes());
    motor[2] = (vehicle.motor_temp_c + 40.0) as u8;

    let mut battery = [0u8; 8];
    battery[0] = vehicle.soc_percent as u8;
    let voltage = (48.0 * 10.0) as u16;
    battery[1..3].copy_from_slice(&voltage.to_le_bytes());
    battery[5] = u8::from(vehicle.charging);

    let mut motion = [0u8; 8];
    motion[0..2].copy_from_slice(&((vehicle.speed_kph * 10.0) as u16).to_le_bytes());
    motion[2] = vehicle.direction.as_u8();
    motion[3] = 0;
    motion[4] = RunMode::S.as_u8();
    motion[5] = 0;
    motion[6] = u8::from(vehicle.anti_dismantle);

    vec![
        CanFrame {
            id: forkliftd::backends::can::CAN_ID_MOTOR,
            data: motor,
            dlc: 3,
            timestamp_ms: now_ms,
        },
        CanFrame {
            id: forkliftd::backends::can::CAN_ID_BATTERY,
            data: battery,
            dlc: 6,
            timestamp_ms: now_ms,
        },
        CanFrame {
            id: forkliftd::backends::can::CAN_ID_MOTION,
            data: motion,
            dlc: 7,
            timestamp_ms: now_ms,
        },
    ]
}

/// 场景 CAN 后端：每 50ms 发一帧组，时间线由场景驱动。
pub struct SimCanBackend {
    scenario: Scenario,
    vehicle: SimVehicle,
    started_ms: Option<u64>,
    last_emit_ms: Option<u64>,
    last_error_logged: bool,
}

impl SimCanBackend {
    /// 用初始值与场景构造后端。
    pub fn new(initial: SimVehicle, scenario: Scenario) -> Self {
        Self {
            scenario,
            vehicle: initial,
            started_ms: None,
            last_emit_ms: None,
            last_error_logged: false,
        }
    }
}

impl CanBackend for SimCanBackend {
    /// 推进场景并按时发帧；场景错误只记录一次，不终止服务。
    fn poll(&mut self, out: &mut Vec<CanFrame>) -> Result<(), CanError> {
        let now = now_ms();
        let start = *self.started_ms.get_or_insert(now);
        let elapsed = now.saturating_sub(start);
        if let Err(error) = self.scenario.apply(elapsed, &mut self.vehicle) {
            if !self.last_error_logged {
                log::error!(target: "sim", "场景执行失败：{error}");
                self.last_error_logged = true;
            }
        }
        if !self.vehicle.can_online {
            return Ok(());
        }
        let due = match self.last_emit_ms {
            Some(last) => now.saturating_sub(last) >= 50,
            None => true,
        };
        if due {
            out.extend(encode_frames(&self.vehicle, now));
            self.last_emit_ms = Some(now);
        }
        Ok(())
    }
}

/// 场景 MCU 后端：启动上报功能配置，按时间线注入刷卡/防拆，回应 RTC 查询。
pub struct SimMcuBackend {
    scenario: Scenario,
    started_ms: Option<u64>,
    applied: usize,
    incoming: VecDeque<Frame>,
    sent: Vec<Frame>,
    config_sent: bool,
}

impl SimMcuBackend {
    /// 用场景构造后端。
    pub fn new(scenario: Scenario) -> Self {
        Self {
            scenario,
            started_ms: None,
            applied: 0,
            incoming: VecDeque::new(),
            sent: Vec::new(),
            config_sent: false,
        }
    }

    /// 取已发送帧快照（诊断与测试）。
    pub fn sent_frames(&self) -> Vec<Frame> {
        self.sent.clone()
    }

    /// 处理一条到期步骤的 MCU 部分。
    fn apply_step(&mut self, step: &Step) {
        if let Some(swipe) = &step.mcu_swipe {
            if let Ok(frame) = build_swipe_frame(swipe) {
                self.incoming.push_back(frame);
            }
        }
        if let Some(alarm) = step.mcu_anti_dismantle {
            if let Ok(frame) = Frame::new(
                mcu::CMD_SET,
                mcu::index::ANTI_DISMANTLE_REPORT,
                vec![u8::from(alarm)],
            ) {
                self.incoming.push_back(frame);
            }
        }
    }
}

impl McuBackend for SimMcuBackend {
    /// 推进场景并交出上行帧；启动时补发功能配置上报。
    fn poll(&mut self, out: &mut Vec<Frame>) -> Result<(), McuError> {
        let now = now_ms();
        let start = *self.started_ms.get_or_insert(now);
        let elapsed = now.saturating_sub(start);
        if !self.config_sent {
            self.config_sent = true;
            let config = mcu::ModuleConfig {
                auth_type: 0,
                dual_auth: self.scenario.dual_auth.unwrap_or(false),
                swipe_off: false,
                drive_license: false,
                ic_license: false,
            };
            if let Ok(frame) = Frame::new(
                mcu::CMD_SET,
                mcu::index::MODULE_CONFIG,
                config.encode().to_vec(),
            ) {
                self.incoming.push_back(frame);
            }
        }
        while self.applied < self.scenario.steps.len() {
            if self.scenario.steps[self.applied].at_ms > elapsed {
                break;
            }
            let step = self.scenario.steps[self.applied].clone();
            self.applied += 1;
            self.apply_step(&step);
        }
        out.extend(self.incoming.drain(..));
        Ok(())
    }

    /// 记录下行帧；对 RTC 查询回本地时间。
    fn send(&mut self, frame: &Frame) -> Result<(), McuError> {
        if frame.cmd == mcu::CMD_QUERY && frame.index == mcu::index::RTC {
            if let Some(rtc) = local_rtc() {
                if let Ok(reply) = Frame::new(
                    mcu::CMD_QUERY_RESP,
                    mcu::index::RTC,
                    rtc.encode().to_vec(),
                ) {
                    self.incoming.push_back(reply);
                }
            }
        }
        self.sent.push(frame.clone());
        Ok(())
    }
}

/// 构造刷卡上报帧：hex 卡号、ASCII 姓名、BCD 身份证号。
fn build_swipe_frame(step: &McuSwipeStep) -> Result<Frame, McuError> {
    let mut card = [0x11u8, 0x22, 0x33, 0x44];
    if let Some(text) = &step.card {
        decode_hex4(text, &mut card);
    }
    let mut name = [0u8; 8];
    if let Some(text) = &step.name {
        for (slot, byte) in name.iter_mut().zip(text.bytes()) {
            *slot = byte;
        }
    }
    let mut id = [0u8; 9];
    if let Some(text) = &step.id {
        encode_bcd_id(text, &mut id);
    }
    let report = mcu::SwipeReport {
        status: step.status,
        index: 0,
        name,
        card,
        id,
        phone: [0; 6],
        driver_license: [0; 3],
        ic_license: [0; 3],
    };
    Frame::new(mcu::CMD_SET, mcu::index::SWIPE_REPORT, report.encode())
}

/// 把 8 位十六进制卡号写入 4 字节；非法字符按 0 处理。
fn decode_hex4(text: &str, out: &mut [u8; 4]) {
    let bytes = text.as_bytes();
    for (index, slot) in out.iter_mut().enumerate() {
        let high = bytes
            .get(index * 2)
            .and_then(|byte| (*byte as char).to_digit(16))
            .unwrap_or(0);
        let low = bytes
            .get(index * 2 + 1)
            .and_then(|byte| (*byte as char).to_digit(16))
            .unwrap_or(0);
        *slot = ((high << 4) | low) as u8;
    }
}

/// 把身份证号写成 9 字节 BCD（不足 18 位补 0）。
fn encode_bcd_id(text: &str, out: &mut [u8; 9]) {
    let digits: Vec<u8> = text
        .bytes()
        .filter(|byte| byte.is_ascii_digit())
        .map(|byte| byte - b'0')
        .collect();
    for (index, slot) in out.iter_mut().enumerate() {
        let high = digits.get(index * 2).copied().unwrap_or(0);
        let low = digits.get(index * 2 + 1).copied().unwrap_or(0);
        *slot = (high << 4) | low;
    }
}

/// 取当前 UTC 日期时间，返回模组 RTC 字段（年取后两位）。
fn local_rtc() -> Option<mcu::RtcTime> {
    let seconds = SystemTime::now().duration_since(UNIX_EPOCH).ok()?.as_secs();
    let days = (seconds / 86_400) as i64;
    let (year, month, day) = civil_from_days(days);
    let secs_of_day = seconds % 86_400;
    Some(mcu::RtcTime {
        year: (year % 100) as u8,
        month: month as u8,
        day: day as u8,
        hour: (secs_of_day / 3_600) as u8,
        minute: ((secs_of_day % 3_600) / 60) as u8,
        second: (secs_of_day % 60) as u8,
    })
}

/// 由 Unix 天数换算公历年月日。
fn civil_from_days(days_since_epoch: i64) -> (i64, u32, u32) {
    let z = days_since_epoch + 719_468;
    let era = (if z >= 0 { z } else { z - 146_096 }) / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let year = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let month = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    if month <= 2 {
        (year + 1, month, day)
    } else {
        (year, month, day)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 验证场景按时间生效并覆盖字段。
    #[test]
    fn scenario_steps_apply_over_time() {
        let scenario = Scenario {
            steps: vec![
                Step {
                    at_ms: 100,
                    speed_kph: Some(5.0),
                    direction: Some("reverse".to_string()),
                    ..Step::default()
                },
                Step {
                    at_ms: 200,
                    soc_percent: Some(55.0),
                    ..Step::default()
                },
            ],
            ..Scenario::default()
        };
        let mut vehicle = SimVehicle::default();
        scenario.apply(150, &mut vehicle).unwrap();
        assert_eq!(vehicle.speed_kph, 5.0);
        assert_eq!(vehicle.direction, Direction::Reverse);
        assert_eq!(vehicle.soc_percent, 80.0);
        scenario.apply(250, &mut vehicle).unwrap();
        assert_eq!(vehicle.soc_percent, 55.0);
    }

    /// 验证故障便捷注入映射到对应字段。
    #[test]
    fn fault_steps_map_to_vehicle_fields() {
        let scenario = Scenario {
            steps: vec![Step {
                at_ms: 0,
                fault: Some("motor_overheat".to_string()),
                ..Step::default()
            }],
            ..Scenario::default()
        };
        let mut vehicle = SimVehicle::default();
        scenario.apply(0, &mut vehicle).unwrap();
        assert!(vehicle.motor_temp_c > 90.0);
    }

    /// 验证仓库内置场景文件可被解析。
    #[test]
    fn shipped_scenario_parses() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../scenario/reverse.toml");
        let scenario = Scenario::load(&path).expect("内置场景应可解析");
        assert!(scenario.steps.len() >= 5);
    }

    /// 验证非法方向被拒绝。
    #[test]
    fn invalid_direction_is_rejected() {
        let scenario = Scenario {
            steps: vec![Step {
                at_ms: 0,
                direction: Some("sideways".to_string()),
                ..Step::default()
            }],
            ..Scenario::default()
        };
        let mut vehicle = SimVehicle::default();
        assert!(scenario.apply(0, &mut vehicle).is_err());
    }

    /// 验证 MCU 场景：功能配置、刷卡与防拆上报在到期后注入。
    #[test]
    fn mcu_scenario_emits_swipe_and_anti_dismantle() {
        let scenario = Scenario {
            dual_auth: Some(true),
            steps: vec![Step {
                at_ms: 0,
                mcu_swipe: Some(McuSwipeStep {
                    status: 1,
                    card: Some("DEADBEEF".to_string()),
                    id: Some("123456789012345678".to_string()),
                    name: Some("SIM".to_string()),
                }),
                mcu_anti_dismantle: Some(true),
                ..Step::default()
            }],
        };
        let mut backend = SimMcuBackend::new(scenario);
        let mut frames = Vec::new();
        backend.poll(&mut frames).expect("轮询场景 MCU");

        let config = frames
            .iter()
            .find(|frame| frame.index == mcu::index::MODULE_CONFIG)
            .expect("应有功能配置上报");
        let config = mcu::ModuleConfig::decode(&config.data).expect("配置解码");
        assert!(config.dual_auth);

        let swipe = frames
            .iter()
            .find(|frame| frame.index == mcu::index::SWIPE_REPORT)
            .expect("应有刷卡上报");
        let report = mcu::SwipeReport::decode(&swipe.data).expect("刷卡解码");
        assert_eq!(report.status, 1);
        assert_eq!(report.card, [0xDE, 0xAD, 0xBE, 0xEF]);
        assert_eq!(report.name, *b"SIM\0\0\0\0\0");
        assert_eq!(report.license_tail_digits(false), vec![5, 6, 7, 8]);

        let alarm = frames
            .iter()
            .find(|frame| frame.index == mcu::index::ANTI_DISMANTLE_REPORT)
            .expect("应有防拆上报");
        assert_eq!(alarm.data, vec![1]);
    }

    /// 验证 RTC 查询会得到一条时间应答。
    #[test]
    fn mcu_rtc_query_gets_reply() {
        let mut backend = SimMcuBackend::new(Scenario::default());
        let mut frames = Vec::new();
        backend.poll(&mut frames).expect("首次轮询");
        let query = Frame::new(mcu::CMD_QUERY, mcu::index::RTC, vec![0; 6]).expect("构造查询");
        backend.send(&query).expect("发送查询");
        frames.clear();
        backend.poll(&mut frames).expect("二次轮询");
        let reply = frames
            .iter()
            .find(|frame| frame.index == mcu::index::RTC && frame.cmd == mcu::CMD_QUERY_RESP)
            .expect("应有 RTC 应答");
        assert_eq!(reply.data.len(), 6);
        assert!(backend.sent_frames().iter().any(|frame| frame.index == mcu::index::RTC));
    }
}
