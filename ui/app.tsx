// 应用外壳：构造平台 API，先走开机自检，再按页签路由到各屏。
// Mock 数据由 onFrame 逐帧驱动（QuickJS 无 setInterval）。
// 屏幕始终挂载：连接过程不阻塞首帧，数据未到时显示占位。
// D211 宿主 bridge 接通后，这里替换为宿主注入的传输。

import { createSignal, Match, onCleanup, onMount, Show, Switch } from "solid-js";
import { View } from "@pocketjs/framework/components";
import { onFrame } from "@pocketjs/framework/lifecycle";

import type { TabId } from "./src/nav/nav";
import { createPlatform, MockTransport } from "./src/platform";
import { createDeviceEffects } from "./src/platform/effects";
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
  const transport = new MockTransport({
    effects: {
      playSound: () => effects.playButton(),
      setVolume: (volume) => effects.setVolume(volume),
      setBrightness: (brightness) => effects.setBrightness(brightness),
    },
  });
  const platform = createPlatform(transport);
  const [booted, setBooted] = createSignal(false);
  const [tab, setTab] = createSignal<TabId>("home");
  const [charging, setCharging] = createSignal(false);
  const [removed, setRemoved] = createSignal(false);
  const [cameraOpen, setCameraOpen] = createSignal(false);

  onMount(() => {
    const unsubscribe = platform.vehicle.subscribe((state) => {
      setCharging(state.charging.quality === "valid" && state.charging.value);
      setRemoved(state.antiDismantle.quality === "valid" && state.antiDismantle.value);
    });
    onCleanup(unsubscribe);
    platform.connect().catch((error: unknown) => {
      console.warn(`forklift: 平台连接失败：${String(error)}`);
    });
  });

  onFrame(() => {
    transport.tick();
    effects.pump();
  });

  /** 页签路由。 */
  const navigate = (next: TabId): void => {
    setTab(next);
  };

  return (
    <>
      <Switch>
      {/* 充电条件优先于自检与页签（与参考主循环的条件检测一致）。 */}
      <Match when={charging()}>
        <ChargingScreen platform={platform} />
      </Match>
      <Match when={!booted()}>
        <SelfCheckScreen platform={platform} onEnter={() => setBooted(true)} />
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
