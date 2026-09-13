// 授权屏布局：标题、状态文字与“输入密码”按钮（参考 LvglAuthorizationScreen.c
// 的全屏授权界面；具体贴图沿用现有烘焙资产）。

/** 授权屏布局。 */
export const AUTH = {
  /** 顶部标题（请刷卡 / 请刷卡或输入密码）。 */
  title: { x: 200, y: 150, w: 400, h: 40 },
  /** 状态/结果文字。 */
  message: { x: 200, y: 220, w: 400, h: 32 },
  /** “输入密码”按钮。 */
  passwordButton: { x: 300, y: 300, w: 200, h: 56 },
} as const;
