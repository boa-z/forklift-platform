//! 相机控制。像素不进入 IPC/QuickJS；本后端只负责可见性与健康。
//! M4 起走 VIN → DMA-BUF → DE 视频层。

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
    /// 创建 mock 相机后端（未启动、不可见）。
    pub fn new() -> Self {
        Self::default()
    }
}

impl CameraBackend for MockCameraBackend {
    /// 启动 mock 视频流。
    fn start(&mut self) -> Result<(), CameraError> {
        self.started = true;
        log::info!(target: "camera", "MockCameraBackend: stream started");
        Ok(())
    }

    /// 停止 mock 视频流并隐藏视频层。
    fn stop(&mut self) -> Result<(), CameraError> {
        self.started = false;
        self.visible = false;
        log::info!(target: "camera", "MockCameraBackend: stream stopped");
        Ok(())
    }

    /// 切换视频层可见性（变化时记录日志）。
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

    /// 当前视频层是否可见。
    fn is_visible(&self) -> bool {
        self.visible
    }

    /// 已启动视为健康，否则未知。
    fn health(&self) -> CameraHealth {
        if self.started {
            CameraHealth::Healthy
        } else {
            CameraHealth::Unknown
        }
    }
}

/// M4：ArtInChip VIN + DE 视频层。在此之前策略层看到的是明确的
/// Unsupported，而不是静默空操作。
pub struct AicCameraBackend;

impl CameraBackend for AicCameraBackend {
    /// M4 前报告 Unsupported。
    fn start(&mut self) -> Result<(), CameraError> {
        Err(CameraError::Unsupported)
    }

    /// 停止为空操作（尚未启动过）。
    fn stop(&mut self) -> Result<(), CameraError> {
        Ok(())
    }

    /// M4 前报告 Unsupported。
    fn set_visible(&mut self, _visible: bool) -> Result<(), CameraError> {
        Err(CameraError::Unsupported)
    }

    /// 尚未实现，恒为不可见。
    fn is_visible(&self) -> bool {
        false
    }

    /// 尚未实现，健康状态未知。
    fn health(&self) -> CameraHealth {
        CameraHealth::Unknown
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// mock 相机应正确跟踪启动与可见性。
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

    /// AIC 相机在实现前必须报告 Unsupported。
    #[test]
    fn aic_reports_unsupported() {
        let mut backend = AicCameraBackend;
        assert_eq!(backend.start(), Err(CameraError::Unsupported));
        assert_eq!(backend.health(), CameraHealth::Unknown);
    }
}
