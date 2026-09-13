//! UI 设置存储：开机自检/授权使能/密码开机/防拆使能的位域持久化。
//!
//! 存储在 `settings.toml`（与 `auth.toml` 同目录）；默认值与参考工程一致：
//! 授权使能开启，自检/密码开机/防拆关闭。

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// bit0：开机自检。
pub const SETTING_SELF_CHECK: u8 = 1 << 0;
/// bit1：开机授权（刷卡页）使能。
pub const SETTING_AUTHORIZATION: u8 = 1 << 1;
/// bit2：密码开机使能。
pub const SETTING_PASSWORD_BOOT: u8 = 1 << 2;
/// bit3：防拆使能。
pub const SETTING_ANTI_DISMANTLE: u8 = 1 << 3;

/// 默认设置：授权使能开启，其余关闭。
pub const DEFAULT_FLAGS: u8 = SETTING_AUTHORIZATION;

#[derive(Debug, thiserror::Error)]
pub enum SettingsError {
    #[error("持久化设置失败：{message}")]
    Persist { message: String },
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct SettingsFile {
    flags: Option<u8>,
}

/// 位域设置存储。
#[derive(Debug)]
pub struct SettingsStore {
    path: PathBuf,
    flags: u8,
}

impl SettingsStore {
    /// 从磁盘加载（文件不存在/损坏时使用默认位域）。
    pub fn load(path: &Path) -> Self {
        let flags = std::fs::read_to_string(path)
            .ok()
            .and_then(|text| toml::from_str::<SettingsFile>(&text).ok())
            .and_then(|file| file.flags)
            .unwrap_or(DEFAULT_FLAGS);
        Self {
            path: path.to_path_buf(),
            flags,
        }
    }

    /// 当前位域。
    pub fn flags(&self) -> u8 {
        self.flags
    }

    /// 写入位域并持久化。
    pub fn set_flags(&mut self, flags: u8) -> Result<(), SettingsError> {
        self.flags = flags;
        self.persist()
    }

    /// 写回磁盘（目录不存在时创建）。
    fn persist(&self) -> Result<(), SettingsError> {
        let file = SettingsFile {
            flags: Some(self.flags),
        };
        let text = toml::to_string(&file).map_err(|error| SettingsError::Persist {
            message: error.to_string(),
        })?;
        if let Some(parent) = self.path.parent() {
            if !parent.as_os_str().is_empty() {
                std::fs::create_dir_all(parent).map_err(|error| SettingsError::Persist {
                    message: error.to_string(),
                })?;
            }
        }
        std::fs::write(&self.path, text).map_err(|error| SettingsError::Persist {
            message: error.to_string(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 测试用临时路径（每次调用唯一）。
    fn temp_path(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "forklift-settings-{name}-{}.toml",
            std::process::id()
        ))
    }

    #[test]
    fn missing_file_falls_back_to_defaults() {
        let store = SettingsStore::load(&temp_path("missing"));
        assert_eq!(store.flags(), DEFAULT_FLAGS);
    }

    #[test]
    fn set_flags_persists_across_reload() {
        let path = temp_path("persist");
        let _ = std::fs::remove_file(&path);
        let mut store = SettingsStore::load(&path);
        let flags = SETTING_SELF_CHECK | SETTING_PASSWORD_BOOT;
        store.set_flags(flags).expect("写入设置");
        let reloaded = SettingsStore::load(&path);
        assert_eq!(reloaded.flags(), flags);
        let _ = std::fs::remove_file(&path);
    }
}
