//! VehicleState: the single source of truth published to the UI.
//!
//! Every hardware-derived value is a `Signal<T>`; raw CAN ids, byte offsets,
//! ADC channels, and GPIO numbers never leave the daemon.

use crate::codec::{ProtocolError, Reader, Writer};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SignalQuality {
    Valid = 0,
    Stale = 1,
    Invalid = 2,
    Unavailable = 3,
}

impl SignalQuality {
    pub fn from_u8(value: u8) -> Result<Self, ProtocolError> {
        match value {
            0 => Ok(Self::Valid),
            1 => Ok(Self::Stale),
            2 => Ok(Self::Invalid),
            3 => Ok(Self::Unavailable),
            other => Err(ProtocolError::InvalidEnum {
                field: "SignalQuality",
                value: other as u32,
            }),
        }
    }

    pub fn as_u8(self) -> u8 {
        self as u8
    }
}

/// Values that can travel inside a `Signal<T>`.
pub trait WireValue: Copy + Default {
    fn wire_encode(&self, writer: &mut Writer);
    fn wire_decode(reader: &mut Reader<'_>) -> Result<Self, ProtocolError>;
}

impl WireValue for f32 {
    fn wire_encode(&self, writer: &mut Writer) {
        writer.put_f32(*self);
    }

    fn wire_decode(reader: &mut Reader<'_>) -> Result<Self, ProtocolError> {
        reader.f32()
    }
}

impl WireValue for bool {
    fn wire_encode(&self, writer: &mut Writer) {
        writer.put_bool(*self);
    }

    fn wire_decode(reader: &mut Reader<'_>) -> Result<Self, ProtocolError> {
        reader.bool()
    }
}

impl WireValue for Direction {
    fn wire_encode(&self, writer: &mut Writer) {
        writer.put_u8(self.as_u8());
    }

    fn wire_decode(reader: &mut Reader<'_>) -> Result<Self, ProtocolError> {
        Direction::from_u8(reader.u8()?)
    }
}

impl WireValue for RunMode {
    fn wire_encode(&self, writer: &mut Writer) {
        writer.put_u8(self.as_u8());
    }

    fn wire_decode(reader: &mut Reader<'_>) -> Result<Self, ProtocolError> {
        RunMode::from_u8(reader.u8()?)
    }
}

/// A timestamped, quality-tagged value. Consumers decide how to present a
/// `Stale` or `Unavailable` signal; the raw value is never rewritten.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Signal<T: WireValue> {
    pub value: T,
    pub timestamp_ms: u64,
    pub quality: SignalQuality,
}

impl<T: WireValue> Signal<T> {
    pub fn new(value: T, timestamp_ms: u64) -> Self {
        Self {
            value,
            timestamp_ms,
            quality: SignalQuality::Valid,
        }
    }

    pub fn unavailable() -> Self {
        Self {
            value: T::default(),
            timestamp_ms: 0,
            quality: SignalQuality::Unavailable,
        }
    }

    pub fn age_ms(&self, now_ms: u64) -> u64 {
        now_ms.saturating_sub(self.timestamp_ms)
    }

    /// Marks the signal stale after `timeout_ms` without an update.
    pub fn evaluate(&mut self, now_ms: u64, timeout_ms: u64) -> SignalQuality {
        if self.quality == SignalQuality::Unavailable {
            return self.quality;
        }
        if self.age_ms(now_ms) > timeout_ms {
            self.quality = SignalQuality::Stale;
        }
        self.quality
    }

    pub fn encode(&self, writer: &mut Writer) {
        self.value.wire_encode(writer);
        writer.put_u64(self.timestamp_ms);
        writer.put_u8(self.quality.as_u8());
    }

    pub fn decode(reader: &mut Reader<'_>) -> Result<Self, ProtocolError> {
        let value = T::wire_decode(reader)?;
        let timestamp_ms = reader.u64()?;
        let quality = SignalQuality::from_u8(reader.u8()?)?;
        Ok(Self {
            value,
            timestamp_ms,
            quality,
        })
    }
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub enum Direction {
    #[default]
    Neutral = 0,
    Forward = 1,
    Reverse = 2,
}

impl Direction {
    pub fn from_u8(value: u8) -> Result<Self, ProtocolError> {
        match value {
            0 => Ok(Self::Neutral),
            1 => Ok(Self::Forward),
            2 => Ok(Self::Reverse),
            other => Err(ProtocolError::InvalidEnum {
                field: "Direction",
                value: other as u32,
            }),
        }
    }

    pub fn as_u8(self) -> u8 {
        self as u8
    }
}

/// Reference run modes: 无 / S / E / P.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub enum RunMode {
    #[default]
    None = 0,
    S = 1,
    E = 2,
    P = 3,
}

impl RunMode {
    pub fn from_u8(value: u8) -> Result<Self, ProtocolError> {
        match value {
            0 => Ok(Self::None),
            1 => Ok(Self::S),
            2 => Ok(Self::E),
            3 => Ok(Self::P),
            other => Err(ProtocolError::InvalidEnum {
                field: "RunMode",
                value: other as u32,
            }),
        }
    }

    pub fn as_u8(self) -> u8 {
        self as u8
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct MotionState {
    pub speed_kph: Signal<f32>,
    pub direction: Signal<Direction>,
    pub parking_brake: Signal<bool>,
    pub steer_angle_deg: Signal<f32>,
    /// Reference `uintRunMode`: 0 none / 1 S / 2 E / 3 P.
    pub run_mode: Signal<RunMode>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct BatteryState {
    pub soc_percent: Signal<f32>,
    pub voltage_v: Signal<f32>,
    pub current_a: Signal<f32>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct MotorState {
    pub rpm: Signal<f32>,
    pub temperature_c: Signal<f32>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct HydraulicState {
    pub pressure_mpa: Signal<f32>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct IoState {
    pub seat_switch: Signal<bool>,
    pub seatbelt: Signal<bool>,
    pub key_on: Signal<bool>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ConnectivityState {
    pub can_online: bool,
    pub camera_online: bool,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct VehicleInfo {
    pub odometer_km: Signal<f32>,
    pub work_hours: Signal<f32>,
    pub controller_online: [bool; 3], // traction, pump, steer
}

#[derive(Debug, Clone, PartialEq)]
pub struct VehicleState {
    pub timestamp_ms: u64,
    pub motion: MotionState,
    pub battery: BatteryState,
    pub motor: MotorState,
    pub hydraulics: HydraulicState,
    pub io: IoState,
    pub connectivity: ConnectivityState,
    pub vehicle: VehicleInfo,
}

impl VehicleState {
    /// A fully `Unavailable` state, used before the first backend sample.
    pub fn unavailable(timestamp_ms: u64) -> Self {
        Self {
            timestamp_ms,
            motion: MotionState {
                speed_kph: Signal::unavailable(),
                direction: Signal::unavailable(),
                parking_brake: Signal::unavailable(),
                steer_angle_deg: Signal::unavailable(),
                run_mode: Signal::unavailable(),
            },
            battery: BatteryState {
                soc_percent: Signal::unavailable(),
                voltage_v: Signal::unavailable(),
                current_a: Signal::unavailable(),
            },
            motor: MotorState {
                rpm: Signal::unavailable(),
                temperature_c: Signal::unavailable(),
            },
            hydraulics: HydraulicState {
                pressure_mpa: Signal::unavailable(),
            },
            io: IoState {
                seat_switch: Signal::unavailable(),
                seatbelt: Signal::unavailable(),
                key_on: Signal::unavailable(),
            },
            connectivity: ConnectivityState {
                can_online: false,
                camera_online: false,
            },
            vehicle: VehicleInfo {
                odometer_km: Signal::unavailable(),
                work_hours: Signal::unavailable(),
                controller_online: [false; 3],
            },
        }
    }

    /// Marks aged signals stale; called once per daemon tick.
    pub fn evaluate_timeouts(&mut self, now_ms: u64, timeout_ms: u64) {
        self.timestamp_ms = now_ms;
        self.motion.speed_kph.evaluate(now_ms, timeout_ms);
        self.motion.direction.evaluate(now_ms, timeout_ms);
        self.motion.parking_brake.evaluate(now_ms, timeout_ms);
        self.motion.steer_angle_deg.evaluate(now_ms, timeout_ms);
        self.motion.run_mode.evaluate(now_ms, timeout_ms);
        self.battery.soc_percent.evaluate(now_ms, timeout_ms);
        self.battery.voltage_v.evaluate(now_ms, timeout_ms);
        self.battery.current_a.evaluate(now_ms, timeout_ms);
        self.motor.rpm.evaluate(now_ms, timeout_ms);
        self.motor.temperature_c.evaluate(now_ms, timeout_ms);
        self.hydraulics.pressure_mpa.evaluate(now_ms, timeout_ms);
        self.io.seat_switch.evaluate(now_ms, timeout_ms);
        self.io.seatbelt.evaluate(now_ms, timeout_ms);
        self.io.key_on.evaluate(now_ms, timeout_ms);
        self.vehicle.odometer_km.evaluate(now_ms, timeout_ms);
        self.vehicle.work_hours.evaluate(now_ms, timeout_ms);
    }

    pub fn encode(&self, writer: &mut Writer) {
        writer.put_u64(self.timestamp_ms);
        self.motion.speed_kph.encode(writer);
        self.motion.direction.encode(writer);
        self.motion.parking_brake.encode(writer);
        self.motion.steer_angle_deg.encode(writer);
        self.motion.run_mode.encode(writer);
        self.battery.soc_percent.encode(writer);
        self.battery.voltage_v.encode(writer);
        self.battery.current_a.encode(writer);
        self.motor.rpm.encode(writer);
        self.motor.temperature_c.encode(writer);
        self.hydraulics.pressure_mpa.encode(writer);
        self.io.seat_switch.encode(writer);
        self.io.seatbelt.encode(writer);
        self.io.key_on.encode(writer);
        writer.put_bool(self.connectivity.can_online);
        writer.put_bool(self.connectivity.camera_online);
        self.vehicle.odometer_km.encode(writer);
        self.vehicle.work_hours.encode(writer);
        for online in self.vehicle.controller_online {
            writer.put_bool(online);
        }
    }

    pub fn decode(reader: &mut Reader<'_>) -> Result<Self, ProtocolError> {
        let timestamp_ms = reader.u64()?;
        let speed_kph = Signal::decode(reader)?;
        let direction = Signal::decode(reader)?;
        let parking_brake = Signal::decode(reader)?;
        let steer_angle_deg = Signal::decode(reader)?;
        let run_mode = Signal::decode(reader)?;
        let soc_percent = Signal::decode(reader)?;
        let voltage_v = Signal::decode(reader)?;
        let current_a = Signal::decode(reader)?;
        let rpm = Signal::decode(reader)?;
        let temperature_c = Signal::decode(reader)?;
        let pressure_mpa = Signal::decode(reader)?;
        let seat_switch = Signal::decode(reader)?;
        let seatbelt = Signal::decode(reader)?;
        let key_on = Signal::decode(reader)?;
        let can_online = reader.bool()?;
        let camera_online = reader.bool()?;
        let odometer_km = Signal::decode(reader)?;
        let work_hours = Signal::decode(reader)?;
        let traction = reader.bool()?;
        let pump = reader.bool()?;
        let steer = reader.bool()?;
        Ok(Self {
            timestamp_ms,
            motion: MotionState {
                speed_kph,
                direction,
                parking_brake,
                steer_angle_deg,
                run_mode,
            },
            battery: BatteryState {
                soc_percent,
                voltage_v,
                current_a,
            },
            motor: MotorState {
                rpm,
                temperature_c,
            },
            hydraulics: HydraulicState { pressure_mpa },
            io: IoState {
                seat_switch,
                seatbelt,
                key_on,
            },
            connectivity: ConnectivityState {
                can_online,
                camera_online,
            },
            vehicle: VehicleInfo {
                odometer_km,
                work_hours,
                controller_online: [traction, pump, steer],
            },
        })
    }
}
