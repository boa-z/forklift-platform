# Forklift Instrument — UI 复刻清单

来源：`/Users/boa/Documents/dev/luban-lite-jc-d70t/packages/artinchip/lvgl-ui/aic_demo/meter_6_test`。
参考实现为新老架构混杂；本清单只对应 `Lvgl*`（屏幕）、`Common*`（数据/配置）、`Thread*`（工作线程）这一代代码。

## 1. 屏幕清单

| 参考文件 | 作用 | 数据/能力依赖 | 复刻阶段 |
| --- | --- | --- | --- |
| `LvglMainScreen.c` | 主界面：仪表、档位、状态图标 | VehicleState 全量 | P1 |
| `LvglSetScreen.c` | 设置总入口（最大屏，含多级菜单） | config、时间、语言 | P2 |
| `LvglMonitorScreen.c` | 监控页（运转/电池/控制器数据） | VehicleState + CAN 诊断 | P2 |
| `LvglFaultScreen.c` | 故障显示与诊断 | FaultManager | P2 |
| `LvglSelfCheckScreen.c` | 开机/手动自检进度 | health、IO 状态 | P2 |
| `LvglChargingScreen.c` | 充电界面 | 电池状态、充电条件 | P2 |
| `LvglPasswordScreen.c` | 密码输入 | 本地校验 | P2 |
| `LvglRemovalScreen.c` | 外设移除提示（U 盘/存储） | 文件系统事件 | P2（本地部分） |
| `LvglBoostScreen.c` | 加力/助推状态屏 | 控制器状态 | P2 |
| `LvglCanFrameInfoScreen.c` | CAN 帧查看与手动发送 | 诊断接口（非产品功能） | P3 |
| `LvglCameraScreen.c` | 倒车影像 | VIN/DE Video Layer | P3（无信号占位） |
| `LvglUpdateScreen.c` | 本地升级 | 本地升级包校验 | P3（去联网） |
| `LvglAuthorizationScreen.c` | 授权（二维码/刷卡） | 联网/RFID | 暂缓（离线占位） |
| `LvglMeter.c` | LVGL 驱动/线程封装（非屏幕） | — | 由 PocketJS host 替代 |

## 2. 导航结构（底部菜单栏）

`lvgl_src/lvgl_data/menuBar/` 提供四组图标（亮/灰）：

```text
home(主页)  set(设置)  error/故障  find/查询(监控)
```

顶栏（`status/`，76 个状态图标）：电量、故障、方向、座椅/安全带、手刹等产品图标保留；
GPS、移动网络信号等联网图标不迁移。

## 3. 资产清单（`lvgl_src/lvgl_data/`，571 文件 ≈ 70 MB）

| 目录 | 数量 | 用途 |
| --- | --- | --- |
| `coustom/` | 222 | 各车型自定义图片 |
| `status/` | 76 | 顶栏状态图标 |
| `src/` | 52 | 通用位图/控件素材 |
| `charging/` | 50 | 充电屏 |
| `setmenu/` | 49 | 设置屏 |
| `monitor_menu/` | 31 | 监控屏 |
| `rfid/` | 31 | RFID/授权屏（暂缓） |
| `canmsg/` | 14 | CAN 报文/键盘素材 |
| `seflmenu/` | 12 | 自检/UI 弹出框素材 |
| `font/` | 9 | MiSans 系列 + Alibaba 字体 TTF（中/英/阿） |
| `menuBar/` | 8 | 底部导航图标 |
| `bg/` | 6 | 背景（主界面、相机、RFID） |
| `logo/` | 4 | 品牌/客户 Logo |
| `audio/` | 2 | `app_start_up.wav`、`btns.wav` |
| `bin/` | 1 | `data.bin`（参考工程的本地数据文件） |

迁移规则：

- 不迁移：联网类状态图标、二维码/授权素材、启动动画视频。
- M1 只迁移主屏、菜单栏、顶栏与 Logo 的必需子集；其余从对应阶段的复刻屏幕按需引入。
- 图片统一转 PocketJS pak；大图按 800×480 实际显示尺寸裁剪，控制 64 MB RAM 与 pak 体积。

## 4. 字体与文案

- 字体：`MiSans Demibold/Medium/Normal/Heavy` 子集化后烘焙；字号对应参考工程的 11–90 px 风格表（`CommonStyleConfig`）。
- 文案：v1 只做 zh-CN；字符串与监控菜单树从参考 `data.bin` 生成（见 `localization.md`），
  阿拉伯语等其他语言表结构保留，暂不引入。
- 数字仪表使用固定字宽样式，避免刷新时抖动。

## 5. 主界面元素（首屏复刻范围）

- 中央仪表：车速/转向角（指针或弧段，方案见 implementation-plan §4.3）
- 电池区：SOC、电压/电流、充放电状态
- 档位与状态：前进/后退/空挡、手刹、座椅、安全带、运行模式
- 顶栏状态图标与底部菜单栏
- 报警/故障弹出（与 FaultManager 事件联动）

字段映射与 VehicleState 补全项见 `implementation-plan.md` §4.1/§4.2。
