//! 健康与运行时遥测。D211 只有 64 MB RAM，内存数字必须可观测，
//! 因此系统状态里带 RSS 与 MemAvailable。

use std::time::{SystemTime, UNIX_EPOCH};

/// Unix 纪元毫秒；所有时间戳统一使用这一个时钟。
pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct MemorySample {
    /// 本进程常驻内存（kB）。
    pub rss_kb: u32,
    /// 系统 `MemAvailable`（kB）。
    pub mem_available_kb: u32,
}

/// Linux 下读取 `/proc`；其他平台返回 0，Mac 开发期间协议字段仍可传递。
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

    /// 时钟应晚于 2020-01-01。
    #[test]
    fn now_ms_is_after_2020() {
        // 2020-01-01 in milliseconds.
        assert!(now_ms() > 1_577_836_800_000);
    }

    /// Linux 下内存采样必须非零。
    #[cfg(target_os = "linux")]
    #[test]
    fn linux_memory_sample_is_nonzero() {
        let sample = sample_memory();
        assert!(sample.rss_kb > 0);
        assert!(sample.mem_available_kb > 0);
    }
}
