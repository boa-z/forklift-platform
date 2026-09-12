// 传输层：平台 API 只依赖本文件的 Transport 接口。
// - UnixTransport：macOS 开发直连 forklift-sim/forkliftd（SOCK_STREAM 分帧）；
// - MockTransport：纯 UI 开发与单元测试，不依赖任何进程；
// - HostBridgeTransport：D211 上由 PocketJS 宿主注入（后续 milestone）。

import { connect as connectStream, type Socket } from "node:net";

import {
  decodeFrame,
  encodeClient,
  HEADER_SIZE,
  MAX_PAYLOAD,
  PROTOCOL_VERSION,
  type ClientMessage,
  type ServerMessage,
  type VehicleState,
} from "./protocol";

/** 消息与关闭事件的订阅接口。 */
export interface Transport {
  /** 建立连接；失败时 reject。 */
  connect(): Promise<void>;
  /** 主动关闭连接。 */
  close(): void;
  /** 发送一条客户端消息（自动分配序号）。 */
  send(message: ClientMessage): void;
  /** 订阅服务端消息。 */
  onMessage(handler: (message: ServerMessage) => void): void;
  /** 订阅连接关闭（含错误）。 */
  onClose(handler: (error?: Error) => void): void;
}

/** 字节流分帧：累积数据并按帧头长度切出完整帧。 */
class FrameDecoder {
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

/** macOS 开发用 Unix socket 传输（直连 simulator/daemon）。 */
export class UnixTransport implements Transport {
  private socket: Socket | undefined;
  private readonly decoder = new FrameDecoder();
  private messageHandler: ((message: ServerMessage) => void) | undefined;
  private closeHandler: ((error?: Error) => void) | undefined;
  private sequence = 1;

  constructor(private readonly path: string) {}

  /** 连接并开始解析帧。 */
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = connectStream({ path: this.path });
      this.socket = socket;
      socket.once("connect", () => resolve());
      socket.once("error", (error) => reject(error));
      socket.on("data", (chunk: Buffer) => {
        try {
          for (const frame of this.decoder.push(new Uint8Array(chunk))) {
            this.messageHandler?.(decodeFrame(frame).message);
          }
        } catch (error) {
          this.close();
          this.closeHandler?.(error as Error);
        }
      });
      socket.on("close", () => this.closeHandler?.());
    });
  }

  /** 关闭连接。 */
  close(): void {
    this.socket?.destroy();
    this.socket = undefined;
  }

  /** 编码并发送客户端消息。 */
  send(message: ClientMessage): void {
    if (!this.socket) throw new Error("传输尚未连接");
    this.socket.write(encodeClient(message, this.sequence));
    this.sequence += 1;
  }

  /** 订阅服务端消息。 */
  onMessage(handler: (message: ServerMessage) => void): void {
    this.messageHandler = handler;
  }

  /** 订阅连接关闭。 */
  onClose(handler: (error?: Error) => void): void {
    this.closeHandler = handler;
  }
}

/** 纯内存传输：固定值 + 轻微波动，用于 UI 开发与单元测试。 */
export class MockTransport implements Transport {
  private messageHandler: ((message: ServerMessage) => void) | undefined;
  private closeHandler: ((error?: Error) => void) | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  private phase = 0;

  /** 建立“连接”并开始推送状态。 */
  async connect(): Promise<void> {
    this.messageHandler?.({ type: "serverVersion", version: PROTOCOL_VERSION });
    this.timer = setInterval(() => this.tick(), 50);
  }

  /** 停止推送。 */
  close(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
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
      case "setVolume":
      case "setBrightness":
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

  /** 周期推送一帧模拟车辆状态。 */
  private tick(): void {
    this.phase = (this.phase + 1) % 100;
    const state: VehicleState = {
      timestampMs: Date.now(),
      speedKph: signal(12.5 + this.phase * 0.01),
      direction: signal("reverse"),
      parkingBrake: signal(false),
      steerAngleDeg: signal(-15),
      runMode: signal("s"),
      socPercent: signal(56),
      voltageV: signal(51.2),
      currentA: signal(12.5),
      motorRpm: signal(1500),
      motorTemperatureC: signal(45),
      pressureMpa: signal(12.5),
      seatSwitch: signal(true),
      seatbelt: signal(true),
      keyOn: signal(true),
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
