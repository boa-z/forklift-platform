// Versioned IPC 协议的 TypeScript 编解码，与 Rust `protocol` crate 保持同一
// 线格式。测试用 `tests/golden/protocol.json`（Rust 生成）交叉校验，禁止两边
// 各自手写协议常量。

/** 支持的协议版本。 */
export const PROTOCOL_VERSION = 5;
/** 'F''L''K''T' 小端。 */
export const PROTOCOL_MAGIC = 0x544b4c46;
/** 帧头长度。 */
export const HEADER_SIZE = 16;
/** 单帧载荷上限。 */
export const MAX_PAYLOAD = 64 * 1024;

/** 信号质量。 */
export type SignalQuality = "valid" | "stale" | "invalid" | "unavailable";

/** 带时间戳与质量标记的车辆信号。 */
export interface Signal<T> {
  value: T;
  timestampMs: number;
  quality: SignalQuality;
}

/** 行驶方向。 */
export type Direction = "neutral" | "forward" | "reverse";
/** 参考仪表的运行模式。 */
export type RunMode = "none" | "s" | "e" | "p";
/** 故障严重度。 */
export type FaultSeverity = "info" | "warning" | "critical";
/** 子系统健康状态。 */
export type HealthState = "healthy" | "degraded" | "failed" | "unknown";
/** 可播放音效。 */
export type SoundId =
  | "button"
  | "warning"
  | "reverse"
  | "fault"
  | "startup"
  | "cardSwipe"
  | "cardOk"
  | "cardFail"
  | "overspeed"
  | "overspeedHigh"
  | "overspeedCritical"
  | "seatbelt"
  | "seatOff"
  | "obstacleFar"
  | "obstacleNear"
  | "obstacleBrake"
  | "collision";

/** 车辆状态（UI 只读快照）。 */
export interface VehicleState {
  timestampMs: number;
  speedKph: Signal<number>;
  direction: Signal<Direction>;
  parkingBrake: Signal<boolean>;
  steerAngleDeg: Signal<number>;
  runMode: Signal<RunMode>;
  socPercent: Signal<number>;
  voltageV: Signal<number>;
  currentA: Signal<number>;
  /** 充电条件满足（daemon 判定）。 */
  charging: Signal<boolean>;
  motorRpm: Signal<number>;
  motorTemperatureC: Signal<number>;
  pressureMpa: Signal<number>;
  seatSwitch: Signal<boolean>;
  seatbelt: Signal<boolean>;
  keyOn: Signal<boolean>;
  /** 防拆卸模块上报的拆除标志。 */
  antiDismantle: Signal<boolean>;
  canOnline: boolean;
  cameraOnline: boolean;
  odometerKm: Signal<number>;
  workHours: Signal<number>;
  controllerOnline: [boolean, boolean, boolean];
}

/** 单条故障记录。 */
export interface Fault {
  id: number;
  severity: FaultSeverity;
  active: boolean;
  firstSeenMs: number;
  lastSeenMs: number;
  occurrenceCount: number;
}

/** 故障快照。 */
export interface FaultSnapshot {
  timestampMs: number;
  faults: Fault[];
}

/** 连接性变化事件。 */
export interface ConnectivityEvent {
  timestampMs: number;
  canOnline: boolean;
  cameraOnline: boolean;
}

/** 系统健康与内存遥测。 */
export interface SystemState {
  timestampMs: number;
  uptimeMs: number;
  health: HealthState[];
  rssKb: number;
  memAvailableKb: number;
}

/** 刷卡上报（packed 37B，字段已解码为 UI 友好的字符串）。 */
export interface SwipeReportMessage {
  /** 模组状态（u16）：0 失败/1 授权成功/2 重复/3 其它卡/4 关机/5 沉默期。 */
  status: number;
  index: number;
  /** ASCII 姓名（去空）。 */
  name: string;
  /** 8 位十六进制卡号。 */
  card: string;
  /** 18 位身份证号（BCD 解出）。 */
  id: string;
  /** 手机号（十六进制）。 */
  phone: string;
  /** 驾照/IC 证（十六进制）。 */
  driverLicense: string;
  icLicense: string;
  /** 本地状态位（bit0 = 双重认证）。 */
  config: number;
}

/** 授权状态：权限级别与是否已授权。 */
export interface AuthState {
  level: number;
  /** 开机授权是否通过（刷卡/蓝牙/沉默期）。 */
  authorized: boolean;
}

/** 防拆状态。 */
export interface AntiDismantleState {
  enabled: boolean;
  alarm: boolean;
}

/** 模组 RTC 时间（年取后两位）。 */
export interface RtcTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** 服务端可以发送的消息。 */
export type ServerMessage =
  | { type: "serverVersion"; version: number }
  | { type: "vehicleState"; state: VehicleState }
  | { type: "faults"; snapshot: FaultSnapshot }
  | { type: "system"; state: SystemState }
  | { type: "faultRaised"; fault: Fault }
  | { type: "faultCleared"; fault: Fault }
  | { type: "connectivity"; event: ConnectivityEvent }
  | { type: "swipeReport"; report: SwipeReportMessage }
  | { type: "authState"; state: AuthState }
  | { type: "antiDismantle"; state: AntiDismantleState }
  | { type: "rtc"; rtc: RtcTime }
  | { type: "pong"; nonce: number }
  | { type: "ok" }
  | { type: "authLevel"; level: number }
  | { type: "settings"; flags: number }
  | { type: "error"; code: number; message: string };

/** UI 可以发送的消息。 */
export type ClientMessage =
  | { type: "hello"; clientVersion: number }
  | { type: "ping"; nonce: number }
  | { type: "playSound"; sound: SoundId }
  | { type: "setVolume"; volume: number }
  | { type: "setBrightness"; brightness: number }
  | { type: "reportPowerOn"; kind: number; card: string }
  | { type: "swipeReply"; status: number }
  | { type: "verifyPassword"; password: string }
  | { type: "setAdminPassword"; oldPassword: string; newPassword: string }
  | { type: "enterLicenseTail"; digits: string }
  | { type: "setAntiDismantle"; enabled: boolean }
  | { type: "getSettings" }
  | { type: "setSettings"; flags: number };

/** 帧头解析结果。 */
export interface FrameHeader {
  magic: number;
  version: number;
  messageType: number;
  payloadLength: number;
  sequence: number;
}

const MESSAGE_TYPES = {
  hello: 0x0001,
  clientVersion: 0x0002,
  serverVersion: 0x0003,
  stateVehicle: 0x0100,
  stateFaults: 0x0101,
  stateSystem: 0x0102,
  eventFaultRaised: 0x0200,
  eventFaultCleared: 0x0201,
  eventConnectivity: 0x0202,
  eventSwipeReport: 0x0203,
  eventAuthState: 0x0204,
  eventAntiDismantle: 0x0205,
  eventRtc: 0x0206,
  cmdPlaySound: 0x0300,
  cmdSetVolume: 0x0301,
  cmdSetBrightness: 0x0302,
  cmdPing: 0x0303,
  cmdReportPowerOn: 0x0304,
  cmdSwipeReply: 0x0305,
  cmdVerifyPassword: 0x0306,
  cmdSetAdminPassword: 0x0307,
  cmdEnterLicenseTail: 0x0308,
  cmdSetAntiDismantle: 0x0309,
  cmdGetSettings: 0x030a,
  cmdSetSettings: 0x030b,
  respOk: 0x0400,
  respError: 0x0401,
  respPong: 0x0402,
  respAuthLevel: 0x0403,
  respSettings: 0x0404,
} as const;

const SOUND_IDS: Record<SoundId, number> = {
  button: 0,
  warning: 1,
  reverse: 2,
  fault: 3,
  startup: 4,
  cardSwipe: 5,
  cardOk: 6,
  cardFail: 7,
  overspeed: 8,
  overspeedHigh: 9,
  overspeedCritical: 10,
  seatbelt: 11,
  seatOff: 12,
  obstacleFar: 13,
  obstacleNear: 14,
  obstacleBrake: 15,
  collision: 16,
};

const DIRECTION_VALUES: Direction[] = ["neutral", "forward", "reverse"];
const RUN_MODE_VALUES: RunMode[] = ["none", "s", "e", "p"];
const QUALITY_VALUES: SignalQuality[] = ["valid", "stale", "invalid", "unavailable"];
const FAULT_SEVERITIES: FaultSeverity[] = ["info", "warning", "critical"];
const HEALTH_VALUES: HealthState[] = ["healthy", "degraded", "failed", "unknown"];

/** 小端载荷写入器。 */
class Writer {
  private readonly bytes: number[] = [];

  /** 写入 u8。 */
  u8(value: number): void {
    this.bytes.push(value & 0xff);
  }

  /** 写入 u16。 */
  u16(value: number): void {
    this.bytes.push(value & 0xff, (value >>> 8) & 0xff);
  }

  /** 写入 u32。 */
  u32(value: number): void {
    this.bytes.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
  }

  /** 写入原始字节。 */
  raw(value: Uint8Array): void {
    for (const byte of value) this.bytes.push(byte);
  }

  /** 写入 u16 长度前缀的 ASCII 字符串（本协议只传密码/身份证尾号）。 */
  string(value: string): void {
    this.u16(value.length);
    for (let index = 0; index < value.length; index += 1) {
      this.bytes.push(value.charCodeAt(index) & 0xff);
    }
  }

  /** 取出字节。 */
  finish(): Uint8Array {
    return Uint8Array.from(this.bytes);
  }
}

/** 小端载荷读取器。 */
class Reader {
  private offset = 0;

  constructor(private readonly view: DataView) {}

  /** 剩余字节数。 */
  remaining(): number {
    return this.view.byteLength - this.offset;
  }

  /** 读取 u8。 */
  u8(): number {
    const value = this.view.getUint8(this.offset);
    this.offset += 1;
    return value;
  }

  /** 读取 u16。 */
  u16(): number {
    const value = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return value;
  }

  /** 读取 u32。 */
  u32(): number {
    const value = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return value;
  }

  /** 读取 u64（协议内数值均小于 2^53）。 */
  u64(): number {
    const value = this.view.getBigUint64(this.offset, true);
    this.offset += 8;
    return Number(value);
  }

  /** 读取 i32。 */
  i32(): number {
    const value = this.view.getInt32(this.offset, true);
    this.offset += 4;
    return value;
  }

  /** 读取 f32。 */
  f32(): number {
    const value = this.view.getFloat32(this.offset, true);
    this.offset += 4;
    return value;
  }

  /** 读取 bool（1 字节）。 */
  bool(): boolean {
    return this.u8() !== 0;
  }

  /** 读取 n 字节（复制，避免后续读取影响）。 */
  rawBytes(length: number): Uint8Array {
    const start = this.view.byteOffset + this.offset;
    const out = new Uint8Array(this.view.buffer.slice(start, start + length));
    this.offset += length;
    return out;
  }

  /** 读取 u16 长度前缀的 ASCII 字符串。 */
  string(): string {
    const length = this.u16();
    const raw = this.rawBytes(length);
    return asciiString(raw);
  }
}

/** 字节数组转 ASCII（遇到 0 停止）。 */
function asciiString(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) {
    if (byte === 0) break;
    out += String.fromCharCode(byte);
  }
  return out;
}

/** 字节数组转十六进制。 */
function hexString(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** BCD 字节数组转数字串（nibble 0x0A 记为 x）。 */
function bcdString(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) {
    for (const nibble of [byte >> 4, byte & 0x0f]) {
      out += nibble === 0x0a ? "x" : nibble.toString(10);
    }
  }
  return out;
}

/** 十六进制字符串转 4 字节卡号（非法输入按 0）。 */
function hexToBytes(text: string): Uint8Array {
  const out = new Uint8Array(4);
  for (let index = 0; index < 4; index += 1) {
    const pair = text.slice(index * 2, index * 2 + 2);
    const value = Number.parseInt(pair, 16);
    out[index] = Number.isNaN(value) ? 0 : value;
  }
  return out;
}

/** 解码 37 字节刷卡上报（与参考 C 结构一致：u16 状态 + … + config）。 */
function decodeSwipeReport(reader: Reader): SwipeReportMessage {
  const status = reader.u16();
  const index = reader.u8();
  const name = asciiString(reader.rawBytes(8));
  const card = hexString(reader.rawBytes(4));
  const id = bcdString(reader.rawBytes(9));
  const phone = hexString(reader.rawBytes(6));
  const driverLicense = hexString(reader.rawBytes(3));
  const icLicense = hexString(reader.rawBytes(3));
  const config = reader.u8();
  return { status, index, name, card, id, phone, driverLicense, icLicense, config };
}

/**
 * 字节流分帧：累积数据并按帧头长度切出完整帧。
 * 纯逻辑，供 macOS 的 UnixTransport 与设备的 IpcTransport 共用。
 */
export class FrameDecoder {
  private buffer = new Uint8Array(0);

  /** 追加一块数据，返回其中完整的帧。 */
  push(chunk: Uint8Array): Uint8Array[] {
    const merged = new Uint8Array(this.buffer.byteLength + chunk.byteLength);
    merged.set(this.buffer, 0);
    merged.set(chunk, this.buffer.byteLength);
    this.buffer = merged;

    const frames: Uint8Array[] = [];
    for (;;) {
      if (this.buffer.byteLength < HEADER_SIZE) break;
      const view = new DataView(this.buffer.buffer, this.buffer.byteOffset, HEADER_SIZE);
      const payloadLength = view.getUint32(8, true);
      if (payloadLength > MAX_PAYLOAD) {
        throw new Error(`帧载荷超限：${payloadLength}`);
      }
      const frameLength = HEADER_SIZE + payloadLength;
      if (this.buffer.byteLength < frameLength) break;
      frames.push(this.buffer.slice(0, frameLength));
      this.buffer = this.buffer.slice(frameLength);
    }
    return frames;
  }
}

/** 解析 16 字节帧头并做基础校验。 */
export function parseHeader(bytes: Uint8Array): FrameHeader {
  if (bytes.byteLength < HEADER_SIZE) {
    throw new Error(`帧不足 ${HEADER_SIZE} 字节：${bytes.byteLength}`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const header: FrameHeader = {
    magic: view.getUint32(0, true),
    version: view.getUint16(4, true),
    messageType: view.getUint16(6, true),
    payloadLength: view.getUint32(8, true),
    sequence: view.getUint32(12, true),
  };
  if (header.magic !== PROTOCOL_MAGIC) {
    throw new Error(`magic 非法：0x${header.magic.toString(16)}`);
  }
  if (header.version !== PROTOCOL_VERSION) {
    throw new Error(`协议版本不支持：${header.version}`);
  }
  if (header.payloadLength > MAX_PAYLOAD) {
    throw new Error(`载荷超限：${header.payloadLength}`);
  }
  if (bytes.byteLength !== HEADER_SIZE + header.payloadLength) {
    throw new Error(`长度不一致：头 ${header.payloadLength}，实到 ${bytes.byteLength - HEADER_SIZE}`);
  }
  return header;
}

/** 解码一条完整的服务端帧。 */
export function decodeFrame(bytes: Uint8Array): { header: FrameHeader; message: ServerMessage } {
  const header = parseHeader(bytes);
  const view = new DataView(bytes.buffer, bytes.byteOffset + HEADER_SIZE, header.payloadLength);
  const reader = new Reader(view);
  let message: ServerMessage;
  switch (header.messageType) {
    case MESSAGE_TYPES.serverVersion:
      message = { type: "serverVersion", version: reader.u16() };
      break;
    case MESSAGE_TYPES.stateVehicle:
      message = { type: "vehicleState", state: decodeVehicleState(reader) };
      break;
    case MESSAGE_TYPES.stateFaults:
      message = { type: "faults", snapshot: decodeFaultSnapshot(reader) };
      break;
    case MESSAGE_TYPES.stateSystem:
      message = { type: "system", state: decodeSystemState(reader) };
      break;
    case MESSAGE_TYPES.eventFaultRaised:
      message = { type: "faultRaised", fault: decodeFault(reader) };
      break;
    case MESSAGE_TYPES.eventFaultCleared:
      message = { type: "faultCleared", fault: decodeFault(reader) };
      break;
    case MESSAGE_TYPES.eventConnectivity:
      message = {
        type: "connectivity",
        event: {
          timestampMs: reader.u64(),
          canOnline: reader.bool(),
          cameraOnline: reader.bool(),
        },
      };
      break;
    case MESSAGE_TYPES.eventSwipeReport:
      message = { type: "swipeReport", report: decodeSwipeReport(reader) };
      break;
    case MESSAGE_TYPES.eventAuthState:
      message = {
        type: "authState",
        state: { level: reader.u8(), authorized: reader.bool() },
      };
      break;
    case MESSAGE_TYPES.eventAntiDismantle:
      message = {
        type: "antiDismantle",
        state: { enabled: reader.bool(), alarm: reader.bool() },
      };
      break;
    case MESSAGE_TYPES.eventRtc:
      message = {
        type: "rtc",
        rtc: {
          year: reader.u8(),
          month: reader.u8(),
          day: reader.u8(),
          hour: reader.u8(),
          minute: reader.u8(),
          second: reader.u8(),
        },
      };
      break;
    case MESSAGE_TYPES.respOk:
      message = { type: "ok" };
      break;
    case MESSAGE_TYPES.respError:
      message = { type: "error", code: reader.u16(), message: decodeString(reader) };
      break;
    case MESSAGE_TYPES.respPong:
      message = { type: "pong", nonce: reader.u32() };
      break;
    case MESSAGE_TYPES.respAuthLevel:
      message = { type: "authLevel", level: reader.u8() };
      break;
    case MESSAGE_TYPES.respSettings:
      message = { type: "settings", flags: reader.u8() };
      break;
    default:
      throw new Error(`未知消息类型：0x${header.messageType.toString(16)}`);
  }
  if (reader.remaining() !== 0) {
    throw new Error(`载荷存在多余字节：${reader.remaining()}`);
  }
  return { header, message };
}

/** 解码 f32 信号。 */
function decodeF32Signal(reader: Reader): Signal<number> {
  const value = reader.f32();
  return { value, timestampMs: reader.u64(), quality: decodeQuality(reader.u8()) };
}

/** 解码 bool 信号。 */
function decodeBoolSignal(reader: Reader): Signal<boolean> {
  const value = reader.bool();
  return { value, timestampMs: reader.u64(), quality: decodeQuality(reader.u8()) };
}

/** 解码方向信号。 */
function decodeDirectionSignal(reader: Reader): Signal<Direction> {
  const value = DIRECTION_VALUES[reader.u8()];
  if (value === undefined) throw new Error("方向枚举越界");
  return { value, timestampMs: reader.u64(), quality: decodeQuality(reader.u8()) };
}

/** 解码运行模式信号。 */
function decodeRunModeSignal(reader: Reader): Signal<RunMode> {
  const value = RUN_MODE_VALUES[reader.u8()];
  if (value === undefined) throw new Error("运行模式枚举越界");
  return { value, timestampMs: reader.u64(), quality: decodeQuality(reader.u8()) };
}

/** 解码信号质量。 */
function decodeQuality(value: number): SignalQuality {
  const quality = QUALITY_VALUES[value];
  if (quality === undefined) throw new Error(`信号质量越界：${value}`);
  return quality;
}

/** 解码车辆状态（字段顺序与 Rust 完全一致）。 */
function decodeVehicleState(reader: Reader): VehicleState {
  return {
    timestampMs: reader.u64(),
    speedKph: decodeF32Signal(reader),
    direction: decodeDirectionSignal(reader),
    parkingBrake: decodeBoolSignal(reader),
    steerAngleDeg: decodeF32Signal(reader),
    runMode: decodeRunModeSignal(reader),
    socPercent: decodeF32Signal(reader),
    voltageV: decodeF32Signal(reader),
    currentA: decodeF32Signal(reader),
    charging: decodeBoolSignal(reader),
    motorRpm: decodeF32Signal(reader),
    motorTemperatureC: decodeF32Signal(reader),
    pressureMpa: decodeF32Signal(reader),
    seatSwitch: decodeBoolSignal(reader),
    seatbelt: decodeBoolSignal(reader),
    keyOn: decodeBoolSignal(reader),
    antiDismantle: decodeBoolSignal(reader),
    canOnline: reader.bool(),
    cameraOnline: reader.bool(),
    odometerKm: decodeF32Signal(reader),
    workHours: decodeF32Signal(reader),
    controllerOnline: [reader.bool(), reader.bool(), reader.bool()],
  };
}

/** 解码一条故障记录（顺序：id → severity → active → 时间 → 次数）。 */
function decodeFault(reader: Reader): Fault {
  const id = reader.u32();
  const severity = FAULT_SEVERITIES[reader.u8()];
  if (severity === undefined) throw new Error("故障级别越界");
  return {
    id,
    severity,
    active: reader.bool(),
    firstSeenMs: reader.u64(),
    lastSeenMs: reader.u64(),
    occurrenceCount: reader.u32(),
  };
}

/** 解码故障快照。 */
function decodeFaultSnapshot(reader: Reader): FaultSnapshot {
  const timestampMs = reader.u64();
  const count = reader.u16();
  const faults: Fault[] = [];
  for (let index = 0; index < count; index += 1) {
    faults.push(decodeFault(reader));
  }
  return { timestampMs, faults };
}

/** 解码系统状态。 */
function decodeSystemState(reader: Reader): SystemState {
  const timestampMs = reader.u64();
  const uptimeMs = reader.u64();
  const health: HealthState[] = [];
  for (let index = 0; index < 5; index += 1) {
    const value = HEALTH_VALUES[reader.u8()];
    if (value === undefined) throw new Error("健康状态越界");
    health.push(value);
  }
  return {
    timestampMs,
    uptimeMs,
    health,
    rssKb: reader.u32(),
    memAvailableKb: reader.u32(),
  };
}

/** 解码 u16 长度前缀字符串。 */
function decodeString(reader: Reader): string {
  const length = reader.u16();
  const bytes: number[] = [];
  for (let index = 0; index < length; index += 1) {
    bytes.push(reader.u8());
  }
  return new TextDecoder().decode(Uint8Array.from(bytes));
}

/** 编码一条客户端消息（含帧头）。 */
export function encodeClient(message: ClientMessage, sequence: number): Uint8Array {
  const writer = new Writer();
  let messageType: number;
  switch (message.type) {
    case "hello":
      messageType = MESSAGE_TYPES.hello;
      writer.u16(message.clientVersion);
      break;
    case "ping":
      messageType = MESSAGE_TYPES.cmdPing;
      writer.u32(message.nonce);
      break;
    case "playSound":
      messageType = MESSAGE_TYPES.cmdPlaySound;
      writer.u8(SOUND_IDS[message.sound]);
      break;
    case "setVolume":
      messageType = MESSAGE_TYPES.cmdSetVolume;
      writer.u8(message.volume);
      break;
    case "setBrightness":
      messageType = MESSAGE_TYPES.cmdSetBrightness;
      writer.u8(message.brightness);
      break;
    case "reportPowerOn":
      messageType = MESSAGE_TYPES.cmdReportPowerOn;
      writer.u8(message.kind);
      writer.raw(hexToBytes(message.card));
      break;
    case "swipeReply":
      messageType = MESSAGE_TYPES.cmdSwipeReply;
      writer.u8(message.status);
      break;
    case "verifyPassword":
      messageType = MESSAGE_TYPES.cmdVerifyPassword;
      writer.string(message.password);
      break;
    case "setAdminPassword":
      messageType = MESSAGE_TYPES.cmdSetAdminPassword;
      writer.string(message.oldPassword);
      writer.string(message.newPassword);
      break;
    case "enterLicenseTail":
      messageType = MESSAGE_TYPES.cmdEnterLicenseTail;
      writer.string(message.digits);
      break;
    case "setAntiDismantle":
      messageType = MESSAGE_TYPES.cmdSetAntiDismantle;
      writer.u8(message.enabled ? 1 : 0);
      break;
    case "getSettings":
      messageType = MESSAGE_TYPES.cmdGetSettings;
      break;
    case "setSettings":
      messageType = MESSAGE_TYPES.cmdSetSettings;
      writer.u8(message.flags);
      break;
  }
  const payload = writer.finish();
  const frame = new Uint8Array(HEADER_SIZE + payload.byteLength);
  const view = new DataView(frame.buffer);
  view.setUint32(0, PROTOCOL_MAGIC, true);
  view.setUint16(4, PROTOCOL_VERSION, true);
  view.setUint16(6, messageType, true);
  view.setUint32(8, payload.byteLength, true);
  view.setUint32(12, sequence, true);
  frame.set(payload, HEADER_SIZE);
  return frame;
}

/** 字节转十六进制（测试与日志用）。 */
export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
