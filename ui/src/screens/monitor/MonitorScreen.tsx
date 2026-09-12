// 监控屏：菜单树来自 data.bin（menu.gen.ts），分页与钻取与参考界面一致。
// 名称按语言表下标显示；SDO 值等待 CAN/SDO 后端接入，当前显示 `--`。

import { createMemo, createSignal, For } from "solid-js";
import { Image, Text, View } from "@pocketjs/framework/components";

import BottomNav from "../../components/BottomNav";
import ReturnButton from "../../components/ReturnButton";
import ScreenBackground from "../../components/ScreenBackground";
import { t, tIndex } from "../../i18n";
import type { TabId } from "../../nav/nav";
import type { Platform } from "../../platform";
import { playButton } from "../../platform/feedback";
import { CLASS, SCREEN_CLASS, TITLE_CLASS } from "../../theme/theme";
import { BAKED } from "../main/assets.gen";
import { MONITOR } from "./layout";
import { MONITOR_TREE } from "./menu.gen";
import { MONITOR_PAGE_SIZE, clampMonitorPage, monitorPageCount, type MonitorNode } from "./tree";

/** 监控屏组件。 */
export default function MonitorScreen(props: { platform: Platform; onNavigate: (tab: TabId) => void }) {
  // 菜单路径：栈顶为当前层，根节点始终在栈底。
  const [stack, setStack] = createSignal<MonitorNode[]>([MONITOR_TREE]);
  const [page, setPage] = createSignal(0);

  /** 当前层节点。 */
  const current = createMemo<MonitorNode>(() => stack()[stack().length - 1] ?? MONITOR_TREE);

  /** 当前层条目与分页。 */
  const items = createMemo<MonitorNode[]>(() => current().children);
  const pages = createMemo<number>(() => monitorPageCount(items().length));
  const currentPage = createMemo<number>(() => clampMonitorPage(page(), items().length));
  const pageItems = createMemo<MonitorNode[]>(() => {
    const start = currentPage() * MONITOR_PAGE_SIZE;
    return items().slice(start, start + MONITOR_PAGE_SIZE);
  });

  /** 标题：根层为 CAN 协议，子层为节点名。 */
  const title = createMemo<string>(() =>
    stack().length <= 1 ? t("JCLIB_LAN_CAN_PROTOCOL") : tIndex(current().nameIndex),
  );

  /** 翻页。 */
  const turnPage = (delta: number): void => {
    playButton(props.platform);
    setPage(clampMonitorPage(page() + delta, items().length));
  };

  /** 进入子菜单；SDO 叶子暂不支持读写。 */
  const activate = (node: MonitorNode): void => {
    playButton(props.platform);
    if (node.kind !== "menu" || node.children.length === 0) return;
    setStack([...stack(), node]);
    setPage(0);
  };

  /** 返回：先回上级菜单，根层回到主屏。 */
  const back = (): void => {
    playButton(props.platform);
    if (stack().length > 1) {
      setStack(stack().slice(0, -1));
      setPage(0);
      return;
    }
    props.onNavigate("home");
  };

  /** SDO 值文本（后端未接入前显示占位）。 */
  const sdoValue = (node: MonitorNode): string => (node.kind === "sdo" ? "--" : "");

  return (
    <View class={SCREEN_CLASS}>
      <ScreenBackground id="menu" />
      <ReturnButton onPress={back} />

      <Text class={TITLE_CLASS} style={{ translateX: MONITOR.title.x, translateY: MONITOR.title.y, width: MONITOR.title.w, height: MONITOR.title.h }}>
        {title()}
      </Text>

      {/* 翻页控件 */}
      <View class="absolute left-0 top-0" style={{ translateX: MONITOR.pageLeft.x, translateY: MONITOR.pageLeft.y, width: MONITOR.pageLeft.w, height: MONITOR.pageLeft.h }} focusable onPress={() => turnPage(-1)}>
        <Image src={BAKED["005_menu_data_page_left"].src} class="absolute left-0 top-0" style={{ translateX: Math.round((MONITOR.pageLeft.w - BAKED["005_menu_data_page_left"].w) / 2), translateY: Math.round((MONITOR.pageLeft.h - BAKED["005_menu_data_page_left"].h) / 2), width: BAKED["005_menu_data_page_left"].w, height: BAKED["005_menu_data_page_left"].h }} />
      </View>
      <Text class={CLASS.pageLabel} style={{ translateX: MONITOR.pageLabel.x, translateY: MONITOR.pageLabel.y, width: MONITOR.pageLabel.w, height: MONITOR.pageLabel.h }}>
        {`${currentPage() + 1}/${pages()}`}
      </Text>
      <View class="absolute left-0 top-0" style={{ translateX: MONITOR.pageRight.x, translateY: MONITOR.pageRight.y, width: MONITOR.pageRight.w, height: MONITOR.pageRight.h }} focusable onPress={() => turnPage(1)}>
        <Image src={BAKED["005_menu_data_page_right"].src} class="absolute left-0 top-0" style={{ translateX: Math.round((MONITOR.pageRight.w - BAKED["005_menu_data_page_right"].w) / 2), translateY: Math.round((MONITOR.pageRight.h - BAKED["005_menu_data_page_right"].h) / 2), width: BAKED["005_menu_data_page_right"].w, height: BAKED["005_menu_data_page_right"].h }} />
      </View>

      {/* 内容区 */}
      <View class="absolute left-0 top-0" style={{ translateX: MONITOR.content.x, translateY: MONITOR.content.y, width: MONITOR.content.w, height: MONITOR.content.h }}>
        <For each={pageItems()}>
          {(node, index) => (
            <View class="absolute left-0 top-0" style={{ translateX: MONITOR.row.x, translateY: index() * MONITOR.row.stepY, width: MONITOR.row.w, height: MONITOR.row.h }} focusable onPress={() => activate(node)}>
              <Image src={BAKED["004_menu_data_bg"].src} class="absolute left-0 top-0" style={{ translateX: 0, translateY: 0, width: BAKED["004_menu_data_bg"].w, height: BAKED["004_menu_data_bg"].h }} />
              <Text class={CLASS.rowIndex} style={{ translateX: MONITOR.indexX, translateY: 16, width: 60, height: MONITOR.row.h }}>
                {String(currentPage() * MONITOR_PAGE_SIZE + index() + 1).padStart(2, "0")}
              </Text>
              <Text class={CLASS.rowText} style={{ translateX: MONITOR.nameX, translateY: 16, width: 280, height: MONITOR.row.h }}>
                {tIndex(node.nameIndex)}
              </Text>
              <Text class={CLASS.rowValue} style={{ translateX: MONITOR.valueX + 80, translateY: 16, width: 120, height: MONITOR.row.h }}>
                {sdoValue(node)}
              </Text>
            </View>
          )}
        </For>
      </View>

      <BottomNav active="monitor" onNavigate={props.onNavigate} onPress={() => playButton(props.platform)} />
    </View>
  );
}
