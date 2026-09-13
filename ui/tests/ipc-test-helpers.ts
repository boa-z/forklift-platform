/** IpcTransport 测试共用的常量与宿主接口形状（避免直接依赖 framework 包）。 */
export const PROTOCOL_VERSION = 5;

/** 与 @pocketjs/framework/ipc 的 IpcOps 同形。 */
export interface IpcOpsLike {
  connect(path: string): boolean;
  close(): void;
  send(data: Uint8Array | ArrayBuffer): number;
  recv(capacity?: number): ArrayBuffer;
}
