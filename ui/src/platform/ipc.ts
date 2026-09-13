// 设备 IPC 传输：通过 PocketJS 的 `ipc` 宿主模块连接本地 forkliftd。
// 一数据报一帧；外壳逐帧调用 pump() 排空接收队列（QuickJS 无事件循环）。
// macOS 开发用 unix.ts（node:net），本文件是设备侧实现。

import { ipcHost, type IpcOps } from "@pocketjs/framework/ipc";

import {
  decodeFrame,
  encodeClient,
  FrameDecoder,
  type ClientMessage,
  type ServerMessage,
} from "./protocol";
import type { Transport } from "./transport";

/** 每帧最多排空的数据报数（避免长队列卡住渲染帧）。 */
const MAX_DATAGRAMS_PER_PUMP = 8;

/** 使用 PocketJS ipc 宿主模块的传输实现。 */
export class IpcTransport implements Transport {
  private decoder = new FrameDecoder();
  private messageHandler: ((message: ServerMessage) => void) | undefined;
  private closeHandler: ((error?: Error) => void) | undefined;
  private sequence = 1;
  private connected = false;

  /** 绑定宿主 ops 与 socket 路径（如 /run/forklift/forkliftd.sock）。 */
  constructor(
    private readonly ops: IpcOps,
    private readonly path: string,
  ) {}

  /** 连接；宿主模块缺失或路径不可用时报错。 */
  connect(): Promise<void> {
    if (!this.ops.connect(this.path)) {
      return Promise.reject(new Error(`ipc.connect(${this.path}) 失败`));
    }
    this.connected = true;
    return Promise.resolve();
  }

  /** 关闭连接。 */
  close(): void {
    this.ops.close();
    this.connected = false;
  }

  /** 编码并发送一条客户端消息（一帧一数据报）。 */
  send(message: ClientMessage): void {
    if (!this.connected) throw new Error("传输尚未连接");
    const frame = encodeClient(message, this.sequence);
    this.sequence += 1;
    const written = this.ops.send(frame);
    if (written !== frame.byteLength) {
      throw new Error(`IPC 发送不完整：${written}/${frame.byteLength}`);
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

  /** 逐帧调用：排空接收队列并解码。 */
  pump(): void {
    if (!this.connected) return;
    for (let index = 0; index < MAX_DATAGRAMS_PER_PUMP; index += 1) {
      const chunk = new Uint8Array(this.ops.recv());
      if (chunk.byteLength === 0) return;
      try {
        for (const frame of this.decoder.push(chunk)) {
          this.messageHandler?.(decodeFrame(frame).message);
        }
      } catch (error) {
        // 单帧异常不断开连接：丢弃缓冲（SEQPACKET 一报一帧）后继续排空。
        this.decoder = new FrameDecoder();
        console.warn(`IPC 帧解码失败：${String(error)}`);
      }
    }
  }
}
