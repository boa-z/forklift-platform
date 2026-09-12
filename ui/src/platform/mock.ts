// 纯内存传输：固定值 + 轻微波动。不依赖任何宿主 API（QuickJS 无 setInterval，
// 由宿主逐帧调用 tick() 驱动），供 UI 开发、单元测试与无 daemon 场景使用。

import {
  PROTOCOL_VERSION,
  type ClientMessage,
  type Direction,
  type Fault,
  type RtcTime,
  type ServerMessage,
  type SoundId,
  type SwipeReportMessage,
  type VehicleState,
} from "./protocol";
import type { Transport } from "./transport";

/** 设备效果回调（Mock 在收到命令时调用；真机由宿主模块执行）。 */
export interface MockEffects {
  /** 播放提示音/语音。 */
  playSound?: (sound: SoundId) => void;
  /** 设置音量（0-100）。 */
  setVolume?: (volume: number) => void;
  /** 设置亮度（0-100）。 */
  setBrightness?: (brightness: number) => void;
}

/** 验收场景：覆盖车速/方向/故障等固定值（报警语音的实机验证）。 */
export interface MockScenario {
  /** 固定车速（km/h）。 */
  speedKph?: number;
  /** 固定方向。 */
  direction?: Direction;
  /** 固定安全带状态。 */
  seatbelt?: boolean;
  /** 固定座椅开关状态。 */
  seatSwitch?: boolean;
  /** 活动故障编号（0 = 无故障）。 */
  faultId?: number;
}

/** 纯内存传输实现。 */
export class MockTransport implements Transport {
  private messageHandler: ((message: ServerMessage) => void) | undefined;
  private closeHandler: ((error?: Error) => void) | undefined;
  private phase = 0;
  private charging: boolean;
  private antiDismantle: boolean;
  private adminPassword: string;
  private effects: MockEffects;
  private scenario: MockScenario;

  /** 可选注入充电/防拆卸状态、设备效果回调与验收场景；默认均为空。 */
  constructor(
    options: {
      charging?: boolean;
      antiDismantle?: boolean;
      adminPassword?: string;
      effects?: MockEffects;
      scenario?: MockScenario;
    } = {},
  ) {
    this.charging = options.charging ?? false;
    this.antiDismantle = options.antiDismantle ?? false;
    this.adminPassword = options.adminPassword ?? "22222";
    this.effects = options.effects ?? {};
    this.scenario = options.scenario ?? {};
  }

  /** 更新充电状态（开发/验收用）。 */
  setCharging(charging: boolean): void {
    this.charging = charging;
  }

  /** 建立“连接”；数据由宿主逐帧调用 tick() 推送。 */
  async connect(): Promise<void> {
    this.messageHandler?.({ type: "serverVersion", version: PROTOCOL_VERSION });
  }

  /** 关闭连接。 */
  close(): void {
    this.closeHandler?.();
  }

  /** 处理客户端消息：PING→PONG，命令→OK。 */
  send(message: ClientMessage): void {
    switch (message.type) {
      case "ping":
        this.messageHandler?.({ type: "pong", nonce: message.nonce });
        break;
      case "hello":
        this.messageHandler?.({ type: "serverVersion", version: PROTOCOL_VERSION });
        break;
      case "playSound":
        this.effects.playSound?.(message.sound);
        this.messageHandler?.({ type: "ok" });
        break;
      case "setVolume":
        this.effects.setVolume?.(message.volume);
        this.messageHandler?.({ type: "ok" });
        break;
      case "setBrightness":
        this.effects.setBrightness?.(message.brightness);
        this.messageHandler?.({ type: "ok" });
        break;
      case "verifyPassword": {
        // 与参考默认一致：超级 32431、管理员 22222；其余降级为 0。
        const level =
          message.password === "32431" ? 2 : message.password === this.adminPassword ? 1 : 0;
        this.messageHandler?.({ type: "authLevel", level });
        break;
      }
      case "setAdminPassword": {
        if (message.oldPassword !== this.adminPassword && message.oldPassword !== "32431") {
          this.messageHandler?.({ type: "error", code: 2001, message: "旧密码不正确" });
          break;
        }
        if (!/^[0-9]{4,8}$/.test(message.newPassword)) {
          this.messageHandler?.({ type: "error", code: 2001, message: "新密码必须是 4-8 位数字" });
          break;
        }
        this.adminPassword = message.newPassword;
        this.messageHandler?.({ type: "ok" });
        break;
      }
      case "enterLicenseTail":
        this.messageHandler?.({ type: "ok" });
        break;
      case "reportPowerOn":
      case "swipeReply":
        break;
      case "setAntiDismantle":
        this.antiDismantle = message.enabled;
        this.messageHandler?.({
          type: "antiDismantle",
          state: { enabled: message.enabled, alarm: false },
        });
        this.messageHandler?.({ type: "ok" });
        break;
    }
  }

  /** 注入一条刷卡上报（开发/验收用）。 */
  pushSwipe(report: SwipeReportMessage): void {
    this.messageHandler?.({ type: "swipeReport", report });
  }

  /** 注入一帧模组时间（开发/验收用）。 */
  pushRtc(rtc: RtcTime): void {
    this.messageHandler?.({ type: "rtc", rtc });
  }

  /** 订阅服务端消息。 */
  onMessage(handler: (message: ServerMessage) => void): void {
    this.messageHandler = handler;
  }

  /** 订阅连接关闭。 */
  onClose(handler: (error?: Error) => void): void {
    this.closeHandler = handler;
  }

  /** 周期推送一帧模拟车辆状态（由宿主逐帧调用）。 */
  tick(): void {
    this.phase = (this.phase + 1) % 100;
    const state: VehicleState = {
      timestampMs: Date.now(),
      speedKph: signal(12.5 + this.phase * 0.01),
      direction: signal("forward"),
      parkingBrake: signal(false),
      steerAngleDeg: signal(-15),
      runMode: signal("s"),
      socPercent: signal(56),
      voltageV: signal(51.2),
      currentA: signal(12.5),
      charging: signal(this.charging),
      motorRpm: signal(1500),
      motorTemperatureC: signal(45),
      pressureMpa: signal(12.5),
      seatSwitch: signal(true),
      seatbelt: signal(true),
      keyOn: signal(true),
      antiDismantle: signal(this.antiDismantle),
      canOnline: true,
      cameraOnline: true,
      odometerKm: signal(1234),
      workHours: signal(56),
      controllerOnline: [true, true, false],
    };
    if (this.scenario.speedKph !== undefined) state.speedKph = signal(this.scenario.speedKph);
    if (this.scenario.direction !== undefined) state.direction = signal(this.scenario.direction);
    if (this.scenario.seatbelt !== undefined) state.seatbelt = signal(this.scenario.seatbelt);
    if (this.scenario.seatSwitch !== undefined) state.seatSwitch = signal(this.scenario.seatSwitch);
    this.messageHandler?.({ type: "vehicleState", state });
    const faultId = this.scenario.faultId ?? 0;
    if (faultId > 0) {
      const fault: Fault = {
        id: faultId,
        severity: "warning",
        active: true,
        firstSeenMs: Date.now(),
        lastSeenMs: Date.now(),
        occurrenceCount: 1,
      };
      this.messageHandler?.({ type: "faults", snapshot: { timestampMs: Date.now(), faults: [fault] } });
    }
  }
}

/** 构造 Valid 信号。 */
function signal<T>(value: T): { value: T; timestampMs: number; quality: "valid" } {
  return { value, timestampMs: Date.now(), quality: "valid" };
}
