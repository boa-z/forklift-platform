//! Camera control. Pixels never enter IPC or QuickJS; this backend only owns
//! visibility/health. The M4 milestone routes VIN → DMA-BUF → DE Video Layer.

use thiserror::Error;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CameraHealth {
    Healthy,
    Degraded,
    Failed,
    Unknown,
}

#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum CameraError {
    #[error("AIC camera backend is not implemented yet")]
    Unsupported,
    #[error("camera I/O: {0}")]
    Io(String),
}

pub trait CameraBackend: Send {
    fn start(&mut self) -> Result<(), CameraError>;
    fn stop(&mut self) -> Result<(), CameraError>;
    fn set_visible(&mut self, visible: bool) -> Result<(), CameraError>;
    fn is_visible(&self) -> bool;
    fn health(&self) -> CameraHealth;
}

#[derive(Default)]
pub struct MockCameraBackend {
    visible: bool,
    started: bool,
}

impl MockCameraBackend {
    pub fn new() -> Self {
        Self::default()
    }
}

impl CameraBackend for MockCameraBackend {
    fn start(&mut self) -> Result<(), CameraError> {
        self.started = true;
        log::info!(target: "camera", "MockCameraBackend: stream started");
        Ok(())
    }

    fn stop(&mut self) -> Result<(), CameraError> {
        self.started = false;
        self.visible = false;
        log::info!(target: "camera", "MockCameraBackend: stream stopped");
        Ok(())
    }

    fn set_visible(&mut self, visible: bool) -> Result<(), CameraError> {
        if visible != self.visible {
            log::info!(
                target: "camera",
                "MockCameraBackend: video layer {}",
                if visible { "visible" } else { "hidden" }
            );
        }
        self.visible = visible;
        Ok(())
    }

    fn is_visible(&self) -> bool {
        self.visible
    }

    fn health(&self) -> CameraHealth {
        if self.started {
            CameraHealth::Healthy
        } else {
            CameraHealth::Unknown
        }
    }
}

/// M4: ArtInChip VIN + DE video layer. Until then the policy layer sees an
/// explicit Unsupported instead of a silent no-op.
pub struct AicCameraBackend;

impl CameraBackend for AicCameraBackend {
    fn start(&mut self) -> Result<(), CameraError> {
        Err(CameraError::Unsupported)
    }

    fn stop(&mut self) -> Result<(), CameraError> {
        Ok(())
    }

    fn set_visible(&mut self, _visible: bool) -> Result<(), CameraError> {
        Err(CameraError::Unsupported)
    }

    fn is_visible(&self) -> bool {
        false
    }

    fn health(&self) -> CameraHealth {
        CameraHealth::Unknown
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mock_tracks_visibility() {
        let mut backend = MockCameraBackend::new();
        backend.start().unwrap();
        assert_eq!(backend.health(), CameraHealth::Healthy);
        backend.set_visible(true).unwrap();
        assert!(backend.is_visible());
        backend.stop().unwrap();
        assert!(!backend.is_visible());
    }

    #[test]
    fn aic_reports_unsupported() {
        let mut backend = AicCameraBackend;
        assert_eq!(backend.start(), Err(CameraError::Unsupported));
        assert_eq!(backend.health(), CameraHealth::Unknown);
    }
}
