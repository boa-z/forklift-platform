//! ADC 后端。通道编号是产品接线事实；UI 只看到标定后的
//! `VehicleState.hydraulics.pressure_mpa`（后续还会有其它标定信号）。

use thiserror::Error;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AdcChannel {
    /// 参考接线为 GPAI7，经标定换算为 MPa。
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

/// M2：Linux IIO。在通道与标定参数于硬件上确认前报告 Unsupported。
pub struct IioAdcBackend;

impl AdcBackend for IioAdcBackend {
    /// M2 前明确返回 Unsupported。
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
    /// 创建 mock ADC 后端。
    pub fn new() -> Self {
        Self::default()
    }
}

impl AdcBackend for MockAdcBackend {
    /// 返回 12–16 MPa 区间的缓慢扫描值。
    fn read_channel(&mut self, _channel: AdcChannel) -> Result<f32, AdcError> {
        self.tick = self.tick.wrapping_add(1);
        Ok(12.0 + (self.tick % 100) as f32 * 0.04)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// mock 采样应始终位于标定区间内。
    #[test]
    fn mock_reads_stay_in_the_calibrated_band() {
        let mut backend = MockAdcBackend::new();
        for _ in 0..200 {
            let value = backend.read_channel(AdcChannel::HydraulicPressure).unwrap();
            assert!((12.0..16.5).contains(&value));
        }
    }

    /// IIO 在实现前必须报告 Unsupported。
    #[test]
    fn iio_reports_unsupported() {
        let mut backend = IioAdcBackend;
        assert_eq!(
            backend.read_channel(AdcChannel::HydraulicPressure),
            Err(AdcError::Unsupported)
        );
    }
}
