//! Hardware watchdog. Only `forkliftd` feeds it; `forklift-ui` must never
//! hold the device open.

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
    pub fn new() -> Self {
        Self::default()
    }

    pub fn feed_count(&self) -> u64 {
        self.feeds
    }
}

impl WatchdogBackend for MockWatchdog {
    fn feed(&mut self) -> Result<(), WatchdogError> {
        self.feeds = self.feeds.saturating_add(1);
        log::trace!(target: "watchdog", "MockWatchdog: feed #{}", self.feeds);
        Ok(())
    }
}

/// M8: `/dev/watchdog` with the AIC timeout. Kept as an explicit stub so the
/// service wiring exists before the hardware milestone.
pub struct LinuxWatchdog;

impl WatchdogBackend for LinuxWatchdog {
    fn feed(&mut self) -> Result<(), WatchdogError> {
        Err(WatchdogError::Unsupported)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mock_counts_feeds() {
        let mut watchdog = MockWatchdog::new();
        watchdog.feed().unwrap();
        watchdog.feed().unwrap();
        assert_eq!(watchdog.feed_count(), 2);
    }

    #[test]
    fn linux_reports_unsupported() {
        let mut watchdog = LinuxWatchdog;
        assert_eq!(watchdog.feed(), Err(WatchdogError::Unsupported));
    }
}
