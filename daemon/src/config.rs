//! 运行配置：`/etc/forklift/forklift.toml`（文件不存在使用默认值；存在但解析
//! 失败会直接报错，避免拼写错误静默生效）。

use std::path::{Path, PathBuf};

use serde::Deserialize;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum ConfigError {
    #[error("read {path}: {source}")]
    Read { path: String, source: std::io::Error },
    #[error("parse {path}: {source}")]
    Parse { path: String, source: toml::de::Error },
}

#[derive(Debug, Clone, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Config {
    /// UI 连接的 SOCK_SEQPACKET 路径。
    pub socket_path: PathBuf,
    /// SocketCAN 后端使用的 CAN 接口名。
    pub can_interface: String,
    /// A signal older than this is published as `Stale`.
    pub signal_timeout_ms: u64,
    /// 守护进程 tick 周期。
    pub tick_ms: u64,
    /// `STATE_VEHICLE` publish rate.
    pub publish_hz: u32,
    /// 启动时还原的主音量（0-100）。
    pub volume: u8,
    /// 启动时还原的面板亮度（0-100）。
    pub brightness: u8,
    /// 是否参与倒车相机策略（`direction == Reverse` 时显示视频）。
    pub camera_enable: bool,
    /// 使用 mock 后端而不是 Linux/ArtInChip 接口。
    pub use_mock_hardware: bool,
    /// 启用 MCU（模组）串口链路。
    pub mcu_enable: bool,
    /// MCU 串口设备（D70T：GPD_P6/P7 接模组）。
    pub mcu_device: PathBuf,
    /// MCU 串口波特率（参考工程 115200）。
    pub mcu_baud: u32,
    /// 管理员密码等授权状态的持久化路径。
    pub auth_path: PathBuf,
    /// UI 设置位域的持久化路径。
    pub settings_path: PathBuf,
    pub log_level: String,
}

impl Default for Config {
    /// 默认配置：mock 后端、/run/forklift 路径、25 Hz 发布。
    fn default() -> Self {
        Self {
            socket_path: PathBuf::from("/run/forklift/forkliftd.sock"),
            can_interface: "can0".to_string(),
            signal_timeout_ms: 500,
            tick_ms: 20,
            publish_hz: 25,
            volume: 70,
            brightness: 80,
            camera_enable: true,
            use_mock_hardware: true,
            mcu_enable: false,
            mcu_device: PathBuf::from("/dev/ttyS1"),
            mcu_baud: 115200,
            auth_path: PathBuf::from("/var/lib/forklift/auth.toml"),
            settings_path: PathBuf::from("/var/lib/forklift/settings.toml"),
            log_level: "info".to_string(),
        }
    }
}

impl Config {
    /// 从可选路径加载配置；路径为空或文件不存在时返回默认值。
    pub fn load(path: Option<&Path>) -> Result<Self, ConfigError> {
        let Some(path) = path else {
            return Ok(Self::default());
        };
        if !path.exists() {
            return Ok(Self::default());
        }
        let text = std::fs::read_to_string(path).map_err(|source| ConfigError::Read {
            path: path.display().to_string(),
            source,
        })?;
        toml::from_str(&text).map_err(|source| ConfigError::Parse {
            path: path.display().to_string(),
            source,
        })
    }

    /// 服务循环周期（毫秒转 Duration，至少 1ms）。
    pub fn tick_duration(&self) -> std::time::Duration {
        std::time::Duration::from_millis(self.tick_ms.max(1))
    }

    /// 状态发布周期（由 publish_hz 换算，至少 1ms）。
    pub fn publish_period_ms(&self) -> u64 {
        (1000 / self.publish_hz.max(1) as u64).max(1)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 默认配置应满足基本不变量。
    #[test]
    fn default_config_is_valid() {
        let config = Config::default();
        assert_eq!(config.tick_ms, 20);
        assert!(config.use_mock_hardware);
    }

    /// 文件不存在时静默回退默认值。
    #[test]
    fn missing_file_falls_back_to_defaults() {
        let config = Config::load(Some(Path::new("/nonexistent/forklift.toml"))).unwrap();
        assert_eq!(config.socket_path, Config::default().socket_path);
    }

    /// 部分 TOML 只覆盖写明的字段。
    #[test]
    fn partial_toml_overrides_only_named_fields() {
        let dir = std::env::temp_dir();
        let path = dir.join(format!("forklift-test-{}.toml", std::process::id()));
        std::fs::write(&path, "publish_hz = 10\nlog_level = \"debug\"\n").unwrap();
        let config = Config::load(Some(&path)).unwrap();
        std::fs::remove_file(&path).ok();
        assert_eq!(config.publish_hz, 10);
        assert_eq!(config.log_level, "debug");
        assert_eq!(config.tick_ms, 20);
    }

    /// 未知键必须导致启动失败。
    #[test]
    fn unknown_key_is_rejected() {
        let dir = std::env::temp_dir();
        let path = dir.join(format!("forklift-test-bad-{}.toml", std::process::id()));
        std::fs::write(&path, "tick_ms = 10\nnonsense = true\n").unwrap();
        let result = Config::load(Some(&path));
        std::fs::remove_file(&path).ok();
        assert!(result.is_err());
    }
}
