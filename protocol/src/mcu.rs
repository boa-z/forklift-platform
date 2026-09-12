//! 模组（MCU）UART1 帧协议：参考工程 `CommonSerialConfig`/`CommonSerialParse`
//! 的移植（见 docs/mcu.md）。
//!
//! 线格式（全小端）：
//!
//! ```text
//! CMD(1) + MAIN(2) + SUB(1) + LEN(2) + DATA(N≤300) + XOR8(1)
//! ```
//!
//! XOR8 覆盖除尾字节外的全部字节；无 CRC、无头魔数，接收侧按长度字段做
//! 字节级重同步。`CMD` 取值：`0x40` 查询、`0x23` 设置/上报、`0x43` 查询
//! 应答、`0x60` 设置应答。

use thiserror::Error;

/// 单帧数据段上限（参考工程 `COMMON_SERIAL_CONFIG_MAX_DATA_LEN`）。
pub const MAX_DATA_LEN: usize = 300;
/// 帧头长度（CMD + MAIN + SUB + LEN）。
pub const FRAME_HEADER_LEN: usize = 6;
/// 最大帧长（含 XOR 尾字节）。
pub const FRAME_MAX_LEN: usize = FRAME_HEADER_LEN + MAX_DATA_LEN + 1;

pub const CMD_QUERY: u8 = 0x40;
pub const CMD_SET: u8 = 0x23;
pub const CMD_QUERY_RESP: u8 = 0x43;
pub const CMD_SET_RESP: u8 = 0x60;

#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum McuError {
    #[error("data of {length} bytes exceeds the {max}-byte frame limit")]
    DataTooLong { length: usize, max: usize },
    #[error("payload length mismatch: expected {expected}, found {found}")]
    LengthMismatch { expected: usize, found: usize },
    #[error("bad XOR checksum: declared 0x{declared:02x}, computed 0x{computed:02x}")]
    BadChecksum { declared: u8, computed: u8 },
    #[error("invalid enum value {value} for {field}")]
    InvalidEnum { field: &'static str, value: u32 },
}

/// 主索引 + 子索引。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct Index {
    pub main: u16,
    pub sub: u8,
}

impl Index {
    /// 构造索引常量。
    pub const fn new(main: u16, sub: u8) -> Self {
        Self { main, sub }
    }
}

/// 命令索引表（参考工程接收/发送表；本 crate 只登记已移植的项）。
pub mod index {
    use super::Index;

    /// RTC 时间（6B：YY MM DD hh mm ss）。
    pub const RTC: Index = Index::new(0x2002, 0x24);
    /// 设备唯一码（8B）。
    pub const UNIQUE_ID: Index = Index::new(0x5F01, 0x01);
    /// GPXO 输出（4B：两组 {state, flag}）。
    pub const GPXO: Index = Index::new(0x5F01, 0x02);
    /// 模组软件版本查询（1B）。
    pub const MODULE_VERSION: Index = Index::new(0x5F01, 0x04);
    /// 模组硬件状态（1B）。
    pub const MODULE_HARD: Index = Index::new(0x5F01, 0x01);
    /// 模组格式化（4B 魔术字）。
    pub const MODULE_INIT: Index = Index::new(0x5F10, 0x02);
    /// 刷卡上报（模组→仪表，35B）。
    pub const SWIPE_REPORT: Index = Index::new(0x5F15, 0x14);
    /// 刷卡上报应答（仪表→模组，1B）。
    pub const SWIPE_REPLY: Index = Index::new(0x5F15, 0x14);
    /// 开机方式上报（仪表→模组，5B）。
    pub const POWER_ON_REPORT: Index = Index::new(0x5F15, 0x15);
    /// 用户数量（1B）。
    pub const USER_NUM_REPORT: Index = Index::new(0x5F15, 0x16);
    /// 工作模式上报（2B：mode, progress）。
    pub const WORK_MODE_REPORT: Index = Index::new(0x5F15, 0x17);
    /// 模组升级上报（1B）。
    pub const MODULE_UPGRADE_REPORT: Index = Index::new(0x5F15, 0x18);
    /// 超级管理员密码下发（4B）。
    pub const SUPER_ADMIN_PASSWORD: Index = Index::new(0x5F15, 0x18);
    /// 实时数据 TLV 上报。
    pub const REALTIME_DATA: Index = Index::new(0x5F15, 0x1B);
    /// 防拆报警上报（1B）。
    pub const ANTI_DISMANTLE_REPORT: Index = Index::new(0x5F15, 0x1A);
    /// 管理员密码下发（4B）。
    pub const ADMIN_PASSWORD: Index = Index::new(0x5F15, 0x1C);
    /// 语音透传（旧栈；新栈未注册）。
    pub const VOICE_PASSTHROUGH: Index = Index::new(0x5F15, 0x19);
    /// 模组恢复默认（4B 魔术字）。
    pub const RES_DEFAULTS: Index = Index::new(0x2002, 0x14);
    /// 功能配置（4B 位域）。
    pub const MODULE_CONFIG: Index = Index::new(0x2002, 0x2E);
    /// 沉默期（4B：silent, rest）。
    pub const SILENT_TIME: Index = Index::new(0x2002, 0x30);
    /// 模组 CAN 波特率（1B）。
    pub const CAN_BAUDRATE: Index = Index::new(0x2002, 0x31);
    /// APP 管理员密码（4B）。
    pub const APP_PASSWORD: Index = Index::new(0x2002, 0x32);
    /// 防拆使能（1B）。
    pub const ANTI_DISMANTLE: Index = Index::new(0x2002, 0x33);
    /// 清零小时计（1B）。
    pub const RESET_HOUR: Index = Index::new(0x2002, 0x34);
    /// 握手方式（1B：0=ACM，1=inmotion6，2=inmotion7）。
    pub const HANDSHAKE: Index = Index::new(0x2002, 0x35);
    /// 设备重启（1B）。
    pub const DEVICE_RESTART: Index = Index::new(0x2002, 0x36);

    /// 模组恢复默认/格式化的魔术字（`0x646D358E`，线格式小端）。
    pub const MAGIC_RESET: [u8; 4] = [0x8E, 0x35, 0x6D, 0x64];
}

/// 一帧 MCU 报文。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Frame {
    pub cmd: u8,
    pub index: Index,
    pub data: Vec<u8>,
}

impl Frame {
    /// 构造一帧（数据超限返回错误）。
    pub fn new(cmd: u8, index: Index, data: Vec<u8>) -> Result<Self, McuError> {
        if data.len() > MAX_DATA_LEN {
            return Err(McuError::DataTooLong {
                length: data.len(),
                max: MAX_DATA_LEN,
            });
        }
        Ok(Self { cmd, index, data })
    }

    /// 序列化为线格式（含 XOR8 尾字节）。
    pub fn encode(&self) -> Vec<u8> {
        let mut bytes = Vec::with_capacity(FRAME_HEADER_LEN + self.data.len() + 1);
        bytes.push(self.cmd);
        bytes.extend_from_slice(&self.index.main.to_le_bytes());
        bytes.push(self.index.sub);
        bytes.extend_from_slice(&(self.data.len() as u16).to_le_bytes());
        bytes.extend_from_slice(&self.data);
        let checksum = xor8(&bytes);
        bytes.push(checksum);
        bytes
    }
}

/// 计算 XOR8 校验（参考工程 `CommonSerialConfig_CalcXor`）。
pub fn xor8(bytes: &[u8]) -> u8 {
    bytes.iter().fold(0u8, |acc, byte| acc ^ byte)
}

/// 尝试解析一段完整线格式字节；失败返回错误。
pub fn decode_frame(bytes: &[u8]) -> Result<Frame, McuError> {
    if bytes.len() < FRAME_HEADER_LEN + 1 {
        return Err(McuError::LengthMismatch {
            expected: FRAME_HEADER_LEN + 1,
            found: bytes.len(),
        });
    }
    let data_len = u16::from_le_bytes([bytes[4], bytes[5]]) as usize;
    let expected = FRAME_HEADER_LEN + data_len + 1;
    if bytes.len() != expected {
        return Err(McuError::LengthMismatch {
            expected,
            found: bytes.len(),
        });
    }
    let declared = bytes[expected - 1];
    let computed = xor8(&bytes[..expected - 1]);
    if declared != computed {
        return Err(McuError::BadChecksum { declared, computed });
    }
    Ok(Frame {
        cmd: bytes[0],
        index: Index::new(u16::from_le_bytes([bytes[1], bytes[2]]), bytes[3]),
        data: bytes[FRAME_HEADER_LEN..expected - 1].to_vec(),
    })
}

/// 流式解码器：累积字节并按参考工程策略重同步。
#[derive(Debug, Default)]
pub struct FrameDecoder {
    buffer: Vec<u8>,
}

impl FrameDecoder {
    /// 追加一块数据，返回其中能解析出的完整帧。
    pub fn push(&mut self, chunk: &[u8]) -> Vec<Frame> {
        self.buffer.extend_from_slice(chunk);
        let mut frames = Vec::new();
        loop {
            if self.buffer.len() < FRAME_HEADER_LEN + 1 {
                break;
            }
            let data_len = u16::from_le_bytes([self.buffer[4], self.buffer[5]]) as usize;
            if data_len > MAX_DATA_LEN {
                self.buffer.remove(0);
                continue;
            }
            let frame_len = FRAME_HEADER_LEN + data_len + 1;
            if self.buffer.len() < frame_len {
                break;
            }
            match decode_frame(&self.buffer[..frame_len]) {
                Ok(frame) => {
                    self.buffer.drain(..frame_len);
                    frames.push(frame);
                }
                Err(_) => {
                    // 长度字段可能有 ±2 偏差：在邻域扫描 XOR 位置后再试。
                    let mut consumed = 0;
                    for candidate in frame_len.saturating_sub(2)..=frame_len + 2 {
                        if candidate > self.buffer.len() {
                            break;
                        }
                        if decode_frame(&self.buffer[..candidate]).is_ok() {
                            consumed = candidate;
                            break;
                        }
                    }
                    if consumed > 0 {
                        if let Ok(frame) = decode_frame(&self.buffer[..consumed]) {
                            self.buffer.drain(..consumed);
                            frames.push(frame);
                            continue;
                        }
                    }
                    self.buffer.remove(0);
                }
            }
        }
        frames
    }
}

/// 刷卡处理状态（参考工程 `CommonSerialParse.h` 枚举）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SwipeStatus {
    Failed,
    Authorized,
    Duplicate,
    OtherCard,
    PowerOff,
    SilentPeriod,
}

impl SwipeStatus {
    /// 由线格式值还原状态，未知值报错。
    pub fn from_u8(value: u8) -> Result<Self, McuError> {
        match value {
            0 => Ok(Self::Failed),
            1 => Ok(Self::Authorized),
            2 => Ok(Self::Duplicate),
            3 => Ok(Self::OtherCard),
            4 => Ok(Self::PowerOff),
            5 => Ok(Self::SilentPeriod),
            other => Err(McuError::InvalidEnum {
                field: "swipe status",
                value: other as u32,
            }),
        }
    }
}

/// 刷卡上报（模组→仪表，线上 35B；`config` 来自功能配置上报）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SwipeReport {
    pub status: u8,
    pub index: u8,
    pub name: [u8; 8],
    pub card: [u8; 4],
    pub id: [u8; 9],
    pub phone: [u8; 6],
    pub driver_license: [u8; 3],
    pub ic_license: [u8; 3],
}

/// 刷卡上报线格式长度。
pub const SWIPE_REPORT_LEN: usize = 35;

impl SwipeReport {
    /// 解码 35B 上报载荷。
    pub fn decode(data: &[u8]) -> Result<Self, McuError> {
        if data.len() != SWIPE_REPORT_LEN {
            return Err(McuError::LengthMismatch {
                expected: SWIPE_REPORT_LEN,
                found: data.len(),
            });
        }
        let mut name = [0u8; 8];
        let mut card = [0u8; 4];
        let mut id = [0u8; 9];
        let mut phone = [0u8; 6];
        let mut driver_license = [0u8; 3];
        let mut ic_license = [0u8; 3];
        name.copy_from_slice(&data[2..10]);
        card.copy_from_slice(&data[10..14]);
        id.copy_from_slice(&data[14..23]);
        phone.copy_from_slice(&data[23..29]);
        driver_license.copy_from_slice(&data[29..32]);
        ic_license.copy_from_slice(&data[32..35]);
        Ok(Self {
            status: data[0],
            index: data[1],
            name,
            card,
            id,
            phone,
            driver_license,
            ic_license,
        })
    }

    /// 编码为 35B 上报载荷。
    pub fn encode(&self) -> Vec<u8> {
        let mut data = Vec::with_capacity(SWIPE_REPORT_LEN);
        data.push(self.status);
        data.push(self.index);
        data.extend_from_slice(&self.name);
        data.extend_from_slice(&self.card);
        data.extend_from_slice(&self.id);
        data.extend_from_slice(&self.phone);
        data.extend_from_slice(&self.driver_license);
        data.extend_from_slice(&self.ic_license);
        data
    }

    /// 蓝牙刷卡固定卡号 `DD CC BB AA`。
    pub const BLUETOOTH_CARD: [u8; 4] = [0xDD, 0xCC, 0xBB, 0xAA];

    /// 是否为蓝牙开机卡。
    pub fn is_bluetooth(&self) -> bool {
        self.card == Self::BLUETOOTH_CARD
    }

    /// 双重认证期望的身份证后 4/6 位数字（9 字节 BCD = 18 位号码；
    /// nibble 值 `0x0A` 表示参考工程里的 `x/X`）。
    pub fn license_tail_digits(&self, long_form: bool) -> Vec<u8> {
        let digits = if long_form { 6 } else { 4 };
        let mut out = Vec::with_capacity(digits);
        for position in (18 - digits)..18 {
            let byte = self.id[position / 2];
            let nibble = if position % 2 == 0 {
                byte >> 4
            } else {
                byte & 0x0F
            };
            out.push(nibble);
        }
        out
    }
}

/// 开机方式（参考工程枚举）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PowerOnType {
    Password,
    Card,
    Bluetooth,
}

impl PowerOnType {
    /// 线格式值。
    pub fn to_u8(self) -> u8 {
        match self {
            Self::Password => 0,
            Self::Card => 1,
            Self::Bluetooth => 4,
        }
    }
}

/// 构造开机方式上报（5B：type + card[4]；密码开机卡号全 0xFF）。
pub fn power_on_report(kind: PowerOnType, card: [u8; 4]) -> Vec<u8> {
    let card = match kind {
        PowerOnType::Password => [0xFF; 4],
        _ => card,
    };
    let mut data = Vec::with_capacity(5);
    data.push(kind.to_u8());
    data.extend_from_slice(&card);
    data
}

/// 功能配置位域（4B）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct ModuleConfig {
    pub auth_type: u8,
    pub dual_auth: bool,
    pub swipe_off: bool,
    pub drive_license: bool,
    pub ic_license: bool,
}

impl ModuleConfig {
    /// 由小端 4B 解码。
    pub fn decode(data: &[u8]) -> Result<Self, McuError> {
        if data.len() != 4 {
            return Err(McuError::LengthMismatch {
                expected: 4,
                found: data.len(),
            });
        }
        let raw = u32::from_le_bytes([data[0], data[1], data[2], data[3]]);
        Ok(Self {
            auth_type: (raw & 0x7F) as u8,
            dual_auth: raw & (1 << 7) != 0,
            swipe_off: raw & (1 << 8) != 0,
            drive_license: raw & (1 << 9) != 0,
            ic_license: raw & (1 << 10) != 0,
        })
    }

    /// 编码为小端 4B。
    pub fn encode(&self) -> [u8; 4] {
        let mut raw = (self.auth_type as u32) & 0x7F;
        raw |= (self.dual_auth as u32) << 7;
        raw |= (self.swipe_off as u32) << 8;
        raw |= (self.drive_license as u32) << 9;
        raw |= (self.ic_license as u32) << 10;
        raw.to_le_bytes()
    }
}

/// 沉默期（4B：silent, rest，单位由模组定义）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct SilentTime {
    pub silent: u16,
    pub rest: u16,
}

impl SilentTime {
    /// 由小端 4B 解码。
    pub fn decode(data: &[u8]) -> Result<Self, McuError> {
        if data.len() != 4 {
            return Err(McuError::LengthMismatch {
                expected: 4,
                found: data.len(),
            });
        }
        Ok(Self {
            silent: u16::from_le_bytes([data[0], data[1]]),
            rest: u16::from_le_bytes([data[2], data[3]]),
        })
    }

    /// 编码为小端 4B。
    pub fn encode(&self) -> [u8; 4] {
        let mut data = [0u8; 4];
        data[..2].copy_from_slice(&self.silent.to_le_bytes());
        data[2..].copy_from_slice(&self.rest.to_le_bytes());
        data
    }
}

/// RTC 时间（6B：YY MM DD hh mm ss）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct RtcTime {
    pub year: u8,
    pub month: u8,
    pub day: u8,
    pub hour: u8,
    pub minute: u8,
    pub second: u8,
}

impl RtcTime {
    /// 由 6B 解码。
    pub fn decode(data: &[u8]) -> Result<Self, McuError> {
        if data.len() != 6 {
            return Err(McuError::LengthMismatch {
                expected: 6,
                found: data.len(),
            });
        }
        Ok(Self {
            year: data[0],
            month: data[1],
            day: data[2],
            hour: data[3],
            minute: data[4],
            second: data[5],
        })
    }

    /// 编码为 6B。
    pub fn encode(&self) -> [u8; 6] {
        [
            self.year,
            self.month,
            self.day,
            self.hour,
            self.minute,
            self.second,
        ]
    }
}

/// 实时数据 TLV 条目（参考工程 `23 5F15:1B`）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RealtimeItem {
    /// 超声波探头：flag + 距离值（≤500 或 0xFFFF 视为有障碍，0xFFFE 探头故障）。
    Ultrasonic { index: u8, flag: u8, value: u16 },
    /// GPAI 电压：index + 值。
    Voltage { index: u8, value: u16 },
    /// GPDI 数字量：index + 值。
    Gpdi { index: u8, value: u8 },
    /// 频率：index + 值（u32）。
    Frequency { index: u8, value: u32 },
}

/// 解析实时数据 TLV 载荷（type, count, 条目… 循环）。
pub fn parse_realtime(data: &[u8]) -> Result<Vec<RealtimeItem>, McuError> {
    let mut items = Vec::new();
    let mut cursor = 0usize;
    while cursor + 2 <= data.len() {
        let kind = data[cursor];
        let count = data[cursor + 1] as usize;
        cursor += 2;
        for entry in 0..count {
            match kind {
                1 => {
                    if cursor + 3 > data.len() {
                        return Err(McuError::LengthMismatch {
                            expected: cursor + 3,
                            found: data.len(),
                        });
                    }
                    items.push(RealtimeItem::Ultrasonic {
                        index: entry as u8,
                        flag: data[cursor],
                        value: u16::from_le_bytes([data[cursor + 1], data[cursor + 2]]),
                    });
                    cursor += 3;
                }
                2 => {
                    if cursor + 3 > data.len() {
                        return Err(McuError::LengthMismatch {
                            expected: cursor + 3,
                            found: data.len(),
                        });
                    }
                    items.push(RealtimeItem::Voltage {
                        index: data[cursor],
                        value: u16::from_le_bytes([data[cursor + 1], data[cursor + 2]]),
                    });
                    cursor += 3;
                }
                3 => {
                    if cursor + 2 > data.len() {
                        return Err(McuError::LengthMismatch {
                            expected: cursor + 2,
                            found: data.len(),
                        });
                    }
                    items.push(RealtimeItem::Gpdi {
                        index: data[cursor],
                        value: data[cursor + 1],
                    });
                    cursor += 2;
                }
                4 => {
                    if cursor + 5 > data.len() {
                        return Err(McuError::LengthMismatch {
                            expected: cursor + 5,
                            found: data.len(),
                        });
                    }
                    items.push(RealtimeItem::Frequency {
                        index: data[cursor],
                        value: u32::from_le_bytes([
                            data[cursor + 1],
                            data[cursor + 2],
                            data[cursor + 3],
                            data[cursor + 4],
                        ]),
                    });
                    cursor += 5;
                }
                other => {
                    return Err(McuError::InvalidEnum {
                        field: "realtime type",
                        value: other as u32,
                    });
                }
            }
        }
    }
    Ok(items)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn restart_frame_matches_reference_bytes() {
        // 参考工程 app_set_menu.c 语言切换后直发的重启帧：
        // `23 2002:36 01 00 01 37`。
        let frame = Frame::new(CMD_SET, index::DEVICE_RESTART, vec![0x01]).unwrap();
        assert_eq!(frame.encode(), vec![0x23, 0x02, 0x20, 0x36, 0x01, 0x00, 0x01, 0x37]);
    }

    #[test]
    fn power_on_report_uses_ff_card_for_password() {
        let data = power_on_report(PowerOnType::Password, [1, 2, 3, 4]);
        assert_eq!(data, vec![0x00, 0xFF, 0xFF, 0xFF, 0xFF]);
        let data = power_on_report(PowerOnType::Card, [1, 2, 3, 4]);
        assert_eq!(data, vec![0x01, 1, 2, 3, 4]);
    }

    #[test]
    fn decoder_resynchronizes_after_garbage() {
        let mut decoder = FrameDecoder::default();
        let frame = Frame::new(CMD_QUERY_RESP, index::RTC, vec![1, 2, 3, 4, 5, 6])
            .unwrap()
            .encode();
        let mut stream = vec![0xAA, 0xBB, 0xCC];
        stream.extend_from_slice(&frame);
        let frames = decoder.push(&stream);
        assert_eq!(frames.len(), 1);
        assert_eq!(frames[0].index, index::RTC);
        assert_eq!(frames[0].data, vec![1, 2, 3, 4, 5, 6]);
    }

    #[test]
    fn decoder_handles_split_chunks() {
        let mut decoder = FrameDecoder::default();
        let frame = Frame::new(CMD_SET, index::SWIPE_REPLY, vec![0x00])
            .unwrap()
            .encode();
        assert!(decoder.push(&frame[..3]).is_empty());
        let frames = decoder.push(&frame[3..]);
        assert_eq!(frames.len(), 1);
        assert_eq!(frames[0].index, index::SWIPE_REPLY);
    }

    #[test]
    fn swipe_report_round_trips() {
        let report = SwipeReport {
            status: 1,
            index: 7,
            name: *b"ZHANG SA",
            card: [0x11, 0x22, 0x33, 0x44],
            id: [0x12, 0x34, 0x56, 0x78, 0x90, 0x12, 0x34, 0x56, 0x78],
            phone: [0; 6],
            driver_license: [0; 3],
            ic_license: [0; 3],
        };
        let decoded = SwipeReport::decode(&report.encode()).unwrap();
        assert_eq!(decoded, report);
        assert!(!decoded.is_bluetooth());
    }

    #[test]
    fn bluetooth_card_and_license_tail() {
        let report = SwipeReport {
            status: 1,
            index: 0,
            name: [0; 8],
            card: SwipeReport::BLUETOOTH_CARD,
            id: [0x12, 0x34, 0x56, 0x78, 0x90, 0x12, 0x34, 0x56, 0x78],
            phone: [0; 6],
            driver_license: [0; 3],
            ic_license: [0; 3],
        };
        assert!(report.is_bluetooth());
        // 9 字节 BCD 共 18 位：末 4 位为第 15-18 位（nibble 5,6,7,8）。
        assert_eq!(report.license_tail_digits(false), vec![5, 6, 7, 8]);
        assert_eq!(report.license_tail_digits(true), vec![3, 4, 5, 6, 7, 8]);
    }

    #[test]
    fn config_bitfield_round_trips() {
        let config = ModuleConfig {
            auth_type: 65,
            dual_auth: true,
            swipe_off: false,
            drive_license: true,
            ic_license: false,
        };
        assert_eq!(ModuleConfig::decode(&config.encode()).unwrap(), config);
    }

    #[test]
    fn realtime_tlv_decodes_each_kind() {
        let payload = vec![
            1, 1, 9, 0x2C, 0x01, // 超声波：第 0 探头，flag=9，value=300
            2, 1, 2, 0xC8, 0x00, // 电压：index 2，value=200
            3, 1, 1, 5, // GPDI：index 1，value 5
            4, 1, 1, 0x40, 0x42, 0x0F, 0x00, // 频率：index 1，value=1000000
        ];
        let items = parse_realtime(&payload).unwrap();
        assert_eq!(items.len(), 4);
        assert_eq!(
            items[0],
            RealtimeItem::Ultrasonic {
                index: 0,
                flag: 9,
                value: 300
            }
        );
        assert_eq!(items[1], RealtimeItem::Voltage { index: 2, value: 200 });
        assert_eq!(items[2], RealtimeItem::Gpdi { index: 1, value: 5 });
        assert_eq!(
            items[3],
            RealtimeItem::Frequency {
                index: 1,
                value: 1_000_000
            }
        );
    }

    #[test]
    fn silent_time_and_rtc_round_trip() {
        let silent = SilentTime {
            silent: 300,
            rest: 30,
        };
        assert_eq!(SilentTime::decode(&silent.encode()).unwrap(), silent);
        let rtc = RtcTime {
            year: 26,
            month: 9,
            day: 13,
            hour: 8,
            minute: 30,
            second: 5,
        };
        assert_eq!(RtcTime::decode(&rtc.encode()).unwrap(), rtc);
    }
}
