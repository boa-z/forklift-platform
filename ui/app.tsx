// 应用外壳：构造平台 API，先走开机自检，再按页签路由到各屏。
// Mock 数据由 onFrame 逐帧驱动（QuickJS 无 setInterval）。
// 屏幕始终挂载：连接过程不阻塞首帧，数据未到时显示占位。
// D211 宿主 bridge 接通后，这里替换为宿主注入的传输。

import { createSignal, Match, onCleanup, onMount, Switch } from "solid-js";
import { onFrame } from "@pocketjs/framework/lifecycle";

import type { TabId } from "./src/nav/nav";
import { createPlatform, MockTransport } from "./src/platform";
import FaultScreen from "./src/screens/fault/FaultScreen";
import ChargingScreen from "./src/screens/charging/ChargingScreen";
import MainScreen from "./src/screens/main/MainScreen";
import MonitorScreen from "./src/screens/monitor/MonitorScreen";
import SelfCheckScreen from "./src/screens/selfcheck/SelfCheckScreen";
import SetScreen from "./src/screens/set/SetScreen";

/** 叉车仪表应用根组件。 */
export default function ForkliftApp() {
  const transport = new MockTransport();
  const platform = createPlatform(transport);
  const [booted, setBooted] = createSignal(false);
  const [tab, setTab] = createSignal<TabId>("home");
  const [charging, setCharging] = createSignal(false);

  onMount(() => {
    const unsubscribe = platform.vehicle.subscribe((state) => {
      setCharging(state.charging.quality === "valid" && state.charging.value);
    });
    onCleanup(unsubscribe);
    platform.connect().catch((error: unknown) => {
      console.warn(`forklift: 平台连接失败：${String(error)}`);
    });
  });

  onFrame(() => {
    transport.tick();
  });

  /** 页签路由。 */
  const navigate = (next: TabId): void => {
    setTab(next);
  };

  return (
    <Switch>
      {/* 充电条件优先于自检与页签（与参考主循环的条件检测一致）。 */}
      <Match when={charging()}>
        <ChargingScreen platform={platform} />
      </Match>
      <Match when={!booted()}>
        <SelfCheckScreen platform={platform} onEnter={() => setBooted(true)} />
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
        <MainScreen platform={platform} onNavigate={navigate} />
      </Match>
    </Switch>
  );
}
