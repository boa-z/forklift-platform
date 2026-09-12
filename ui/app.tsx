// 应用外壳：构造平台 API 并挂载主屏。
// Mock 数据由 onFrame 逐帧驱动（QuickJS 无 setInterval）。
// 主屏始终挂载：连接过程不阻塞首帧，数据未到时显示占位。
// D211 宿主 bridge 接通后，这里替换为宿主注入的传输。

import { onMount } from "solid-js";
import { onFrame } from "@pocketjs/framework/lifecycle";

import { createPlatform, MockTransport } from "./src/platform";
import MainScreen from "./src/screens/main/MainScreen";

/** 叉车仪表应用根组件。 */
export default function ForkliftApp() {
  const transport = new MockTransport();
  const platform = createPlatform(transport);

  onMount(() => {
    void platform.connect();
  });

  onFrame(() => {
    transport.tick();
  });

  return <MainScreen platform={platform} />;
}
