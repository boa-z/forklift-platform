// 设置屏：按参考 LvglSetScreen.c 复刻左列三菜单与分页内容。
// 菜单文案用 JCLIB_LAN_* 语言键经 i18n 解析（语言表来自 data.bin）；
// 子对话框（语言、亮度、音量等）未实现，条目点击仅提示音。

import { createMemo, createSignal, For } from "solid-js";
import { Image, Text, View } from "@pocketjs/framework/components";

import BottomNav from "../../components/BottomNav";
import ReturnButton from "../../components/ReturnButton";
import ScreenBackground from "../../components/ScreenBackground";
import { t, type LanKey } from "../../i18n";
import type { TabId } from "../../nav/nav";
import type { Platform } from "../../platform";
import { playButton } from "../../platform/feedback";
import { CLASS, SCREEN_CLASS, TITLE_CLASS } from "../../theme/theme";
import { BAKED } from "../main/assets.gen";
import { SET, SET_MENUS, clampMenuPage } from "./layout";

/** 设置屏组件。 */
export default function SetScreen(props: { platform: Platform; onNavigate: (tab: TabId) => void }) {
  const [menuIndex, setMenuIndex] = createSignal(0);
  const [page, setPage] = createSignal(0);

  /** 当前菜单。 */
  const menu = createMemo(() => SET_MENUS[menuIndex()] ?? SET_MENUS[0]);

  /** 当前页条目。 */
  const rows = createMemo<readonly LanKey[]>(() => {
    const pages = menu()?.pages ?? [];
    return pages[clampMenuPage(page(), pages.length)] ?? [];
  });

  /** 选择左列菜单。 */
  const selectMenu = (index: number): void => {
    playButton(props.platform);
    setMenuIndex(index);
    setPage(0);
  };

  /** 翻页。 */
  const turnPage = (delta: number): void => {
    playButton(props.platform);
    setPage(clampMenuPage(page() + delta, menu()?.pages.length ?? 1));
  };

  /** 返回主屏。 */
  const goHome = (): void => {
    playButton(props.platform);
    props.onNavigate("home");
  };

  return (
    <View class={SCREEN_CLASS}>
      <ScreenBackground id="menu" />
      <ReturnButton onPress={goHome} />

      {/* 左列菜单 */}
      <For each={SET_MENUS}>
        {(item, index) => (
          <View
            class="absolute left-0 top-0"
            style={{ translateX: SET.menuItem.x, translateY: item.y, width: SET.menuItem.w, height: SET.menuItem.h }}
            focusable
            onPress={() => selectMenu(index())}
          >
            <Image
              src={menuIndex() === index() ? BAKED["002_menu_item_select_bg"].src : BAKED["002_menu_item_bg"].src}
              class="absolute left-0 top-0"
              style={menuIndex() === index()
                ? { translateX: 0, translateY: 0, width: BAKED["002_menu_item_select_bg"].w, height: BAKED["002_menu_item_select_bg"].h }
                : { translateX: 0, translateY: 2, width: BAKED["002_menu_item_bg"].w, height: BAKED["002_menu_item_bg"].h }}
            />
            <Text class={CLASS.menuItemText} style={{ translateX: 0, translateY: 20, width: SET.menuItem.w, height: 32 }}>
              {t(item.titleKey)}
            </Text>
          </View>
        )}
      </For>

      {/* 标题与翻页 */}
      <Text class={TITLE_CLASS} style={{ translateX: SET.title.x, translateY: SET.title.y, width: SET.title.w, height: SET.title.h }}>
        {menu() === undefined ? "" : t(menu()?.titleKey ?? "JCLIB_LAN_USER_SETTINGS")}
      </Text>
      <View class="absolute left-0 top-0" style={{ translateX: SET.pageLeft.x, translateY: SET.pageLeft.y, width: SET.pageLeft.w, height: SET.pageLeft.h }} focusable onPress={() => turnPage(-1)}>
        <Image src={BAKED["005_menu_data_page_left"].src} class="absolute left-0 top-0" style={{ translateX: Math.round((SET.pageLeft.w - BAKED["005_menu_data_page_left"].w) / 2), translateY: Math.round((SET.pageLeft.h - BAKED["005_menu_data_page_left"].h) / 2), width: BAKED["005_menu_data_page_left"].w, height: BAKED["005_menu_data_page_left"].h }} />
      </View>
      <Text class={CLASS.pageLabel} style={{ translateX: SET.pageLabel.x, translateY: SET.pageLabel.y, width: SET.pageLabel.w, height: SET.pageLabel.h }}>
        {`${clampMenuPage(page(), menu()?.pages.length ?? 1) + 1}/${menu()?.pages.length ?? 1}`}
      </Text>
      <View class="absolute left-0 top-0" style={{ translateX: SET.pageRight.x, translateY: SET.pageRight.y, width: SET.pageRight.w, height: SET.pageRight.h }} focusable onPress={() => turnPage(1)}>
        <Image src={BAKED["005_menu_data_page_right"].src} class="absolute left-0 top-0" style={{ translateX: Math.round((SET.pageRight.w - BAKED["005_menu_data_page_right"].w) / 2), translateY: Math.round((SET.pageRight.h - BAKED["005_menu_data_page_right"].h) / 2), width: BAKED["005_menu_data_page_right"].w, height: BAKED["005_menu_data_page_right"].h }} />
      </View>

      {/* 内容区 */}
      <View class="absolute left-0 top-0" style={{ translateX: SET.content.x, translateY: SET.content.y, width: SET.content.w, height: SET.content.h }}>
        <For each={rows()}>
          {(key, index) => (
            <View class="absolute left-0 top-0" style={{ translateX: SET.row.x, translateY: index() * SET.row.stepY + SET.row.insetY, width: SET.row.w, height: SET.row.bgH }} focusable onPress={() => playButton(props.platform)}>
              <Image src={BAKED["004_menu_data_bg"].src} class="absolute left-0 top-0" style={{ translateX: 0, translateY: 0, width: BAKED["004_menu_data_bg"].w, height: BAKED["004_menu_data_bg"].h }} />
              <Text class={CLASS.rowText} style={{ translateX: SET.rowTextX, translateY: 16, width: SET.row.w - SET.rowTextX * 2, height: 32 }}>
                {t(key)}
              </Text>
            </View>
          )}
        </For>
      </View>

      <BottomNav active="set" onNavigate={props.onNavigate} onPress={() => playButton(props.platform)} />
    </View>
  );
}
