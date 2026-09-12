//! Health and runtime telemetry. Memory numbers exist because the D211 has
//! 64 MB total and the architecture budget must be observable.

use std::time::{SystemTime, UNIX_EPOCH};

/// Milliseconds since the Unix epoch; the one clock all timestamps use.
pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct MemorySample {
    /// Resident set size of this process (kB).
    pub rss_kb: u32,
    /// System-wide `MemAvailable` (kB).
    pub mem_available_kb: u32,
}

/// Reads `/proc` on Linux; other platforms report zeroes so the protocol
/// still carries the fields during Mac development.
pub fn sample_memory() -> MemorySample {
    #[cfg(target_os = "linux")]
    {
        let rss_kb = std::fs::read_to_string("/proc/self/status")
            .ok()
            .and_then(|text| {
                text.lines()
                    .find(|line| line.starts_with("VmRSS:"))
                    .and_then(|line| line.split_whitespace().nth(1))
                    .and_then(|value| value.parse::<u32>().ok())
            })
            .unwrap_or(0);
        let mem_available_kb = std::fs::read_to_string("/proc/meminfo")
            .ok()
            .and_then(|text| {
                text.lines()
                    .find(|line| line.starts_with("MemAvailable:"))
                    .and_then(|line| line.split_whitespace().nth(1))
                    .and_then(|value| value.parse::<u32>().ok())
            })
            .unwrap_or(0);
        MemorySample {
            rss_kb,
            mem_available_kb,
        }
    }
    #[cfg(not(target_os = "linux"))]
    {
        MemorySample::default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn now_ms_is_after_2020() {
        // 2020-01-01 in milliseconds.
        assert!(now_ms() > 1_577_836_800_000);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn linux_memory_sample_is_nonzero() {
        let sample = sample_memory();
        assert!(sample.rss_kb > 0);
        assert!(sample.mem_available_kb > 0);
    }
}
