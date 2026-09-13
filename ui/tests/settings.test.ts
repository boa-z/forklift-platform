// UI 设置位域：默认值、应用与汇总。

import { describe, expect, test } from "bun:test";

import {
  applySettingsFlags,
  currentSettingsFlags,
  DEFAULT_SETTINGS_FLAGS,
  getAuthorizationEnabled,
  getPasswordBootEnabled,
  getSelfCheckEnabled,
  SETTING_ANTI_DISMANTLE,
  SETTING_AUTHORIZATION,
  SETTING_PASSWORD_BOOT,
  SETTING_SELF_CHECK,
} from "../src/settings";

describe("设置位域", () => {
  test("默认位域为授权开启、其余关闭", () => {
    applySettingsFlags(DEFAULT_SETTINGS_FLAGS);
    expect(getSelfCheckEnabled()).toBe(false);
    expect(getAuthorizationEnabled()).toBe(true);
    expect(getPasswordBootEnabled()).toBe(false);
  });

  test("应用 daemon 位域并汇总回写", () => {
    applySettingsFlags(SETTING_SELF_CHECK | SETTING_PASSWORD_BOOT);
    expect(getSelfCheckEnabled()).toBe(true);
    expect(getAuthorizationEnabled()).toBe(false);
    expect(getPasswordBootEnabled()).toBe(true);
    expect(currentSettingsFlags(false)).toBe(SETTING_SELF_CHECK | SETTING_PASSWORD_BOOT);
    expect(currentSettingsFlags(true)).toBe(
      SETTING_SELF_CHECK | SETTING_PASSWORD_BOOT | SETTING_ANTI_DISMANTLE,
    );
    expect(currentSettingsFlags(false) & SETTING_AUTHORIZATION).toBe(0);
  });
});
