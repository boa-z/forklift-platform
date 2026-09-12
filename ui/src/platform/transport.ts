// 传输接口：平台 API 只依赖这组类型；具体实现按宿主分文件，
// 避免把 Node 专属模块打进入 QuickJS 的 guest bundle。

import type { ClientMessage, ServerMessage } from "./protocol";

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
