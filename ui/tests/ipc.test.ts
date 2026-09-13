// IpcTransport 测试：握手、消息分发与坏帧关闭（用假 IpcOps 模拟宿主模块）。

import { describe, expect, test } from "bun:test";

import { createPlatform } from "../src/platform";
import { IpcTransport } from "../src/platform/ipc";
import { PROTOCOL_VERSION, type IpcOpsLike } from "./ipc-test-helpers";

/** 构造一条服务端帧。 */
function serverFrame(type: number, sequence: number, payload: Uint8Array): Uint8Array {
  const frame = new Uint8Array(16 + payload.byteLength);
  const view = new DataView(frame.buffer);
  view.setUint32(0, 0x544b4c46, true);
  view.setUint16(4, PROTOCOL_VERSION, true);
  view.setUint16(6, type, true);
  view.setUint32(8, payload.byteLength, true);
  view.setUint32(12, sequence, true);
  frame.set(payload, 16);
  return frame;
}

/** 假 IPC 宿主：记录发送、按需回包。 */
class FakeIpc implements IpcOpsLike {
  readonly sent: Uint8Array[] = [];
  private readonly inbound: Uint8Array[] = [];

  connect(path: string): boolean {
    return path === "/run/forklift/forkliftd.sock";
  }

  close(): void {}

  send(data: Uint8Array | ArrayBuffer): number {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    this.sent.push(bytes);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    // 客户端 HELLO(0x0001) 自动回 SERVER_VERSION(0x0003)。
    if (view.getUint16(6, true) === 0x0001) {
      this.queue(serverFrame(0x0003, 1, new Uint8Array([PROTOCOL_VERSION & 0xff, PROTOCOL_VERSION >> 8])));
    }
    return bytes.byteLength;
  }

  recv(): ArrayBuffer {
    const next = this.inbound.shift();
    if (next === undefined) return new ArrayBuffer(0);
    return next.buffer.slice(next.byteOffset, next.byteOffset + next.byteLength) as ArrayBuffer;
  }

  queue(frame: Uint8Array): void {
    this.inbound.push(frame);
  }
}

describe("IpcTransport", () => {
  test("握手与设置事件分发", async () => {
    const fake = new FakeIpc();
    const transport = new IpcTransport(fake, "/run/forklift/forkliftd.sock");
    const platform = createPlatform(transport);

    const connecting = platform.connect();
    await new Promise((resolve) => setTimeout(resolve, 0));
    transport.pump();
    await connecting;

    let flags = -1;
    platform.settings.subscribe((value) => {
      flags = value;
    });
    fake.queue(serverFrame(0x0404, 2, new Uint8Array([0b1011])));
    transport.pump();
    expect(flags).toBe(0b1011);
    expect(fake.sent.length).toBe(1);
  });

  test("坏帧触发关闭回调", async () => {
    const fake = new FakeIpc();
    const transport = new IpcTransport(fake, "/run/forklift/forkliftd.sock");
    const platform = createPlatform(transport);
    const connecting = platform.connect();
    await new Promise((resolve) => setTimeout(resolve, 0));
    transport.pump();
    await connecting;

    let closed = false;
    transport.onClose(() => {
      closed = true;
    });
    // 16 字节帧头 + 超限载荷长度：分帧器应报错并关闭连接。
    const bad = new Uint8Array(16);
    new DataView(bad.buffer).setUint32(8, 0xffffffff, true);
    fake.queue(bad);
    transport.pump();
    expect(closed).toBe(true);
  });
});
