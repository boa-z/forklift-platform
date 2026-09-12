// 应用外壳：构造平台 API 并挂载主屏。
// Mock 数据由 onFrame 逐帧驱动（QuickJS 无 setInterval）。
// D211 宿主 bridge 接通后，这里替换为宿主注入的传输。

import { createSignal, onMount, Show } from "solid-js";
import { View } from "@pocketjs/framework/components";
import { onFrame } from "@pocketjs/framework/lifecycle";

import { createPlatform, MockTransport } from "./src/platform";
import MainScreen from "./src/screens/main/MainScreen";

/** 叉车仪表应用根组件。 */
export default function ForkliftApp() {
  const transport = new MockTransport();
  const platform = createPlatform(transport);
  const [ready, setReady] = createSignal(false);

  onMount(() => {
    void platform.connect().then(() => setReady(true));
  });

  onFrame(() => {
    if (ready()) transport.tick();
  });

  return (
    <Show
      when={ready()}
      fallback={<View class="w-full h-full bg-[#080304]" />}
    >
      <MainScreen platform={platform} />
    </Show>
  );
}
