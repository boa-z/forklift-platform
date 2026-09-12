// macOS 开发用 Unix socket 传输（直连 forklift-sim / forkliftd）。
// 依赖 node:net，仅用于 Bun/Node 宿主，不得进入 QuickJS guest bundle。

import { connect as connectStream, type Socket } from "node:net";

import { decodeFrame, encodeClient, HEADER_SIZE, MAX_PAYLOAD, type ClientMessage, type ServerMessage } from "./protocol";
import type { Transport } from "./transport";

/** 字节流分帧：累积数据并按帧头长度切出完整帧。 */
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

/** macOS 开发用 Unix socket 传输。 */
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
