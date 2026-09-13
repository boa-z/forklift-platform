// 开机阶段与授权状态模型测试。

import { describe, expect, test } from "bun:test";

import { initialBootStage, stageAfterSelfCheck } from "../src/boot";
import {
  BLUETOOTH_CARD,
  phaseForSwipe,
  powerOnKindForCard,
  SWIPE_STATUS,
  swipeStatusKey,
} from "../src/screens/authorization/model";

describe("开机阶段", () => {
  test("默认：自检关、授权开 → 直接进授权屏", () => {
    expect(initialBootStage(false, true)).toBe("authorization");
  });

  test("自检开启时自检优先，结束后再进授权", () => {
    expect(initialBootStage(true, true)).toBe("selfcheck");
    expect(stageAfterSelfCheck(true)).toBe("authorization");
    expect(stageAfterSelfCheck(false)).toBe("main");
  });

  test("授权关闭且自检关闭 → 主界面", () => {
    expect(initialBootStage(false, false)).toBe("main");
  });
});

describe("授权状态推导", () => {
  test("刷卡成功未授权 → 双重认证；daemon 已授权 → 成功", () => {
    expect(phaseForSwipe(SWIPE_STATUS.authorized, false)).toBe("licenseTail");
    expect(phaseForSwipe(SWIPE_STATUS.authorized, true)).toBe("success");
    expect(phaseForSwipe(SWIPE_STATUS.silent, false)).toBe("success");
    expect(phaseForSwipe(SWIPE_STATUS.failed, false)).toBe("failed");
    expect(phaseForSwipe(SWIPE_STATUS.duplicate, false)).toBe("failed");
  });

  test("状态文案与开机方式", () => {
    expect(swipeStatusKey(SWIPE_STATUS.authorized)).toBe("JCLIB_LAN_AUTH_SUCCESS");
    expect(swipeStatusKey(SWIPE_STATUS.otherCard)).toBe("JCLIB_LAN_CARD_UNAUTHORIZED");
    expect(powerOnKindForCard(BLUETOOTH_CARD)).toBe(4);
    expect(powerOnKindForCard("11223344")).toBe(1);
  });
});
