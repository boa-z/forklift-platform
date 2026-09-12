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
| 充电 | `LvglChargingScreen.c` | 已实现 | `VehicleState.battery.charging`（v2 协议） |
| 密码 | `LvglPasswordScreen.c` | 待实现 | 本地校验 |
| 移除提示（防拆卸） | `LvglRemovalScreen.c` | 已实现 | `VehicleState.io.anti_dismantle`（v3 协议） |
| 加力（开机 Logo 屏） | `LvglBoostScreen.c` | 暂缓 | Logo JPG 需两片 512 纹理（约 2MB），超出 64MB 预算 |
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
- 语言切换入口未实现（v1 仅 zh，语言表完整保留）。
- 参考自检项直连 CAN 报文解析器；本产品统一经平台 `VehicleState`。
- 充电屏的 50 帧圆环动画只保留 1 帧（参考帧 01）：**PSM 5650 纹理在 D211 core 上渲染崩溃**，
  8888 纹理下 64 MB 内存只放得下单帧；帧动画随 M3 的内存/纹理格式结论补齐。
  另：`u8` 数字字高 90px 超过 PocketJS 字号上限，使用 MiSans 90px 数字贴图。
- 防拆卸遮挡只按 `anti_dismantle` 显示：设置项（防拆除使能）的持久化随设置子页实现。
- 开机 Logo 屏暂缓：`logo/logo.jpg` 内容 792×291，按 512 纹理上限需两片 512×512；
  实测 pak 超过约 9 MB 时设备 OOM（10.5MB 启动即被杀死），待 M3 的内存/纹理方案。
- 纹理格式实测：`PSM 8888` 正常；`PSM 4444` 可用但渐变有明显色带（充电环保留 8888）；
  `PSM 5650` 渲染崩溃。

## 4. 纹理化与裁切

界面元素使用参考素材的原始像素，不做 View 近似：

| 元素 | 素材 | 处理 |
| --- | --- | --- |
| 底部导航 | 各屏背景图的底栏条带 | 背景图仅底栏 70px 有像素（其余为基色 `#080304`），按 512 列切两片 |
| 导航图标 | `menuBar/*`（激活 `*Bright`） | 整图烘焙 |
| 电量条 | `soc_0` 轨道 + `soc_1/2/3` 分段 | 轨道切两片；填充按 67px 分段逐个绘制，末尾像素用同色块补齐 |
| 自检进度条 | `005ProgressGreen`/`006ProgressGrey` | 轨道切两片；绿色填充用 16/8/4/2/1 的均匀切片精确拼宽 |
| 菜单项/数据行 | `002_menu_item*`、`004_menu_data_bg` | 整图烘焙 |
| 充电圆环 | `charging/NN.jpg` 帧 | 取全部 50 帧的联合包围盒 (180,0)-(624,478) 裁切，单帧 512×512 纹理 |
| 充电 SOC | MiSans 90px 数字 | 逐字贴图（PocketJS 字号上限 54px），工具 `tools/make-charging-assets.sh` |
| 自检项/进入按钮 | `001GreyBoxBg`、`004GreenBoxBg`、`002yesPass/003noPass` | 整图烘焙 |

**PocketJS 尺寸语义**：core 把整张（补齐到 2 的幂的）纹理缩放进节点框，
因此渲染尺寸必须使用烘焙清单的 `w/h`（补齐尺寸）；`cw/ch` 只用于说明内容
范围。用 `cw/ch` 渲染会把内容缩小（如 183/256）。

裁切表在 `tools/bake-ui-assets.ts` 的 `crops`；素材来源与设计稿差异见
`design-spec.md`。
