// 故障诊断屏：按参考 LvglFaultScreen.c 复刻，数据来自 platform.faults。
// 标题与空状态文案来自 data.bin 语言表；行文案按故障码查参考故障表，
// 未收录的码回退为 `F 编号`。每页 4 行。

import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { Image, Text, View } from "@pocketjs/framework/components";

import BottomNav from "../../components/BottomNav";
import { faultText, t } from "../../i18n";
import type { TabId } from "../../nav/nav";
import type { Fault, FaultSnapshot, Platform } from "../../platform";
import { playButton } from "../../platform/feedback";
import { CLASS, PAGE_BUTTON_CLASS, ROW_CLASS, SCREEN_CLASS } from "../../theme/theme";
import { BAKED, type BakedAsset } from "../main/assets.gen";
import { FAULT, clampFaultPage, faultPageCount, faultRowText } from "./layout";

/** 素材在槽位内居中的绝对位置。 */
function centeredAt(asset: BakedAsset, x: number, y: number, w: number, h: number): Record<string, number> {
  const baked = BAKED[asset];
  return {
    translateX: x + Math.round((w - baked.w) / 2),
    translateY: y + Math.round((h - baked.h) / 2),
    width: baked.w,
    height: baked.h,
  };
}

/** 故障屏组件。 */
export default function FaultScreen(props: { platform: Platform; onNavigate: (tab: TabId) => void }) {
  const [snapshot, setSnapshot] = createSignal<FaultSnapshot>({ timestampMs: 0, faults: [] });
  const [page, setPage] = createSignal(0);

  onMount(() => {
    const unsubscribe = props.platform.faults.subscribe(setSnapshot);
    onCleanup(unsubscribe);
  });

  /** 活动故障列表（按编号排序）。 */
  const activeFaults = createMemo<Fault[]>(() =>
    snapshot()
      .faults.filter((fault) => fault.active)
      .sort((a, b) => a.id - b.id),
  );

  /** 总页数。 */
  const pageCount = createMemo<number>(() => faultPageCount(activeFaults().length));

  /** 当前页（夹取后的页码与行）。 */
  const currentPage = createMemo<number>(() => clampFaultPage(page(), activeFaults().length));
  const pageRows = createMemo<Fault[]>(() => {
    const start = currentPage() * FAULT.rowsPerPage;
    return activeFaults().slice(start, start + FAULT.rowsPerPage);
  });

  /** 翻页（夹取到有效范围）。 */
  const turnPage = (delta: number): void => {
    playButton(props.platform);
    setPage(clampFaultPage(page() + delta, activeFaults().length));
  };

  /** 行背景：严重故障用红色，其余用常规行底色。 */
  const rowClass = (fault: Fault): string =>
    fault.severity === "critical" ? ROW_CLASS.critical : ROW_CLASS.normal;

  /** 行文案：优先参考故障表，未收录显示 `F 编号  严重度`。 */
  const rowText = (fault: Fault): string => {
    const text = faultText(fault.id);
    return text === "" ? faultRowText(fault.id, fault.severity, fault.occurrenceCount) : text;
  };

  return (
    <View class={SCREEN_CLASS}>
      <Text class={CLASS.screenTitle} style={{ translateX: FAULT.title.x, translateY: FAULT.title.y, width: FAULT.title.w, height: FAULT.title.h }}>
        {t("JCLIB_LAN_FAULT_DIAGNOSIS")}
      </Text>

      {/* 翻页控件 */}
      <View class={PAGE_BUTTON_CLASS} style={{ translateX: FAULT.pageLeft.x, translateY: FAULT.pageLeft.y, width: FAULT.pageLeft.w, height: FAULT.pageLeft.h }} focusable onPress={() => turnPage(-1)}>
        <Image src={BAKED["004menuLeft"].src} class="absolute left-0 top-0" style={centeredAt("004menuLeft", 0, 0, FAULT.pageLeft.w, FAULT.pageLeft.h)} />
      </View>
      <Text class={CLASS.pageLabel} style={{ translateX: FAULT.pageLabel.x, translateY: FAULT.pageLabel.y, width: FAULT.pageLabel.w, height: FAULT.pageLabel.h }}>
        {`${currentPage() + 1}/${pageCount()}`}
      </Text>
      <View class={PAGE_BUTTON_CLASS} style={{ translateX: FAULT.pageRight.x, translateY: FAULT.pageRight.y, width: FAULT.pageRight.w, height: FAULT.pageRight.h }} focusable onPress={() => turnPage(1)}>
        <Image src={BAKED["005menuRight"].src} class="absolute left-0 top-0" style={centeredAt("005menuRight", 0, 0, FAULT.pageRight.w, FAULT.pageRight.h)} />
      </View>

      {/* 故障行文本 */}
      <For each={pageRows()}>
        {(fault, index) => (
          <View class={rowClass(fault)} style={{ translateX: FAULT.rowLabel.x, translateY: FAULT.rowY[index()] ?? FAULT.rowY[0], width: FAULT.rowLabel.w, height: FAULT.rowLabel.h }}>
            <Text class={CLASS.rowText} style={{ translateX: 12, translateY: 16, width: FAULT.rowLabel.w - 24, height: FAULT.rowLabel.h }}>
              {rowText(fault)}
            </Text>
          </View>
        )}
      </For>

      {/* 故障行图标（行槽右侧） */}
      <For each={pageRows()}>
        {(_fault, index) => (
          <Image
            src={BAKED["003errorWarning"].src}
            class="absolute left-0 top-0"
            style={centeredAt("003errorWarning", FAULT.rowIcon.x, FAULT.rowY[index()] ?? FAULT.rowY[0], FAULT.rowIcon.w, FAULT.rowIcon.h)}
          />
        )}
      </For>

      <Show when={activeFaults().length === 0}>
        <Text class={CLASS.emptyText} style={{ translateX: FAULT.empty.x, translateY: FAULT.empty.y, width: FAULT.empty.w, height: FAULT.empty.h }}>
          {t("JCLIB_LAN_NO_RELATED_FAULT")}
        </Text>
      </Show>

      <BottomNav active="fault" onNavigate={props.onNavigate} onPress={() => playButton(props.platform)} />
    </View>
  );
}
