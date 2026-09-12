//! Audio backend. M6 is ALSA + the on-SoC codec; until then the mock logs
//! every command so the UI command path is observable end to end.

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
    fn default() -> Self {
        Self { volume: 70 }
    }
}

impl MockAudioBackend {
    pub fn new(volume: u8) -> Self {
        Self {
            volume: volume.min(MAX_VOLUME),
        }
    }

    pub fn volume(&self) -> u8 {
        self.volume
    }
}

impl AudioBackend for MockAudioBackend {
    fn play(&mut self, sound: SoundId) -> Result<(), AudioError> {
        log::info!(target: "audio", "MockAudioBackend: play {sound:?}");
        Ok(())
    }

    fn stop(&mut self) -> Result<(), AudioError> {
        log::info!(target: "audio", "MockAudioBackend: stop");
        Ok(())
    }

    fn set_volume(&mut self, volume: u8) -> Result<(), AudioError> {
        if volume > MAX_VOLUME {
            return Err(AudioError::InvalidVolume(volume));
        }
        self.volume = volume;
        log::info!(target: "audio", "MockAudioBackend: volume {volume}");
        Ok(())
    }
}

/// M6: ALSA playback (`/dev/snd`). Reports Unsupported until the codec path
/// is verified on hardware.
pub struct AlsaAudioBackend;

impl AudioBackend for AlsaAudioBackend {
    fn play(&mut self, _sound: SoundId) -> Result<(), AudioError> {
        Err(AudioError::Unsupported)
    }

    fn stop(&mut self) -> Result<(), AudioError> {
        Err(AudioError::Unsupported)
    }

    fn set_volume(&mut self, _volume: u8) -> Result<(), AudioError> {
        Err(AudioError::Unsupported)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mock_accepts_and_clamps_volume() {
        let mut backend = MockAudioBackend::new(200);
        assert_eq!(backend.volume(), MAX_VOLUME);
        backend.set_volume(30).unwrap();
        assert_eq!(backend.volume(), 30);
    }

    #[test]
    fn volume_above_100_is_rejected() {
        let mut backend = MockAudioBackend::new(50);
        assert_eq!(
            backend.set_volume(101),
            Err(AudioError::InvalidVolume(101))
        );
    }

    #[test]
    fn alsa_reports_unsupported() {
        let mut backend = AlsaAudioBackend;
        assert_eq!(backend.play(SoundId::Button), Err(AudioError::Unsupported));
    }
}
