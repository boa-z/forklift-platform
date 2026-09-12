//! ADC backend. Channel numbering is product wiring; the UI only sees
//! `VehicleState.hydraulics.pressure_mpa` (and future calibrated signals).

use thiserror::Error;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AdcChannel {
    /// GPAI7 on the reference wiring, scaled to MPa by calibration.
    HydraulicPressure = 0,
}

#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum AdcError {
    #[error("IIO backend is not implemented yet")]
    Unsupported,
    #[error("ADC I/O: {0}")]
    Io(String),
}

pub trait AdcBackend: Send {
    fn read_channel(&mut self, channel: AdcChannel) -> Result<f32, AdcError>;
}

/// M2: Linux IIO. Reports Unsupported until the channel/calibration config
/// is confirmed on hardware.
pub struct IioAdcBackend;

impl AdcBackend for IioAdcBackend {
    fn read_channel(&mut self, _channel: AdcChannel) -> Result<f32, AdcError> {
        Err(AdcError::Unsupported)
    }
}

/// 确定性 mock：12–16 MPa 的缓慢压力扫描。
#[derive(Default)]
pub struct MockAdcBackend {
    tick: u32,
}

impl MockAdcBackend {
    pub fn new() -> Self {
        Self::default()
    }
}

impl AdcBackend for MockAdcBackend {
    fn read_channel(&mut self, _channel: AdcChannel) -> Result<f32, AdcError> {
        self.tick = self.tick.wrapping_add(1);
        Ok(12.0 + (self.tick % 100) as f32 * 0.04)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mock_reads_stay_in_the_calibrated_band() {
        let mut backend = MockAdcBackend::new();
        for _ in 0..200 {
            let value = backend.read_channel(AdcChannel::HydraulicPressure).unwrap();
            assert!((12.0..16.5).contains(&value));
        }
    }

    #[test]
    fn iio_reports_unsupported() {
        let mut backend = IioAdcBackend;
        assert_eq!(
            backend.read_channel(AdcChannel::HydraulicPressure),
            Err(AdcError::Unsupported)
        );
    }
}
