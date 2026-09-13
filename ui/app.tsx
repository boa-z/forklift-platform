// 应用外壳：构造平台 API，先走开机自检，再按页签路由到各屏。
// Mock 数据由 onFrame 逐帧驱动（QuickJS 无 setInterval）。
// 屏幕始终挂载：连接过程不阻塞首帧，数据未到时显示占位。
// D211 宿主 bridge 接通后，这里替换为宿主注入的传输。

import { createSignal, Match, onCleanup, onMount, Show, Switch } from "solid-js";
import { View } from "@pocketjs/framework/components";
import { onFrame } from "@pocketjs/framework/lifecycle";

import type { TabId } from "./src/nav/nav";
import { initialBootStage, stageAfterSelfCheck, type BootStage } from "./src/boot";
import { AlarmEngine, type AlarmInputs } from "./src/platform/alarms";
import { ipcHost } from "@pocketjs/framework/ipc";

import { createPlatform, MockTransport, type Transport } from "./src/platform";
import { createDeviceEffects } from "./src/platform/effects";
import { IpcTransport } from "./src/platform/ipc";
import { applySettingsFlags, getAuthorizationEnabled, getSelfCheckEnabled } from "./src/settings";
import AuthorizationScreen from "./src/screens/authorization/AuthorizationScreen";
import CameraScreen from "./src/screens/camera/CameraScreen";
import FaultScreen from "./src/screens/fault/FaultScreen";
import ChargingScreen from "./src/screens/charging/ChargingScreen";
import MainScreen from "./src/screens/main/MainScreen";
import MonitorScreen from "./src/screens/monitor/MonitorScreen";
import SelfCheckScreen from "./src/screens/selfcheck/SelfCheckScreen";
import SetScreen from "./src/screens/set/SetScreen";

/** 叉车仪表应用根组件。 */
export default function ForkliftApp() {
  const effects = createDeviceEffects();
  // 设备（PocketJS ipc 宿主模块在位）连 forkliftd；开发/金样退回内存 Mock。
  const ipc = ipcHost();
  const transport: Transport =
    ipc !== null
      ? new IpcTransport(ipc, "/run/forklift/forkliftd.sock")
      : new MockTransport({
          effects: {
            playSound: (sound) => effects.playSound(sound),
            setVolume: (volume) => effects.setVolume(volume),
            setBrightness: (brightness) => effects.setBrightness(brightness),
          },
        });
  const platform = createPlatform(transport);
  const [stage, setStage] = createSignal<BootStage | "loading">("loading");
  const [tab, setTab] = createSignal<TabId>("home");
  const [charging, setCharging] = createSignal(false);
  const [removed, setRemoved] = createSignal(false);
  const [cameraOpen, setCameraOpen] = createSignal(false);
  // 报警引擎：订阅车辆/故障，逐帧（内部 50ms 补拍）生成语音请求。
  const alarms = new AlarmEngine();
  let alarmInputs: AlarmInputs = {
    faultActive: false,
    speedKph: undefined,
    direction: undefined,
    seatbelt: undefined,
    seatSwitch: undefined,
    parkingBrake: undefined,
  };
  let lastFrameMs = Date.now();

  onMount(() => {
    const unsubscribe = platform.vehicle.subscribe((state) => {
      setCharging(state.charging.quality === "valid" && state.charging.value);
      setRemoved(state.antiDismantle.quality === "valid" && state.antiDismantle.value);
      alarmInputs = {
        faultActive: alarmInputs.faultActive,
        speedKph: state.speedKph.quality === "valid" ? state.speedKph.value : undefined,
        direction: state.direction.quality === "valid" ? state.direction.value : undefined,
        seatbelt: state.seatbelt.quality === "valid" ? state.seatbelt.value : undefined,
        seatSwitch: state.seatSwitch.quality === "valid" ? state.seatSwitch.value : undefined,
        parkingBrake: state.parkingBrake.quality === "valid" ? state.parkingBrake.value : undefined,
      };
    });
    const unsubscribeFaults = platform.faults.subscribe((snapshot) => {
      alarmInputs = {
        ...alarmInputs,
        faultActive: snapshot.faults.some((fault) => fault.active),
      };
    });
    onCleanup(() => {
      unsubscribe();
      unsubscribeFaults();
    });
    platform.connect()
      .then(async () => {
        // 先取 daemon 的设置位域（失败时用默认值），再决定开机阶段。
        try {
          applySettingsFlags(await platform.settings.get());
        } catch {
          applySettingsFlags(0b0010);
        }
        setStage(initialBootStage(getSelfCheckEnabled(), getAuthorizationEnabled()));
        platform.audio.play("startup");
      })
      .catch((error: unknown) => {
        console.warn(`forklift: 平台连接失败：${String(error)}`);
        setStage(initialBootStage(getSelfCheckEnabled(), getAuthorizationEnabled()));
      });
  });

  onFrame(() => {
    transport.pump?.();
    transport.tick?.();
    const now = Date.now();
    alarms.tick(now - lastFrameMs, alarmInputs, safePlay);
    lastFrameMs = now;
    effects.pump();
  });

  /** 报警/提示音播放：连接建立前忽略（回调异常会中断帧循环）。 */
  const safePlay = (id: Parameters<typeof platform.audio.play>[0]): void => {
    try {
      platform.audio.play(id);
    } catch {
      // 连接建立前忽略。
    }
  };

  /** 页签路由。 */
  const navigate = (next: TabId): void => {
    setTab(next);
  };

  return (
    <>
      <Switch>
      {/* 设置读取中：黑屏一帧，避免闪错屏。 */}
      <Match when={stage() === "loading"}>
        <View class="absolute left-0 top-0 bg-[#000000]" style={{ translateX: 0, translateY: 0, width: 800, height: 480 }} />
      </Match>
      {/* 充电条件优先于自检与页签（与参考主循环的条件检测一致）。 */}
      <Match when={charging()}>
        <ChargingScreen platform={platform} />
      </Match>
      <Match when={stage() === "selfcheck"}>
        <SelfCheckScreen
          platform={platform}
          onEnter={() => setStage(stageAfterSelfCheck(getAuthorizationEnabled()))}
        />
      </Match>
      {/* 授权屏（默认开启）：刷卡/密码授权通过后进入主界面 */}
      <Match when={stage() === "authorization"}>
        <AuthorizationScreen platform={platform} onAuthorized={() => setStage("main")} />
      </Match>
      {/* 相机屏（主屏摄像头按钮进入） */}
      <Match when={cameraOpen()}>
        <CameraScreen platform={platform} onExit={() => setCameraOpen(false)} />
      </Match>
      <Match when={tab() === "monitor"}>
        <MonitorScreen platform={platform} onNavigate={navigate} />
      </Match>
      <Match when={tab() === "fault"}>
        <FaultScreen platform={platform} onNavigate={navigate} />
      </Match>
      <Match when={tab() === "set"}>
        <SetScreen platform={platform} onNavigate={navigate} />
      </Match>
      <Match when={tab() === "home"}>
        <MainScreen platform={platform} onNavigate={navigate} onOpenCamera={() => setCameraOpen(true)} />
      </Match>
      </Switch>

      {/* 防拆卸黑屏：全屏遮挡并吸收触摸（参考 LvglRemovalScreen 的 top layer）。 */}
      <Show when={removed()}>
        <View
          class="absolute left-0 top-0 bg-[#000000]"
          style={{ translateX: 0, translateY: 0, width: 800, height: 480 }}
          focusable
          onPress={() => {}}
        />
      </Show>
    </>
  );
}
