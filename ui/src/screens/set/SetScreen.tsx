// 设置屏：按参考 LvglSetScreen.c 复刻左列三菜单与分页内容。
// 菜单文案用 JCLIB_LAN_* 语言键经 i18n 解析（语言表来自 data.bin）。
// 已实现的子对话框：语言选择、亮度调节、音量调节；其余条目点击仅提示音。

import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { Image, Text, View } from "@pocketjs/framework/components";

import BottomNav from "../../components/BottomNav";
import ReturnButton from "../../components/ReturnButton";
import PasswordScreen from "../password/PasswordScreen";
import { checkPassword } from "../password/model";
import { getAdminPassword, setAdminPassword } from "../../settings";
import ScreenBackground from "../../components/ScreenBackground";
import Slider from "../../components/Slider";
import {
  currentLanguage,
  LANGUAGE_COUNT,
  SELECTABLE_LANGUAGES,
  setLanguage,
  subscribeLanguage,
  t,
  tIndex,
  type LanKey,
  type LanguageCode,
} from "../../i18n";
import type { TabId } from "../../nav/nav";
import type { Platform } from "../../platform";
import { playButton } from "../../platform/feedback";
import { CLASS, SCREEN_CLASS, TITLE_CLASS } from "../../theme/theme";
import { BAKED } from "../main/assets.gen";
import { SET, SET_DIALOG, SET_MENUS, clampMenuPage } from "./layout";

/** 子对话框类型。 */
type DialogId = "none" | "language" | "brightness" | "volume";

/** 设置屏组件。 */
export default function SetScreen(props: { platform: Platform; onNavigate: (tab: TabId) => void }) {
  const [menuIndex, setMenuIndex] = createSignal(0);
  const [page, setPage] = createSignal(0);
  const [dialog, setDialog] = createSignal<DialogId>("none");
  const [brightness, setBrightness] = createSignal<number>(SET_DIALOG.initialBrightness);
  const [volume, setVolume] = createSignal<number>(SET_DIALOG.initialVolume);
  // 密码屏：kind 标记用途；高级设置需要管理员/超级密码，设置管理员密码直接写入。
  const [passwordKind, setPasswordKind] = createSignal<"advanced" | "admin" | null>(null);
  const [adminAuthed, setAdminAuthed] = createSignal(false);
  // 语言切换后刷新本屏文案（其他屏在切入时重新挂载）。
  const [langVersion, setLangVersion] = createSignal(0);

  onMount(() => {
    const unsubscribe = subscribeLanguage(() => setLangVersion((version) => version + 1));
    onCleanup(unsubscribe);
  });

  /** 读取当前语言文案（依赖语言版本信号，切换后本屏刷新）。 */
  const tr = (key: LanKey): string => {
    langVersion();
    return t(key);
  };

  /** 读取语言表中的语言名。 */
  const tri = (index: number): string => {
    langVersion();
    return tIndex(index);
  };

  /** 当前菜单。 */
  const menu = createMemo(() => SET_MENUS[menuIndex()] ?? SET_MENUS[0]);

  /** 当前页条目。 */
  const rows = createMemo<readonly LanKey[]>(() => {
    langVersion();
    const pages = menu()?.pages ?? [];
    return pages[clampMenuPage(page(), pages.length)] ?? [];
  });

  /** 选择左列菜单：高级设置需要密码。 */
  const selectMenu = (index: number): void => {
    playButton(props.platform);
    if (index === 2 && !adminAuthed()) {
      setPasswordKind("advanced");
      return;
    }
    setMenuIndex(index);
    setPage(0);
    setDialog("none");
  };

  /** 密码确认：高级设置放行 / 设置管理员密码。 */
  const submitPassword = (value: string): boolean => {
    const kind = passwordKind();
    if (kind === "admin") {
      if (value.length === 0) return false;
      setAdminPassword(value);
      setPasswordKind(null);
      return true;
    }
    const role = checkPassword(value, getAdminPassword());
    if (role === "none") return false;
    setAdminAuthed(true);
    setMenuIndex(2);
    setPage(0);
    setPasswordKind(null);
    return true;
  };

  /** 翻页。 */
  const turnPage = (delta: number): void => {
    playButton(props.platform);
    setPage(clampMenuPage(page() + delta, menu()?.pages.length ?? 1));
  };

  /** 返回：对话框打开时先关闭，否则回主屏。 */
  const back = (): void => {
    playButton(props.platform);
    if (dialog() !== "none") {
      setDialog("none");
      return;
    }
    props.onNavigate("home");
  };

  /** 行点击：已实现的子对话框打开，其余仅提示音。 */
  const openRow = (key: LanKey): void => {
    playButton(props.platform);
    if (key === "JCLIB_LAN_LANGUAGE_SELECT") setDialog("language");
    else if (key === "JCLIB_LAN_BRIGHTNESS_ADJUST") setDialog("brightness");
    else if (key === "JCLIB_LAN_VOLUME_ADJUST") setDialog("volume");
    else if (key === "JCLIB_LAN_SET_ADMIN_PASSWORD") setPasswordKind("admin");
  };

  /** 对话框标题（参考：打开子页时标题变为子页名）。 */
  const title = createMemo<string>(() => {
    langVersion();
    switch (dialog()) {
      case "language":
        return tr("JCLIB_LAN_LANGUAGE_SELECT");
      case "brightness":
        return tr("JCLIB_LAN_BRIGHTNESS_ADJUST");
      case "volume":
        return tr("JCLIB_LAN_VOLUME_ADJUST");
      default:
        return menu() === undefined ? "" : tr(menu()?.titleKey ?? "JCLIB_LAN_USER_SETTINGS");
    }
  });

  /** 选择语言：可切换的语言立即生效，其余置灰不可选。 */
  const selectLanguage = (code: LanguageCode | null): void => {
    playButton(props.platform);
    if (code === null) return;
    setLanguage(code);
  };

  /** 亮度提交。 */
  const commitBrightness = (value: number): void => {
    setBrightness(value);
    try {
      props.platform.system.setBrightness(value);
    } catch {
      // 连接建立前忽略（与按钮音一致）。
    }
  };

  /** 音量提交。 */
  const commitVolume = (value: number): void => {
    setVolume(value);
    try {
      props.platform.audio.setVolume(value);
    } catch {
      // 连接建立前忽略。
    }
  };

  /** 语言项对应的可切换代码（不可切换为 null）。 */
  const languageCodeAt = (index: number): LanguageCode | null =>
    SELECTABLE_LANGUAGES.find((entry) => entry.nameIndex === index)?.code ?? null;

  // 密码屏为全屏界面（参考实现），覆盖设置屏；用 Show 保持响应式。
  return (
    <Show
      when={passwordKind() === null}
      fallback={
        <PasswordScreen
          platform={props.platform}
          onSubmit={submitPassword}
          onCancel={() => setPasswordKind(null)}
        />
      }
    >
    <View class={SCREEN_CLASS}>
      <ScreenBackground id="menu" />
      <ReturnButton onPress={back} />

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
              src={menuIndex() === index() && dialog() === "none" ? BAKED["002_menu_item_select_bg"].src : BAKED["002_menu_item_bg"].src}
              class="absolute left-0 top-0"
              style={menuIndex() === index() && dialog() === "none"
                ? { translateX: 0, translateY: 0, width: BAKED["002_menu_item_select_bg"].w, height: BAKED["002_menu_item_select_bg"].h }
                : { translateX: 0, translateY: 2, width: BAKED["002_menu_item_bg"].w, height: BAKED["002_menu_item_bg"].h }}
            />
            <Text class={CLASS.menuItemText} style={{ translateX: 0, translateY: 20, width: SET.menuItem.w, height: 32 }}>
              {tr(item.titleKey)}
            </Text>
          </View>
        )}
      </For>

      {/* 标题 */}
      <Text class={TITLE_CLASS} style={{ translateX: SET.title.x, translateY: SET.title.y, width: SET.title.w, height: SET.title.h }}>
        {title()}
      </Text>

      {/* 翻页控件（对话框打开时隐藏，与参考一致） */}
      <Show when={dialog() === "none"}>
        <View class="absolute left-0 top-0" style={{ translateX: SET.pageLeft.x, translateY: SET.pageLeft.y, width: SET.pageLeft.w, height: SET.pageLeft.h }} focusable onPress={() => turnPage(-1)}>
          <Image src={BAKED["005_menu_data_page_left"].src} class="absolute left-0 top-0" style={{ translateX: Math.round((SET.pageLeft.w - BAKED["005_menu_data_page_left"].w) / 2), translateY: Math.round((SET.pageLeft.h - BAKED["005_menu_data_page_left"].h) / 2), width: BAKED["005_menu_data_page_left"].w, height: BAKED["005_menu_data_page_left"].h }} />
        </View>
        <Text class={CLASS.pageLabel} style={{ translateX: SET.pageLabel.x, translateY: SET.pageLabel.y, width: SET.pageLabel.w, height: SET.pageLabel.h }}>
          {`${clampMenuPage(page(), menu()?.pages.length ?? 1) + 1}/${menu()?.pages.length ?? 1}`}
        </Text>
        <View class="absolute left-0 top-0" style={{ translateX: SET.pageRight.x, translateY: SET.pageRight.y, width: SET.pageRight.w, height: SET.pageRight.h }} focusable onPress={() => turnPage(1)}>
          <Image src={BAKED["005_menu_data_page_right"].src} class="absolute left-0 top-0" style={{ translateX: Math.round((SET.pageRight.w - BAKED["005_menu_data_page_right"].w) / 2), translateY: Math.round((SET.pageRight.h - BAKED["005_menu_data_page_right"].h) / 2), width: BAKED["005_menu_data_page_right"].w, height: BAKED["005_menu_data_page_right"].h }} />
        </View>
      </Show>

      {/* 内容区：菜单行或子对话框 */}
      <View class="absolute left-0 top-0" style={{ translateX: SET.content.x, translateY: SET.content.y, width: SET.content.w, height: SET.content.h }}>
        <Show when={dialog() === "none"}>
          <For each={rows()}>
            {(key, index) => (
              <View class="absolute left-0 top-0" style={{ translateX: SET.row.x, translateY: index() * SET.row.stepY + SET.row.insetY, width: SET.row.w, height: SET.row.bgH }} focusable onPress={() => openRow(key)}>
                <Image src={BAKED["004_menu_data_bg"].src} class="absolute left-0 top-0" style={{ translateX: 0, translateY: 0, width: BAKED["004_menu_data_bg"].w, height: BAKED["004_menu_data_bg"].h }} />
                <Text class={CLASS.rowText} style={{ translateX: SET.rowTextX, translateY: 16, width: SET.row.w - SET.rowTextX * 2, height: 32 }}>
                  {tr(key)}
                </Text>
              </View>
            )}
          </For>
        </Show>

        {/* 语言选择：2 列 × 5 行复选框 */}
        <Show when={dialog() === "language"}>
          <For each={Array.from({ length: LANGUAGE_COUNT }, (_, index) => index)}>
            {(index) => {
              const column = Math.floor(index / 5);
              const row = index % 5;
              const code = languageCodeAt(index);
              const selected = (): boolean => code !== null && currentLanguage() === code;
              return (
                <View
                  class="absolute left-0 top-0"
                  style={{
                    translateX: SET_DIALOG.languageItem.x + column * SET_DIALOG.languageItem.colStep,
                    translateY: SET_DIALOG.languageItem.y + row * SET_DIALOG.languageItem.rowStep,
                    width: SET_DIALOG.languageItem.w,
                    height: SET_DIALOG.languageItem.h,
                  }}
                  focusable
                  onPress={() => selectLanguage(code)}
                >
                  <Image src={BAKED.checkboxbg_186x44.src} class="absolute left-0 top-0" style={{ translateX: 0, translateY: 0, width: BAKED.checkboxbg_186x44.w, height: BAKED.checkboxbg_186x44.h }} />
                  <Text class={code === null ? CLASS.dialogLabelDisabled : CLASS.dialogLabel} style={{ translateX: SET_DIALOG.languageItem.labelX, translateY: SET_DIALOG.languageItem.labelY, width: 110, height: 26 }}>
                    {tri(index)}
                  </Text>
                  <Image
                    src={selected() ? BAKED.lauageset_ok.src : BAKED.lauageset_null.src}
                    class="absolute left-0 top-0"
                    style={{ translateX: SET_DIALOG.languageItem.checkX, translateY: SET_DIALOG.languageItem.checkY, width: BAKED.lauageset_ok.w, height: BAKED.lauageset_ok.h }}
                  />
                </View>
              );
            }}
          </For>
        </Show>

        {/* 亮度/音量：滑条 + 百分比 */}
        <Show when={dialog() === "brightness" || dialog() === "volume"}>
          <Slider
            x={SET_DIALOG.slider.x}
            y={SET_DIALOG.slider.y}
            regionX={SET.content.x + SET_DIALOG.slider.x}
            regionY={SET.content.y + SET_DIALOG.slider.y}
            width={SET_DIALOG.slider.w}
            value={dialog() === "brightness" ? brightness() : volume()}
            onInput={(value) => (dialog() === "brightness" ? setBrightness(value) : setVolume(value))}
            onCommit={(value) => (dialog() === "brightness" ? commitBrightness(value) : commitVolume(value))}
          />
          <Text class={CLASS.dialogValue} style={{ translateX: SET_DIALOG.valueLabel.x, translateY: SET_DIALOG.valueLabel.y, width: SET_DIALOG.valueLabel.w, height: SET_DIALOG.valueLabel.h }}>
            {`${dialog() === "brightness" ? brightness() : volume()}%`}
          </Text>
        </Show>
      </View>

      <BottomNav active="set" onNavigate={props.onNavigate} onPress={() => playButton(props.platform)} />
    </View>
    </Show>
  );
}
