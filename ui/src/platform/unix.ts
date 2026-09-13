// macOS 开发用 Unix socket 传输（直连 forklift-sim / forkliftd）。
// 依赖 node:net，仅用于 Bun/Node 宿主，不得进入 QuickJS guest bundle。

import { connect as connectStream, type Socket } from "node:net";

import { decodeFrame, encodeClient, FrameDecoder, type ClientMessage, type ServerMessage } from "./protocol";
import type { Transport } from "./transport";

export { FrameDecoder } from "./protocol";
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
