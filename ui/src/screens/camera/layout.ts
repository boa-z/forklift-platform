// 相机屏布局常量：对应参考 LvglCameraScreen.c。
// 参考背景 `bg/camera_bg.png` 为纯色 #080303（无内容），三个通道/退出按钮在
// 底部 y=430、高 50；产品无视频链路（VIN/DE 未接入），内容区显示离线占位。

/** 相机屏布局。 */
export const CAMERA = {
  /** 底部按钮（左/中/右），参考坐标。 */
  buttons: [
    { x: 0, y: 430, w: 266, h: 50 },
    { x: 266, y: 430, w: 266, h: 50 },
    { x: 532, y: 430, w: 268, h: 50 },
  ] as const,
  /** 离线占位文字区。 */
  placeholder: { x: 0, y: 180, w: 800, h: 60 },
  /** 通道名提示区（占位文字下方）。 */
  channelLabel: { x: 0, y: 250, w: 800, h: 36 },
  /** 离线占位文案（参考工程无对应语言键，产品文案为 ASCII）。 */
  offlineText: "NO SIGNAL",
} as const;
