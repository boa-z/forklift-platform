// 端到端检查：启动 Rust forklift-sim，用 TypeScript 平台层验证
// 握手、车辆状态、故障与 PING。
//
// 用法（仓库根目录）：bun tools/ui-sim-check.ts

import { closeSync, existsSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createPlatform, UnixTransport, type Fault, type VehicleState } from "../ui/src/platform";

/** 轮询等待条件成立，超时抛错。 */
async function waitFor<T>(probe: () => T | undefined, timeoutMs: number, label: string): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = probe();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`等待超时：${label}`);
    await Bun.sleep(25);
  }
}

const root = join(import.meta.dir, "..");
const workdir = mkdtempSync(join(tmpdir(), "forklift-ui-check-"));
const socketPath = join(workdir, "forklift.sock");
const scenarioPath = join(workdir, "fault.toml");
const logPath = join(workdir, "simulator.log");

// 场景：0ms 立即注入电机过热，用于验证故障链路。
writeFileSync(scenarioPath, '[[step]]\nat_ms = 0\nfault = "motor_overheat"\n');

// 子进程输出写入日志文件而不是继承管道：继承会让外层命令等子进程退出。
const logFd = openSync(logPath, "w");
const child = Bun.spawn(
  [
    "cargo",
    "run",
    "-q",
    "-p",
    "simulator",
    "--",
    "--socket",
    socketPath,
    "--speed",
    "12",
    "--soc",
    "56",
    "--direction",
    "reverse",
    "--scenario",
    scenarioPath,
  ],
  { cwd: root, stdout: logFd, stderr: logFd },
);
closeSync(logFd);
console.log(`ui-sim-check: simulator pid=${child.pid}`);

let exitCode = 0;
try {
  // 1) 等待模拟器创建 socket（首次运行包含 cargo 编译时间）。
  await waitFor(() => (existsSync(socketPath) ? true : undefined), 120_000, "simulator socket");
  console.log("ui-sim-check: socket 就绪");

  // 2) 平台层握手。
  const platform = createPlatform(new UnixTransport(socketPath));
  await platform.connect();

  // 3) 车辆状态：速度/电量/方向与命令行一致。
  const state = await waitFor<VehicleState>(
    () => platform.vehicle.snapshot(),
    5_000,
    "vehicle state",
  );
  if (Math.abs(state.speedKph.value - 12) > 0.01) throw new Error(`速度异常：${state.speedKph.value}`);
  if (Math.abs(state.socPercent.value - 56) > 0.01) throw new Error(`电量异常：${state.socPercent.value}`);
  if (state.direction.value !== "reverse") throw new Error(`方向异常：${state.direction.value}`);
  if (!state.canOnline) throw new Error("CAN 未在线");
  console.log(
    `ui-sim-check: 状态 OK speed=${state.speedKph.value} soc=${state.socPercent.value} direction=${state.direction.value}`,
  );

  // 4) 故障：场景在连接前就可能已触发，因此同时看快照与事件。
  const faultId = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("等待故障超时")), 5_000);
    const fromSnapshot = (faults: readonly Fault[]): void => {
      const fault = faults.find((item) => item.id === 0x0001 && item.active);
      if (fault !== undefined) {
        clearTimeout(timer);
        resolve(fault.id);
      }
    };
    platform.faults.subscribe((snapshot) => fromSnapshot(snapshot.faults));
    platform.faults.subscribeEvent((event) => {
      if (event.kind === "raised") {
        clearTimeout(timer);
        resolve(event.fault.id);
      }
    });
  });
  if (faultId !== 0x0001) throw new Error(`故障 id 异常：0x${faultId.toString(16)}`);
  console.log(`ui-sim-check: 故障 OK id=0x${faultId.toString(16)}`);

  // 5) PING 往返。
  const nonce = await platform.ping(0x4d4d_0001);
  if (nonce !== 0x4d4d_0001) throw new Error(`PONG nonce 异常：${nonce}`);
  console.log("ui-sim-check: PING OK");

  platform.audio.play("button");
  platform.audio.setVolume(50);
  platform.system.setBrightness(80);
  console.log("ui-sim-check: 命令已发送");

  platform.close();
  console.log("ui-sim-check: PASS");
} catch (error) {
  console.error(`ui-sim-check: FAIL - ${String(error)}`);
  console.error("--- simulator.log ---");
  console.error(readFileSync(logPath, "utf8").trim());
  exitCode = 1;
} finally {
  child.kill();
  await child.exited;
  rmSync(workdir, { recursive: true, force: true });
}
process.exit(exitCode);
