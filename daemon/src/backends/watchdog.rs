//! 硬件看门狗。只有 `forkliftd` 喂狗；`forklift-ui` 绝不能持有该设备。

use thiserror::Error;

#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum WatchdogError {
    #[error("Linux watchdog backend is not implemented yet")]
    Unsupported,
    #[error("watchdog I/O: {0}")]
    Io(String),
}

pub trait WatchdogBackend: Send {
    fn feed(&mut self) -> Result<(), WatchdogError>;
}

#[derive(Default)]
pub struct MockWatchdog {
    feeds: u64,
}

impl MockWatchdog {
    /// 创建 mock 看门狗。
    pub fn new() -> Self {
        Self::default()
    }

    /// 已喂狗次数（测试断言用）。
    pub fn feed_count(&self) -> u64 {
        self.feeds
    }
}

impl WatchdogBackend for MockWatchdog {
    /// 累计喂狗次数并记录 trace 日志。
    fn feed(&mut self) -> Result<(), WatchdogError> {
        self.feeds = self.feeds.saturating_add(1);
        log::trace!(target: "watchdog", "MockWatchdog: feed #{}", self.feeds);
        Ok(())
    }
}

/// M8：`/dev/watchdog` + AIC 超时。保留为显式 stub，让服务层接线先于
/// 硬件里程碑存在。
pub struct LinuxWatchdog;

impl WatchdogBackend for LinuxWatchdog {
    /// M8 前报告 Unsupported。
    fn feed(&mut self) -> Result<(), WatchdogError> {
        Err(WatchdogError::Unsupported)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// mock 应正确计数。
    #[test]
    fn mock_counts_feeds() {
        let mut watchdog = MockWatchdog::new();
        watchdog.feed().unwrap();
        watchdog.feed().unwrap();
        assert_eq!(watchdog.feed_count(), 2);
    }

    /// Linux 看门狗在实现前必须报告 Unsupported。
    #[test]
    fn linux_reports_unsupported() {
        let mut watchdog = LinuxWatchdog;
        assert_eq!(watchdog.feed(), Err(WatchdogError::Unsupported));
    }
}
