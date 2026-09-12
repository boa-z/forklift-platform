//! Hardware backends. Every subsystem is a trait plus a mock and a
//! platform implementation; only these modules may touch Linux/ArtInChip
//! interfaces.

pub mod adc;
pub mod audio;
pub mod camera;
pub mod can;
pub mod watchdog;

pub use adc::{AdcBackend, AdcChannel, IioAdcBackend, MockAdcBackend};
pub use audio::{AlsaAudioBackend, AudioBackend, MockAudioBackend};
pub use camera::{AicCameraBackend, CameraBackend, CameraHealth, MockCameraBackend};
pub use can::{CanBackend, CanError, CanFrame, MockCanBackend, SocketCanBackend};
pub use watchdog::{LinuxWatchdog, MockWatchdog, WatchdogBackend};
