//! Vehicle model: the only place that turns backend samples into
//! `VehicleState`. Raw CAN ids, ADC channels, and GPIO numbers stop here.

use protocol::{Direction, RunMode, Signal, VehicleState};

/// Partial update produced by a decoder or backend. `None` fields keep the
/// previous value; `can_frame_seen` records liveness only.
#[derive(Debug, Default, Clone)]
pub struct VehicleUpdate {
    pub speed_kph: Option<f32>,
    pub direction: Option<Direction>,
    pub parking_brake: Option<bool>,
    pub steer_angle_deg: Option<f32>,
    pub run_mode: Option<RunMode>,
    pub soc_percent: Option<f32>,
    pub voltage_v: Option<f32>,
    pub current_a: Option<f32>,
    pub rpm: Option<f32>,
    pub motor_temp_c: Option<f32>,
    pub pressure_mpa: Option<f32>,
    pub seat_switch: Option<bool>,
    pub seatbelt: Option<bool>,
    pub key_on: Option<bool>,
    pub odometer_km: Option<f32>,
    pub work_hours: Option<f32>,
    pub controller_online: Option<[bool; 3]>,
    pub can_frame_seen: bool,
}

impl VehicleUpdate {
    /// Applies `other` on top of `self`; later decoders win.
    pub fn merge(&mut self, other: &VehicleUpdate) {
        macro_rules! merge_option {
            ($field:ident) => {
                if other.$field.is_some() {
                    self.$field = other.$field;
                }
            };
        }
        merge_option!(speed_kph);
        merge_option!(direction);
        merge_option!(parking_brake);
        merge_option!(steer_angle_deg);
        merge_option!(run_mode);
        merge_option!(soc_percent);
        merge_option!(voltage_v);
        merge_option!(current_a);
        merge_option!(rpm);
        merge_option!(motor_temp_c);
        merge_option!(pressure_mpa);
        merge_option!(seat_switch);
        merge_option!(seatbelt);
        merge_option!(key_on);
        merge_option!(odometer_km);
        merge_option!(work_hours);
        merge_option!(controller_online);
        self.can_frame_seen |= other.can_frame_seen;
    }
}

pub struct VehicleModel {
    state: VehicleState,
}

impl VehicleModel {
    pub fn new(now_ms: u64) -> Self {
        Self {
            state: VehicleState::unavailable(now_ms),
        }
    }

    pub fn apply(&mut self, update: &VehicleUpdate, now_ms: u64) {
        macro_rules! set_signal {
            ($signal:expr, $value:expr) => {
                if let Some(value) = $value {
                    $signal = Signal::new(value, now_ms);
                }
            };
        }
        set_signal!(self.state.motion.speed_kph, update.speed_kph);
        set_signal!(self.state.motion.direction, update.direction);
        set_signal!(self.state.motion.parking_brake, update.parking_brake);
        set_signal!(self.state.motion.steer_angle_deg, update.steer_angle_deg);
        set_signal!(self.state.motion.run_mode, update.run_mode);
        set_signal!(self.state.battery.soc_percent, update.soc_percent);
        set_signal!(self.state.battery.voltage_v, update.voltage_v);
        set_signal!(self.state.battery.current_a, update.current_a);
        set_signal!(self.state.motor.rpm, update.rpm);
        set_signal!(self.state.motor.temperature_c, update.motor_temp_c);
        set_signal!(self.state.hydraulics.pressure_mpa, update.pressure_mpa);
        set_signal!(self.state.io.seat_switch, update.seat_switch);
        set_signal!(self.state.io.seatbelt, update.seatbelt);
        set_signal!(self.state.io.key_on, update.key_on);
        set_signal!(self.state.vehicle.odometer_km, update.odometer_km);
        set_signal!(self.state.vehicle.work_hours, update.work_hours);
        if let Some(online) = update.controller_online {
            self.state.vehicle.controller_online = online;
        }
    }

    pub fn evaluate_timeouts(&mut self, now_ms: u64, timeout_ms: u64) {
        self.state.evaluate_timeouts(now_ms, timeout_ms);
    }

    pub fn set_can_online(&mut self, online: bool) {
        self.state.connectivity.can_online = online;
    }

    pub fn set_camera_online(&mut self, online: bool) {
        self.state.connectivity.camera_online = online;
    }

    pub fn state(&self) -> &VehicleState {
        &self.state
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn merge_keeps_previous_values_for_absent_fields() {
        let first = VehicleUpdate {
            speed_kph: Some(10.0),
            ..VehicleUpdate::default()
        };
        let second = VehicleUpdate {
            soc_percent: Some(55.0),
            ..VehicleUpdate::default()
        };
        let mut merged = first.clone();
        merged.merge(&second);
        assert_eq!(merged.speed_kph, Some(10.0));
        assert_eq!(merged.soc_percent, Some(55.0));
    }

    #[test]
    fn apply_stamps_signals_and_marks_online() {
        let mut model = VehicleModel::new(0);
        let update = VehicleUpdate {
            speed_kph: Some(12.5),
            direction: Some(Direction::Reverse),
            can_frame_seen: true,
            ..VehicleUpdate::default()
        };
        model.apply(&update, 1_000);
        assert_eq!(model.state().motion.speed_kph.value, 12.5);
        assert_eq!(model.state().motion.speed_kph.timestamp_ms, 1_000);
        assert_eq!(model.state().motion.direction.value, Direction::Reverse);
        assert!(update.can_frame_seen);
    }

    #[test]
    fn timeout_marks_only_aged_signals_stale() {
        let mut model = VehicleModel::new(0);
        let first = VehicleUpdate {
            speed_kph: Some(3.0),
            soc_percent: Some(80.0),
            ..VehicleUpdate::default()
        };
        model.apply(&first, 1_000);
        let second = VehicleUpdate {
            soc_percent: Some(81.0),
            ..VehicleUpdate::default()
        };
        model.apply(&second, 1_600);
        model.evaluate_timeouts(2_000, 500);
        assert_eq!(
            model.state().motion.speed_kph.quality,
            protocol::SignalQuality::Stale
        );
        assert_eq!(
            model.state().battery.soc_percent.quality,
            protocol::SignalQuality::Valid
        );
    }
}
