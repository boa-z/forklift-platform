// 纯内存传输：固定值 + 轻微波动。不依赖任何宿主 API（QuickJS 无 setInterval，
// 由宿主逐帧调用 tick() 驱动），供 UI 开发、单元测试与无 daemon 场景使用。

import { PROTOCOL_VERSION, type ClientMessage, type ServerMessage, type VehicleState } from "./protocol";
import type { Transport } from "./transport";

/** 设备效果回调（Mock 在收到命令时调用；真机由宿主模块执行）。 */
export interface MockEffects {
  /** 播放提示音。 */
  playSound?: (sound: string) => void;
  /** 设置音量（0-100）。 */
  setVolume?: (volume: number) => void;
  /** 设置亮度（0-100）。 */
  setBrightness?: (brightness: number) => void;
}

/** 纯内存传输实现。 */
export class MockTransport implements Transport {
  private messageHandler: ((message: ServerMessage) => void) | undefined;
  private closeHandler: ((error?: Error) => void) | undefined;
  private phase = 0;
  private charging: boolean;
  private antiDismantle: boolean;
  private effects: MockEffects;

  /** 可选注入充电/防拆卸状态与设备效果回调；默认均为空。 */
  constructor(options: { charging?: boolean; antiDismantle?: boolean; effects?: MockEffects } = {}) {
    this.charging = options.charging ?? false;
    this.antiDismantle = options.antiDismantle ?? false;
    this.effects = options.effects ?? {};
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
    }
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
    this.messageHandler?.({ type: "vehicleState", state });
  }
}

/** 构造 Valid 信号。 */
function signal<T>(value: T): { value: T; timestampMs: number; quality: "valid" } {
  return { value, timestampMs: Date.now(), quality: "valid" };
}
