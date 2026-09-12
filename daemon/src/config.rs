//! Runtime configuration: `/etc/forklift/forklift.toml` (missing file means
//! defaults; parse errors are fatal so a typo cannot silently change behavior).

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
    /// Unix SOCK_SEQPACKET path for the UI connection.
    pub socket_path: PathBuf,
    /// CAN interface name for the SocketCAN backend.
    pub can_interface: String,
    /// A signal older than this is published as `Stale`.
    pub signal_timeout_ms: u64,
    /// Daemon tick period.
    pub tick_ms: u64,
    /// `STATE_VEHICLE` publish rate.
    pub publish_hz: u32,
    /// Master volume (0-100) restored at startup.
    pub volume: u8,
    /// Panel brightness (0-100) restored at startup.
    pub brightness: u8,
    /// Camera policy participation (`direction == Reverse` shows video).
    pub camera_enable: bool,
    /// Use mock backends instead of Linux/ArtInChip interfaces.
    pub use_mock_hardware: bool,
    pub log_level: String,
}

impl Default for Config {
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
            log_level: "info".to_string(),
        }
    }
}

impl Config {
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

    pub fn tick_duration(&self) -> std::time::Duration {
        std::time::Duration::from_millis(self.tick_ms.max(1))
    }

    pub fn publish_period_ms(&self) -> u64 {
        (1000 / self.publish_hz.max(1) as u64).max(1)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_config_is_valid() {
        let config = Config::default();
        assert_eq!(config.tick_ms, 20);
        assert!(config.use_mock_hardware);
    }

    #[test]
    fn missing_file_falls_back_to_defaults() {
        let config = Config::load(Some(Path::new("/nonexistent/forklift.toml"))).unwrap();
        assert_eq!(config.socket_path, Config::default().socket_path);
    }

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
