//! Fault policy: independent of the CAN decoder, fed by signal quality and
//! backend health. The UI renders ids/severities; it never derives faults.

use std::collections::BTreeMap;

use protocol::{
    Fault, FaultSeverity, FaultSnapshot, SignalQuality, VehicleState, FAULT_BATTERY_LOW,
    FAULT_CAMERA_OFFLINE, FAULT_CAN_OFFLINE, FAULT_MOTOR_OVERHEAT,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FaultChange {
    Raised(Fault),
    Cleared(Fault),
}

#[derive(Default)]
pub struct FaultManager {
    faults: BTreeMap<u32, Fault>,
}

impl FaultManager {
    pub fn new() -> Self {
        Self::default()
    }

    /// Raises or refreshes a fault. Returns a change only when the fault was
    /// not already active.
    pub fn raise(&mut self, id: u32, severity: FaultSeverity, now_ms: u64) -> Option<FaultChange> {
        match self.faults.get_mut(&id) {
            Some(fault) if fault.active => {
                fault.last_seen_ms = now_ms;
                fault.occurrence_count = fault.occurrence_count.saturating_add(1);
                None
            }
            Some(fault) => {
                fault.active = true;
                fault.severity = severity;
                fault.last_seen_ms = now_ms;
                fault.occurrence_count = fault.occurrence_count.saturating_add(1);
                Some(FaultChange::Raised(fault.clone()))
            }
            None => {
                let fault = Fault::new(id, severity, now_ms);
                self.faults.insert(id, fault.clone());
                Some(FaultChange::Raised(fault))
            }
        }
    }

    pub fn clear(&mut self, id: u32, now_ms: u64) -> Option<FaultChange> {
        let fault = self.faults.get_mut(&id)?;
        if !fault.active {
            return None;
        }
        fault.active = false;
        fault.last_seen_ms = now_ms;
        Some(FaultChange::Cleared(fault.clone()))
    }

    /// Signal-based rules with hysteresis. Backend-failure faults are raised
    /// by the service, not here.
    pub fn evaluate(&mut self, state: &VehicleState, now_ms: u64) -> Vec<FaultChange> {
        let mut changes = Vec::new();
        self.rule(
            state.battery.soc_percent.quality == SignalQuality::Valid
                && state.battery.soc_percent.value < 20.0,
            state.battery.soc_percent.value >= 25.0,
            FAULT_BATTERY_LOW,
            FaultSeverity::Warning,
            now_ms,
            &mut changes,
        );
        self.rule(
            state.motor.temperature_c.quality == SignalQuality::Valid
                && state.motor.temperature_c.value > 80.0,
            state.motor.temperature_c.value < 75.0,
            FAULT_MOTOR_OVERHEAT,
            FaultSeverity::Critical,
            now_ms,
            &mut changes,
        );
        self.rule(
            !state.connectivity.can_online,
            state.connectivity.can_online,
            FAULT_CAN_OFFLINE,
            FaultSeverity::Critical,
            now_ms,
            &mut changes,
        );
        changes
    }

    #[allow(clippy::too_many_arguments)]
    fn rule(
        &mut self,
        condition: bool,
        clear_condition: bool,
        id: u32,
        severity: FaultSeverity,
        now_ms: u64,
        changes: &mut Vec<FaultChange>,
    ) {
        if condition {
            if let Some(change) = self.raise(id, severity, now_ms) {
                changes.push(change);
            }
        } else if clear_condition {
            if let Some(change) = self.clear(id, now_ms) {
                changes.push(change);
            }
        }
    }

    /// Camera policy fault: raised while reverse video is requested but the
    /// camera reports offline.
    pub fn evaluate_camera(&mut self, camera_expected: bool, online: bool, now_ms: u64) -> Vec<FaultChange> {
        let mut changes = Vec::new();
        if camera_expected && !online {
            if let Some(change) = self.raise(FAULT_CAMERA_OFFLINE, FaultSeverity::Warning, now_ms) {
                changes.push(change);
            }
        } else if let Some(change) = self.clear(FAULT_CAMERA_OFFLINE, now_ms) {
            changes.push(change);
        }
        changes
    }

    pub fn snapshot(&self, now_ms: u64) -> FaultSnapshot {
        FaultSnapshot {
            timestamp_ms: now_ms,
            faults: self.faults.values().cloned().collect(),
        }
    }

    pub fn active_ids(&self) -> Vec<u32> {
        self.faults
            .values()
            .filter(|fault| fault.active)
            .map(|fault| fault.id)
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use protocol::VehicleState;

    fn state_with_soc(soc: f32) -> VehicleState {
        let mut state = VehicleState::unavailable(0);
        state.battery.soc_percent = protocol::Signal::new(soc, 1_000);
        state.connectivity.can_online = true;
        state
    }

    #[test]
    fn raising_twice_emits_one_change_and_counts_occurrences() {
        let mut manager = FaultManager::new();
        assert!(matches!(
            manager.raise(0x42, FaultSeverity::Warning, 100),
            Some(FaultChange::Raised(_))
        ));
        assert!(manager.raise(0x42, FaultSeverity::Warning, 200).is_none());
        let snapshot = manager.snapshot(300);
        assert_eq!(snapshot.faults.len(), 1);
        assert_eq!(snapshot.faults[0].occurrence_count, 2);
        assert_eq!(snapshot.faults[0].last_seen_ms, 200);
    }

    #[test]
    fn low_battery_rule_has_hysteresis() {
        let mut manager = FaultManager::new();
        let raised = manager.evaluate(&state_with_soc(15.0), 1_000);
        assert!(matches!(raised.as_slice(), [FaultChange::Raised(_)]));
        let still_low = manager.evaluate(&state_with_soc(22.0), 2_000);
        assert!(still_low.is_empty());
        let cleared = manager.evaluate(&state_with_soc(30.0), 3_000);
        assert!(matches!(cleared.as_slice(), [FaultChange::Cleared(_)]));
    }

    #[test]
    fn can_offline_raises_and_clears() {
        let mut manager = FaultManager::new();
        let mut offline = VehicleState::unavailable(0);
        offline.connectivity.can_online = false;
        let raised = manager.evaluate(&offline, 1_000);
        assert!(matches!(raised.as_slice(), [FaultChange::Raised(fault)] if fault.id == FAULT_CAN_OFFLINE));
        let cleared = manager.evaluate(&state_with_soc(50.0), 2_000);
        assert!(cleared.iter().any(|change| matches!(change, FaultChange::Cleared(fault) if fault.id == FAULT_CAN_OFFLINE)));
    }
}
