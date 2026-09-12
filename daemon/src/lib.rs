//! forkliftd：车辆平台守护进程。
//!
//! 模块边界遵循 `docs/architecture-spec.md`：
//! 硬件后端产生采样 → `VehicleUpdate` → `VehicleState` → 故障策略 →
//! 版本化 IPC → UI。业务模块不直接接触硬件。

pub mod auth;
pub mod backends;
pub mod config;
pub mod diagnostics;
pub mod fault;
pub mod ipc;
pub mod service;
pub mod vehicle;

pub use auth::{AuthError, AuthManager, SwipeOutcome};
pub use config::Config;
pub use service::{Service, ServiceConfig};
pub use vehicle::{VehicleModel, VehicleUpdate};
