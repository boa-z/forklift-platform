//! forkliftd: vehicle platform daemon.
//!
//! Module boundaries follow `docs/architecture-spec.md`:
//! hardware backends produce samples → `VehicleUpdate` → `VehicleState` →
//! fault policy → versioned IPC → UI. No business module touches hardware.

pub mod backends;
pub mod config;
pub mod diagnostics;
pub mod fault;
pub mod ipc;
pub mod service;
pub mod vehicle;

pub use config::Config;
pub use service::{Service, ServiceConfig};
pub use vehicle::{VehicleModel, VehicleUpdate};
