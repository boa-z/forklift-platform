//! 密码与授权状态机：三级密码（用户/管理员/超级管理员）、刷卡授权、
//! 双重认证（身份证后 4/6 位）与防拆标志。
//!
//! 管理员密码持久化在 `auth_path`（TOML）；超级管理员密码是常量
//! （参考工程 `LvglPasswordScreen.c` 的 `"32431"`）。输错密码按参考行为
//! 降级为 0 级放行，不做锁定。

use std::path::{Path, PathBuf};

use protocol::mcu::{SilentTime, SwipeReport, SwipeStatus};
use serde::{Deserialize, Serialize};

/// 超级管理员密码（参考工程硬编码常量，不可修改）。
pub const SUPER_PASSWORD: &str = "32431";
/// 出厂默认管理员密码（参考工程 `CommonWriteReadConfig.c`）。
pub const DEFAULT_ADMIN_PASSWORD: &str = "22222";

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum AuthError {
    #[error("旧密码不正确")]
    WrongPassword,
    #[error("新密码必须是 4-8 位数字")]
    InvalidNewPassword,
    #[error("没有等待双重认证的刷卡")]
    NoPendingSwipe,
    #[error("持久化失败：{message}")]
    Persist { message: String },
}

/// 刷卡处理结果。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SwipeOutcome {
    /// 授权通过（含沉默期刷卡）。
    Authorized,
    /// 需要继续输入身份证后 4/6 位。
    NeedsLicenseTail,
    /// 模组上报的非授权状态（失败/重复/其它卡/关机）。
    Reported(SwipeStatus),
}

/// 持久化文件结构。
#[derive(Debug, Default, Serialize, Deserialize)]
struct AuthFile {
    admin_password: Option<String>,
}

/// 授权与密码状态。
#[derive(Debug)]
pub struct AuthManager {
    path: PathBuf,
    admin_password: String,
    level: u8,
    authorized: bool,
    /// 是否启用双重认证（来自模组功能配置上报）。
    pub dual_auth: bool,
    pending_dual: Option<SwipeReport>,
    silent: SilentTime,
    anti_dismantle_enabled: bool,
    anti_dismantle_alarm: bool,
}

impl AuthManager {
    /// 从磁盘加载（文件不存在/损坏时使用出厂默认值）。
    pub fn load(path: &Path) -> Self {
        let admin_password = std::fs::read_to_string(path)
            .ok()
            .and_then(|text| toml::from_str::<AuthFile>(&text).ok())
            .and_then(|file| file.admin_password)
            .unwrap_or_else(|| DEFAULT_ADMIN_PASSWORD.to_string());
        Self {
            path: path.to_path_buf(),
            admin_password,
            level: 0,
            authorized: false,
            dual_auth: false,
            pending_dual: None,
            silent: SilentTime::default(),
            anti_dismantle_enabled: false,
            anti_dismantle_alarm: false,
        }
    }

    /// 当前权限级别（0=用户，1=管理员，2=超级管理员）。
    pub fn level(&self) -> u8 {
        self.level
    }

    /// 是否已通过开机授权（刷卡/蓝牙/沉默期）。
    pub fn authorized(&self) -> bool {
        self.authorized
    }

    /// 静默期快照。
    pub fn silent(&self) -> SilentTime {
        self.silent
    }

    /// 写入静默期（来自模组上报）。
    pub fn set_silent(&mut self, silent: SilentTime) {
        self.silent = silent;
    }

    /// 防拆状态（使能，报警）。
    pub fn anti_dismantle(&self) -> (bool, bool) {
        (self.anti_dismantle_enabled, self.anti_dismantle_alarm)
    }

    /// 设置防拆使能。
    pub fn set_anti_dismantle(&mut self, enabled: bool) {
        self.anti_dismantle_enabled = enabled;
        if !enabled {
            self.anti_dismantle_alarm = false;
        }
    }

    /// 记录模组上报的防拆报警标志。
    pub fn set_anti_dismantle_alarm(&mut self, alarm: bool) {
        self.anti_dismantle_alarm = alarm && self.anti_dismantle_enabled;
    }

    /// 校验设置密码并更新权限级别（输错降级为 0 级）。
    pub fn verify(&mut self, password: &str) -> u8 {
        let level = if password == SUPER_PASSWORD {
            2
        } else if password == self.admin_password {
            1
        } else {
            0
        };
        self.level = level;
        level
    }

    /// 修改管理员密码（需提供当前管理员密码或超级管理员密码）。
    pub fn set_admin_password(&mut self, old: &str, new: &str) -> Result<(), AuthError> {
        if old != self.admin_password && old != SUPER_PASSWORD {
            return Err(AuthError::WrongPassword);
        }
        let valid = (4..=8).contains(&new.len()) && new.chars().all(|c| c.is_ascii_digit());
        if !valid {
            return Err(AuthError::InvalidNewPassword);
        }
        self.admin_password = new.to_string();
        self.persist()
    }

    /// 处理刷卡上报；返回授权/双重认证/上报状态三种结果。
    pub fn on_swipe(&mut self, report: &SwipeReport) -> SwipeOutcome {
        let status = SwipeStatus::from_u8(report.status).unwrap_or(SwipeStatus::Failed);
        match status {
            SwipeStatus::Authorized => {
                if self.dual_auth {
                    self.pending_dual = Some(report.clone());
                    self.authorized = false;
                    SwipeOutcome::NeedsLicenseTail
                } else {
                    self.authorized = true;
                    SwipeOutcome::Authorized
                }
            }
            SwipeStatus::SilentPeriod => {
                self.authorized = true;
                SwipeOutcome::Authorized
            }
            other => {
                self.authorized = false;
                self.pending_dual = None;
                SwipeOutcome::Reported(other)
            }
        }
    }

    /// 校验双重认证的身份证后 4/6 位；成功后置为已授权。
    pub fn enter_license_tail(&mut self, digits: &str) -> Result<bool, AuthError> {
        let report = self.pending_dual.clone().ok_or(AuthError::NoPendingSwipe)?;
        let expected = report.license_tail_digits(digits.chars().count() > 4);
        let entered: Vec<u8> = digits
            .chars()
            .map(|c| match c {
                '0'..='9' => c as u8 - b'0',
                'x' | 'X' => 0x0A,
                _ => 0xFF,
            })
            .collect();
        let passed = entered == expected;
        if passed {
            self.authorized = true;
            self.pending_dual = None;
        }
        Ok(passed)
    }

    /// 写回持久化文件（目录不存在时创建）。
    fn persist(&self) -> Result<(), AuthError> {
        let file = AuthFile {
            admin_password: Some(self.admin_password.clone()),
        };
        let text = toml::to_string(&file).map_err(|error| AuthError::Persist {
            message: error.to_string(),
        })?;
        if let Some(parent) = self.path.parent() {
            if !parent.as_os_str().is_empty() {
                std::fs::create_dir_all(parent).map_err(|error| AuthError::Persist {
                    message: error.to_string(),
                })?;
            }
        }
        std::fs::write(&self.path, text).map_err(|error| AuthError::Persist {
            message: error.to_string(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 测试用临时路径（每次调用唯一）。
    fn temp_path(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!("forklift-auth-{name}-{}.toml", std::process::id()))
    }

    /// 构造一帧刷卡上报。
    fn swipe(status: u8, id_tail: [u8; 9]) -> SwipeReport {
        SwipeReport {
            status,
            index: 0,
            name: [0; 8],
            card: [1, 2, 3, 4],
            id: id_tail,
            phone: [0; 6],
            driver_license: [0; 3],
            ic_license: [0; 3],
        }
    }

    #[test]
    fn verify_maps_three_levels() {
        let mut auth = AuthManager::load(&temp_path("levels"));
        assert_eq!(auth.verify("32431"), 2);
        assert_eq!(auth.level(), 2);
        assert_eq!(auth.verify("22222"), 1);
        assert_eq!(auth.level(), 1);
        assert_eq!(auth.verify("00000"), 0);
        assert_eq!(auth.level(), 0);
    }

    #[test]
    fn admin_password_change_persists() {
        let path = temp_path("change");
        let _ = std::fs::remove_file(&path);
        let mut auth = AuthManager::load(&path);
        assert_eq!(auth.set_admin_password("wrong", "12345"), Err(AuthError::WrongPassword));
        assert_eq!(auth.set_admin_password("22222", "abc"), Err(AuthError::InvalidNewPassword));
        assert_eq!(auth.set_admin_password("22222", "54321"), Ok(()));
        let reloaded = AuthManager::load(&path);
        assert_eq!(reloaded.level(), 0);
        let mut reloaded = reloaded;
        assert_eq!(reloaded.verify("54321"), 1);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn swipe_authorizes_or_requests_dual_auth() {
        let mut auth = AuthManager::load(&temp_path("swipe"));
        assert_eq!(auth.on_swipe(&swipe(1, [0; 9])), SwipeOutcome::Authorized);
        assert!(auth.authorized());

        auth.dual_auth = true;
        assert_eq!(
            auth.on_swipe(&swipe(1, [0; 9])),
            SwipeOutcome::NeedsLicenseTail
        );
        assert!(!auth.authorized());

        assert_eq!(
            auth.on_swipe(&swipe(2, [0; 9])),
            SwipeOutcome::Reported(SwipeStatus::Duplicate)
        );
        assert!(!auth.authorized());
        assert_eq!(
            auth.on_swipe(&swipe(5, [0; 9])),
            SwipeOutcome::Authorized
        );
        assert!(auth.authorized());
    }

    #[test]
    fn license_tail_accepts_bcd_and_x() {
        // 身份证 9 字节 BCD：末 4 位 = 5 6 7 8。
        let id = [0x12, 0x34, 0x56, 0x78, 0x90, 0x12, 0x34, 0x56, 0x78];
        let mut auth = AuthManager::load(&temp_path("license"));
        auth.dual_auth = true;
        assert_eq!(
            auth.on_swipe(&swipe(1, id)),
            SwipeOutcome::NeedsLicenseTail
        );
        assert_eq!(auth.enter_license_tail("0000"), Ok(false));
        assert!(!auth.authorized());
        assert_eq!(auth.enter_license_tail("5678"), Ok(true));
        assert!(auth.authorized());

        // x/X 记 0x0A：末 4 位为 3 4 x x（byte7=0x34，byte8=0xAA）。
        let id = [0x12, 0x34, 0x56, 0x78, 0x90, 0x12, 0x34, 0x34, 0xAA];
        let mut auth = AuthManager::load(&temp_path("license-x"));
        auth.dual_auth = true;
        let _ = auth.on_swipe(&swipe(1, id));
        assert_eq!(auth.enter_license_tail("34xx"), Ok(true));
    }

    #[test]
    fn anti_dismantle_alarm_requires_enable() {
        let mut auth = AuthManager::load(&temp_path("anti"));
        auth.set_anti_dismantle_alarm(true);
        assert_eq!(auth.anti_dismantle(), (false, false));
        auth.set_anti_dismantle(true);
        auth.set_anti_dismantle_alarm(true);
        assert_eq!(auth.anti_dismantle(), (true, true));
        auth.set_anti_dismantle(false);
        assert_eq!(auth.anti_dismantle(), (false, false));
    }
}
