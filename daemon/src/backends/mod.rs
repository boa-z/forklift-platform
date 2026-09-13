//! 硬件后端。每个子系统由一个 trait、一个 mock 和一个平台实现组成；
//! 只有这些模块可以直接访问 Linux/ArtInChip 接口。

pub mod adc;
pub mod audio;
pub mod camera;
pub mod can;
pub mod mcu;
pub mod watchdog;

pub use adc::{AdcBackend, AdcChannel, IioAdcBackend, MockAdcBackend};
pub use audio::{AlsaAudioBackend, AudioBackend, MockAudioBackend};
pub use camera::{AicCameraBackend, CameraBackend, CameraHealth, MockCameraBackend};
pub use can::{CanBackend, CanError, CanFrame, MockCanBackend, SocketCanBackend};
pub use mcu::{McuBackend, MockMcuBackend, SerialMcuBackend};
pub use watchdog::{LinuxWatchdog, MockWatchdog, WatchdogBackend};
