//! 场景模拟后端：按时间线修改一辆虚拟叉车的状态，并编码为与 daemon mock
//! 相同的临时 CAN 帧（0x301/0x302/0x303），从而完整经过解码与策略链路。

use std::path::Path;

use forkliftd::backends::{CanBackend, CanFrame, CanError};
use forkliftd::diagnostics::now_ms;
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
        }
    }
}

/// 场景中的一步：到 `at_ms` 时把给定字段写入虚拟车辆。
#[derive(Debug, Clone, Deserialize)]
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
    /// `motor_overheat` / `battery_low` / `can_offline` 便捷故障注入。
    pub fault: Option<String>,
}

/// 场景文件：TOML 中的 `[[step]]` 数组。
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Scenario {
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
            dlc: 6,
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
                    soc_percent: None,
                    rpm: None,
                    motor_temp_c: None,
                    direction: Some("reverse".to_string()),
                    charging: None,
                    fault: None,
                },
                Step {
                    at_ms: 200,
                    speed_kph: None,
                    soc_percent: Some(55.0),
                    rpm: None,
                    motor_temp_c: None,
                    direction: None,
                    charging: None,
                    fault: None,
                },
            ],
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
                speed_kph: None,
                soc_percent: None,
                rpm: None,
                motor_temp_c: None,
                direction: None,
                charging: None,
                fault: Some("motor_overheat".to_string()),
            }],
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
                speed_kph: None,
                soc_percent: None,
                rpm: None,
                motor_temp_c: None,
                direction: Some("sideways".to_string()),
                charging: None,
                fault: None,
            }],
        };
        let mut vehicle = SimVehicle::default();
        assert!(scenario.apply(0, &mut vehicle).is_err());
    }
}
