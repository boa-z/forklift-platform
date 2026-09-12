// 密码屏布局常量：对应参考 LvglPasswordScreen.c。
// 键盘 12 键（1-9、退格、0、确认），按键 114×54，列距 128、行距 69。

/** 密码屏布局。 */
export const PASSWORD = {
  /** 返回/取消按钮。 */
  returnButton: { x: 38, y: 20, w: 55, h: 55 },
  /** 输入框背景。 */
  textArea: { x: 215, y: 78, w: 370, h: 54 },
  /** 输入文字内偏移与宽度。 */
  textInset: 20,
  /** 键盘起始位置与间距。 */
  key: { w: 114, h: 54, initX: 215, initY: 148, colSpace: 128, rowSpace: 69, columns: 4 },
  /** 输入上限（参考未限制；产品取 8 位）。 */
  maxLength: 8,
} as const;

/** 按键总数：1-9、退格、0、确认。 */
export const PASSWORD_KEY_COUNT = 12;

/** 按键第 index 个的左上角坐标（0-3 第一行，4-7 第二行，8-11 第三行）。 */
export function keyPosition(index: number): { x: number; y: number } {
  const column = index % PASSWORD.key.columns;
  const row = Math.floor(index / PASSWORD.key.columns);
  return {
    x: PASSWORD.key.initX + column * PASSWORD.key.colSpace,
    y: PASSWORD.key.initY + row * PASSWORD.key.rowSpace,
  };
}

/** 按键对应的输入内容：`0`-`9` 数字，`backspace`，`confirm`。 */
export function keyAction(index: number): string {
  if (index === 9) return "backspace";
  if (index === 11) return "confirm";
  return index === 10 ? "0" : String(index + 1);
}
