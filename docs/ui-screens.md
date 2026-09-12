# UI 屏幕实现状态

每个屏幕对应参考工程的一个 `Lvgl*Screen.c`；坐标常量在屏幕目录的 `layout.ts`，
文案与菜单数据来自 `data.bin`（见 `localization.md`）。

## 1. 状态总览

| 屏幕 | 参考 | 状态 | 数据来源 |
| --- | --- | --- | --- |
| 主屏 | `LvglMainScreen.c` | 已实现 | `VehicleState` 全量 |
| 开机自检 | `LvglSelfCheckScreen.c` | 已实现 | `VehicleState`（6 项接入检查） |
| 故障诊断 | `LvglFaultScreen.c` | 已实现 | `platform.faults` |
| 监控 / CAN 数据页 | `LvglMonitorScreen.c` | 菜单树与分页已实现 | 树来自 `data.bin`；SDO 值待 M3 |
| 设置 | `LvglSetScreen.c` | 一级菜单与分页已实现 | 语言键（`data.bin`）；子对话框待实现 |
| 充电 | `LvglChargingScreen.c` | 待实现 | 需要充放电状态信号 |
| 密码 | `LvglPasswordScreen.c` | 待实现 | 本地校验 |
| 移除提示 | `LvglRemovalScreen.c` | 待实现 | 文件系统事件 |
| 加力 | `LvglBoostScreen.c` | 待实现 | 控制器状态 |
| 相机 | `LvglCameraScreen.c` | 待实现（P3） | VIN/DE 链路 |
| 本地升级 | `LvglUpdateScreen.c` | 待实现（P3） | 升级包校验 |
| 授权 | `LvglAuthorizationScreen.c` | 暂缓 | 联网/RFID |

## 2. 开机自检

- 6 项接入检查：CAN 通讯、牵引控制器、油泵控制器、转向控制器、转向角度
  传感器、超声波雷达。
- 状态来自 `VehicleState`：`canOnline`、`controllerOnline[3]`、
  `steerAngleDeg.quality`。
- 进度为通过项 / 6；**全部通过时自动进入主屏**；**3 秒超时**后进度标签显示
  「自检完成」，由「进入系统」按钮手动进入（与参考的 60×50ms 定时一致）。
- **无数据源的检查项保持等待**：不显示状态图标、不计入通过数。超声波雷达的
  数据源随 M3 的 CAN/IO 后端接入；此前该路径不会出现全通过，只能走超时后
  手动进入。自检失败不阻塞进入系统（与参考一致）。

## 3. 与参考的偏差

- SDO 读写对话框、设置子对话框（语言/亮度/音量等）未实现；相关条目的点击
  仅保留反馈音。
- 监控页的值显示为 `--`：参考经 CANopen SDO 读取，本产品等待 M3 的真实
  CAN 后端，不伪造数值。
- 语言切换入口未实现（v1 仅 zh，语言表结构完整保留）。
- 参考自检项直连 CAN 报文解析器；本产品统一经平台 `VehicleState`。
