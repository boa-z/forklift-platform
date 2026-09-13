// 密码模型与键盘布局测试。

import { describe, expect, test } from "bun:test";

import { keyAction, keyPosition } from "../src/screens/password/layout";

describe("键盘布局", () => {
  test("12 键位置与动作", () => {
    expect(keyPosition(0)).toEqual({ x: 215, y: 148 });
    expect(keyPosition(3)).toEqual({ x: 599, y: 148 });
    expect(keyPosition(4)).toEqual({ x: 215, y: 217 });
    expect(keyPosition(11)).toEqual({ x: 599, y: 286 });
    expect(keyAction(0)).toBe("1");
    expect(keyAction(8)).toBe("9");
    expect(keyAction(9)).toBe("backspace");
    expect(keyAction(10)).toBe("0");
    expect(keyAction(11)).toBe("confirm");
  });
});
