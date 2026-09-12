//! 音频后端。M6 接入 ALSA 与板载 Codec；此前 mock 会把每条命令写入日志，
//! 便于在 Mac 上观测 UI 命令链路。

use protocol::SoundId;
use thiserror::Error;

pub const MAX_VOLUME: u8 = 100;

#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum AudioError {
    #[error("ALSA backend is not implemented yet")]
    Unsupported,
    #[error("volume {0} is outside 0-{MAX_VOLUME}")]
    InvalidVolume(u8),
    #[error("audio I/O: {0}")]
    Io(String),
}

pub trait AudioBackend: Send {
    fn play(&mut self, sound: SoundId) -> Result<(), AudioError>;
    fn stop(&mut self) -> Result<(), AudioError>;
    fn set_volume(&mut self, volume: u8) -> Result<(), AudioError>;
}

pub struct MockAudioBackend {
    volume: u8,
}

impl Default for MockAudioBackend {
    /// 默认音量 70。
    fn default() -> Self {
        Self { volume: 70 }
    }
}

impl MockAudioBackend {
    /// 创建 mock 音频后端，音量上限截断到 100。
    pub fn new(volume: u8) -> Self {
        Self {
            volume: volume.min(MAX_VOLUME),
        }
    }

    /// 当前音量。
    pub fn volume(&self) -> u8 {
        self.volume
    }
}

impl AudioBackend for MockAudioBackend {
    /// 记录播放的音效 id。
    fn play(&mut self, sound: SoundId) -> Result<(), AudioError> {
        log::info!(target: "audio", "MockAudioBackend: play {sound:?}");
        Ok(())
    }

    /// 记录停止命令。
    fn stop(&mut self) -> Result<(), AudioError> {
        log::info!(target: "audio", "MockAudioBackend: stop");
        Ok(())
    }

    /// 设置音量；超过 100 返回错误。
    fn set_volume(&mut self, volume: u8) -> Result<(), AudioError> {
        if volume > MAX_VOLUME {
            return Err(AudioError::InvalidVolume(volume));
        }
        self.volume = volume;
        log::info!(target: "audio", "MockAudioBackend: volume {volume}");
        Ok(())
    }
}

/// M6：ALSA 播放（`/dev/snd`）。在硬件 Codec 链路验证通过前报告
/// Unsupported。
pub struct AlsaAudioBackend;

impl AudioBackend for AlsaAudioBackend {
    /// M6 前报告 Unsupported。
    fn play(&mut self, _sound: SoundId) -> Result<(), AudioError> {
        Err(AudioError::Unsupported)
    }

    /// M6 前报告 Unsupported。
    fn stop(&mut self) -> Result<(), AudioError> {
        Err(AudioError::Unsupported)
    }

    /// M6 前报告 Unsupported。
    fn set_volume(&mut self, _volume: u8) -> Result<(), AudioError> {
        Err(AudioError::Unsupported)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// mock 应接受并截断音量。
    #[test]
    fn mock_accepts_and_clamps_volume() {
        let mut backend = MockAudioBackend::new(200);
        assert_eq!(backend.volume(), MAX_VOLUME);
        backend.set_volume(30).unwrap();
        assert_eq!(backend.volume(), 30);
    }

    /// 超过 100 的音量必须被拒绝。
    #[test]
    fn volume_above_100_is_rejected() {
        let mut backend = MockAudioBackend::new(50);
        assert_eq!(
            backend.set_volume(101),
            Err(AudioError::InvalidVolume(101))
        );
    }

    /// ALSA 在实现前必须报告 Unsupported。
    #[test]
    fn alsa_reports_unsupported() {
        let mut backend = AlsaAudioBackend;
        assert_eq!(backend.play(SoundId::Button), Err(AudioError::Unsupported));
    }
}
