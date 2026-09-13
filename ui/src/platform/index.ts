// @forklift/platform：UI 唯一可用的平台 API。
// UI 不感知 IPC、socket、协议字节；命令与状态都经过这里收敛。

import {
  PROTOCOL_VERSION,
  type AntiDismantleState,
  type AuthState,
  type ClientMessage,
  type Fault,
  type FaultSnapshot,
  type RtcTime,
  type ServerMessage,
  type SoundId,
  type SwipeReportMessage,
  type SystemState,
  type VehicleState,
} from "./protocol";
import type { Transport } from "./transport";

export type { Fault, FaultSnapshot, SoundId, SystemState, VehicleState } from "./protocol";
export type { AntiDismantleState, AuthState, RtcTime, SwipeReportMessage } from "./protocol";
export type { Transport } from "./transport";
export { MockTransport } from "./mock";

/** 故障变化事件。 */
export interface FaultEvent {
  kind: "raised" | "cleared";
  fault: Fault;
}

/** 平台 API 聚合接口。 */
export interface Platform {
  /** 建立连接并完成协议握手。 */
  connect(): Promise<void>;
  /** 关闭连接。 */
  close(): void;
  vehicle: {
    /** 最近一次车辆状态快照。 */
    snapshot(): VehicleState | undefined;
    /** 订阅车辆状态更新，返回取消函数。 */
    subscribe(listener: (state: VehicleState) => void): () => void;
  };
  faults: {
    /** 最近一次故障快照。 */
    snapshot(): FaultSnapshot;
    /** 订阅故障快照更新。 */
    subscribe(listener: (snapshot: FaultSnapshot) => void): () => void;
    /** 订阅单条故障的产生/清除事件。 */
    subscribeEvent(listener: (event: FaultEvent) => void): () => void;
  };
  system: {
    /** 最近一次系统状态。 */
    snapshot(): SystemState | undefined;
    /** 订阅系统状态更新。 */
    subscribe(listener: (state: SystemState) => void): () => void;
    /** 请求设置亮度（0-100）。 */
    setBrightness(brightness: number): void;
  };
  audio: {
    /** 播放提示音。 */
    play(sound: SoundId): void;
    /** 设置音量（0-100）。 */
    setVolume(volume: number): void;
  };
  auth: {
    /** 最近一次授权状态（权限级别/是否已授权）。 */
    snapshot(): AuthState;
    /** 订阅授权状态更新。 */
    subscribe(listener: (state: AuthState) => void): () => void;
    /** 校验设置密码，返回 0 用户/1 管理员/2 超级管理员。 */
    verifyPassword(password: string): Promise<number>;
    /** 修改管理员密码；旧密码错误或新密码非法时 reject。 */
    setAdminPassword(oldPassword: string, newPassword: string): Promise<void>;
    /** 提交双重认证的身份证后 4/6 位。 */
    enterLicenseTail(digits: string): void;
    /** 上报开机方式（0 密码/1 刷卡/4 蓝牙）；card 为 8 位十六进制。 */
    reportPowerOn(kind: number, card?: string): void;
    /** 回给模组的刷卡处理结果（0 成功）。 */
    swipeReply(status: number): void;
    /** 订阅刷卡上报（授权屏展示与双重认证）。 */
    onSwipe(listener: (report: SwipeReportMessage) => void): () => void;
    /** 最近一次防拆状态。 */
    antiDismantle(): AntiDismantleState;
    /** 订阅防拆状态更新。 */
    subscribeAntiDismantle(listener: (state: AntiDismantleState) => void): () => void;
    /** 设置防拆使能。 */
    setAntiDismantle(enabled: boolean): void;
    /** 订阅模组 RTC 时间。 */
    onRtc(listener: (rtc: RtcTime) => void): () => void;
  };
  settings: {
    /** 读取 UI 设置位域（bit0 自检/bit1 授权/bit2 密码开机/bit3 防拆）。 */
    get(): Promise<number>;
    /** 写入 UI 设置位域（daemon 持久化）。 */
    set(flags: number): void;
    /** 订阅设置变化。 */
    subscribe(listener: (flags: number) => void): () => void;
  };
  /** 发送 PING 并等待 PONG，返回往返时的 nonce。 */
  ping(nonce?: number): Promise<number>;
}

/** 用给定传输构造平台 API。 */
export function createPlatform(transport: Transport): Platform {
  let vehicleState: VehicleState | undefined;
  let faultSnapshot: FaultSnapshot = { timestampMs: 0, faults: [] };
  let systemState: SystemState | undefined;
  let authState: AuthState = { level: 0, authorized: false };
  let antiDismantleState: AntiDismantleState = { enabled: false, alarm: false };
  let settingsFlags: number | undefined;
  let connected = false;

  const vehicleListeners = new Set<(state: VehicleState) => void>();
  const faultListeners = new Set<(snapshot: FaultSnapshot) => void>();
  const faultEventListeners = new Set<(event: FaultEvent) => void>();
  const systemListeners = new Set<(state: SystemState) => void>();
  const authListeners = new Set<(state: AuthState) => void>();
  const antiDismantleListeners = new Set<(state: AntiDismantleState) => void>();
  const swipeListeners = new Set<(report: SwipeReportMessage) => void>();
  const rtcListeners = new Set<(rtc: RtcTime) => void>();
  const settingsListeners = new Set<(flags: number) => void>();
  const pendingPings = new Map<number, (nonce: number) => void>();
  let pendingVerify: ((level: number) => void) | undefined;
  let pendingSettings: ((flags: number) => void) | undefined;
  let pendingAdmin: { resolve: () => void; reject: (error: Error) => void } | undefined;

  // 握手期间由统一分发处理 SERVER_VERSION，不覆盖 onMessage 订阅。
  let handshakeResolve: (() => void) | undefined;
  let handshakeReject: ((error: Error) => void) | undefined;

  /** 统一分发服务端消息。 */
  const handleMessage = (message: ServerMessage): void => {
    if (handshakeResolve !== undefined && handshakeReject !== undefined) {
      if (message.type === "serverVersion") {
        const resolve = handshakeResolve;
        const reject = handshakeReject;
        handshakeResolve = undefined;
        handshakeReject = undefined;
        if (message.version !== PROTOCOL_VERSION) {
          reject(new Error(`协议版本不匹配：daemon=${message.version}`));
        } else {
          resolve();
        }
      } else if (message.type === "error") {
        const reject = handshakeReject;
        handshakeResolve = undefined;
        handshakeReject = undefined;
        reject(new Error(`daemon 拒绝握手：${message.message}`));
      }
      return;
    }

    switch (message.type) {
      case "vehicleState":
        vehicleState = message.state;
        for (const listener of vehicleListeners) listener(message.state);
        break;
      case "faults":
        faultSnapshot = message.snapshot;
        for (const listener of faultListeners) listener(message.snapshot);
        break;
      case "faultRaised":
        emitFaultEvent({ kind: "raised", fault: message.fault });
        break;
      case "faultCleared":
        emitFaultEvent({ kind: "cleared", fault: message.fault });
        break;
      case "system":
        systemState = message.state;
        for (const listener of systemListeners) listener(message.state);
        break;
      case "authState":
        authState = message.state;
        for (const listener of authListeners) listener(message.state);
        break;
      case "authLevel": {
        const resolve = pendingVerify;
        pendingVerify = undefined;
        resolve?.(message.level);
        break;
      }
      case "antiDismantle":
        antiDismantleState = message.state;
        for (const listener of antiDismantleListeners) listener(message.state);
        break;
      case "swipeReport":
        for (const listener of swipeListeners) listener(message.report);
        break;
      case "rtc":
        for (const listener of rtcListeners) listener(message.rtc);
        break;
      case "settings": {
        settingsFlags = message.flags;
        const pending = pendingSettings;
        pendingSettings = undefined;
        pending?.(message.flags);
        for (const listener of settingsListeners) listener(message.flags);
        break;
      }
      case "ok": {
        const pending = pendingAdmin;
        pendingAdmin = undefined;
        pending?.resolve();
        break;
      }
      case "pong": {
        const resolve = pendingPings.get(message.nonce);
        if (resolve !== undefined) {
          pendingPings.delete(message.nonce);
          resolve(message.nonce);
        }
        break;
      }
      case "error":
        // 非握手期的错误只记录，不能从事件回调里抛出（会打断事件循环）；
        // 改密/校验的等待方在这里收到 reject。
        if (pendingAdmin !== undefined) {
          const pending = pendingAdmin;
          pendingAdmin = undefined;
          pending.reject(new Error(message.message));
        }
        console.warn(`daemon 返回错误 ${message.code}：${message.message}`);
        break;
      default:
        break;
    }
  };

  /** 把单条故障事件并入快照后广播。 */
  const emitFaultEvent = (event: FaultEvent): void => {
    const existing = faultSnapshot.faults.filter((fault) => fault.id !== event.fault.id);
    faultSnapshot = {
      timestampMs: event.fault.lastSeenMs,
      faults: [...existing, event.fault],
    };
    for (const listener of faultEventListeners) listener(event);
    for (const listener of faultListeners) listener(faultSnapshot);
  };

  transport.onMessage(handleMessage);
  transport.onClose(() => {
    connected = false;
  });

  /** 等待握手：发送 HELLO 并由统一分发验证 SERVER_VERSION。 */
  const handshake = (): Promise<void> =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        handshakeResolve = undefined;
        handshakeReject = undefined;
        reject(new Error("握手超时"));
      }, 3000);
      handshakeResolve = () => {
        clearTimeout(timer);
        resolve();
      };
      handshakeReject = (error: Error) => {
        clearTimeout(timer);
        reject(error);
      };
      transport.send({ type: "hello", clientVersion: PROTOCOL_VERSION });
    });

  /** 发送一条客户端命令；未连接时抛错。 */
  const send = (message: ClientMessage): void => {
    if (!connected) throw new Error("平台尚未连接");
    transport.send(message);
  };

  return {
    async connect(): Promise<void> {
      await transport.connect();
      await handshake();
      connected = true;
    },
    close(): void {
      transport.close();
      connected = false;
    },
    vehicle: {
      snapshot: () => vehicleState,
      subscribe(listener) {
        vehicleListeners.add(listener);
        if (vehicleState !== undefined) listener(vehicleState);
        return () => vehicleListeners.delete(listener);
      },
    },
    faults: {
      snapshot: () => faultSnapshot,
      subscribe(listener) {
        faultListeners.add(listener);
        listener(faultSnapshot);
        return () => faultListeners.delete(listener);
      },
      subscribeEvent(listener) {
        faultEventListeners.add(listener);
        return () => faultEventListeners.delete(listener);
      },
    },
    system: {
      snapshot: () => systemState,
      subscribe(listener) {
        systemListeners.add(listener);
        if (systemState !== undefined) listener(systemState);
        return () => systemListeners.delete(listener);
      },
      setBrightness(brightness) {
        if (!connected) throw new Error("平台尚未连接");
        transport.send({ type: "setBrightness", brightness });
      },
    },
    audio: {
      play(sound) {
        if (!connected) throw new Error("平台尚未连接");
        transport.send({ type: "playSound", sound });
      },
      setVolume(volume) {
        if (!connected) throw new Error("平台尚未连接");
        transport.send({ type: "setVolume", volume });
      },
    },
    auth: {
      snapshot: () => authState,
      subscribe(listener) {
        authListeners.add(listener);
        listener(authState);
        return () => authListeners.delete(listener);
      },
      verifyPassword(password) {
        return new Promise((resolve, reject) => {
          if (!connected) {
            reject(new Error("平台尚未连接"));
            return;
          }
          const timer = setTimeout(() => {
            pendingVerify = undefined;
            reject(new Error("密码校验超时"));
          }, 3000);
          pendingVerify = (level) => {
            clearTimeout(timer);
            resolve(level);
          };
          transport.send({ type: "verifyPassword", password });
        });
      },
      setAdminPassword(oldPassword, newPassword) {
        return new Promise((resolve, reject) => {
          if (!connected) {
            reject(new Error("平台尚未连接"));
            return;
          }
          const timer = setTimeout(() => {
            pendingAdmin = undefined;
            reject(new Error("改密超时"));
          }, 3000);
          pendingAdmin = {
            resolve: () => {
              clearTimeout(timer);
              resolve();
            },
            reject: (error) => {
              clearTimeout(timer);
              reject(error);
            },
          };
          transport.send({ type: "setAdminPassword", oldPassword, newPassword });
        });
      },
      enterLicenseTail(digits) {
        send({ type: "enterLicenseTail", digits });
      },
      reportPowerOn(kind, card = "ffffffff") {
        send({ type: "reportPowerOn", kind, card });
      },
      swipeReply(status) {
        send({ type: "swipeReply", status });
      },
      onSwipe(listener) {
        swipeListeners.add(listener);
        return () => swipeListeners.delete(listener);
      },
      antiDismantle: () => antiDismantleState,
      subscribeAntiDismantle(listener) {
        antiDismantleListeners.add(listener);
        listener(antiDismantleState);
        return () => antiDismantleListeners.delete(listener);
      },
      setAntiDismantle(enabled) {
        send({ type: "setAntiDismantle", enabled });
      },
      onRtc(listener) {
        rtcListeners.add(listener);
        return () => rtcListeners.delete(listener);
      },
    },
    settings: {
      get() {
        return new Promise((resolve, reject) => {
          if (!connected) {
            reject(new Error("平台尚未连接"));
            return;
          }
          const timer = setTimeout(() => {
            pendingSettings = undefined;
            reject(new Error("读取设置超时"));
          }, 3000);
          pendingSettings = (flags) => {
            clearTimeout(timer);
            resolve(flags);
          };
          transport.send({ type: "getSettings" });
        });
      },
      set(flags) {
        send({ type: "setSettings", flags });
      },
      subscribe(listener) {
        settingsListeners.add(listener);
        if (settingsFlags !== undefined) listener(settingsFlags);
        return () => settingsListeners.delete(listener);
      },
    },
    ping(nonce = 0x0102_0304): Promise<number> {
      return new Promise((resolve, reject) => {
        if (!connected) {
          reject(new Error("平台尚未连接"));
          return;
        }
        const timer = setTimeout(() => reject(new Error("PING 超时")), 3000);
        pendingPings.set(nonce, (value) => {
          clearTimeout(timer);
          resolve(value);
        });
        transport.send({ type: "ping", nonce });
      });
    },
  };
}
