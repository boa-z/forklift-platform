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
| 设置 | `LvglSetScreen.c` | 一级菜单、分页与三个子对话框已实现 | 语言键（`data.bin`）；语言/亮度/音量 |
| 充电 | `LvglChargingScreen.c` | 已实现 | `VehicleState.battery.charging`（v2 协议） |
| 密码 | `LvglPasswordScreen.c` | 已实现 | 本地校验（超级密码 32431 / 管理员密码） |
| 移除提示（防拆卸） | `LvglRemovalScreen.c` | 已实现 | `VehicleState.io.anti_dismantle`（v3 协议） |
| 加力（开机 Logo 屏） | `LvglBoostScreen.c` | 暂缓 | Logo JPG 需两片 512 纹理（约 2MB），超出 64MB 预算 |
| 相机 | `LvglCameraScreen.c` | 离线占位已实现 | 主屏相机按钮进入；视频链路（VIN/DE）接入后替换占位 |
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
- 设置子对话框：**语言选择**支持 zh/en 运行时切换（其余 8 种语言在对话框中置灰：
  字体子集/阿拉伯语整形未就绪），**亮度/音量**经平台命令下发（`system.setBrightness`、
  `audio.setVolume`）；初始值 70% 为本地默认，设置持久化随 M3 的 daemon 设置存储。
- 语言切换只影响当前会话（重启回 zh）：持久化同上。
- 相机屏：布局与参考一致（底部 摄像头1/摄像头2/退出，y=430 高 50），内容区显示
  `NO SIGNAL`（参考工程无对应语言键，产品文案为 ASCII）；通道可切换并高亮。
  参考实现切换的是视频源；本产品在 VIN/DE 链路接入前不伪造画面。
- 密码屏：输入掩码显示为 `*`（参考为 2 秒显隐圆点，需要逐字计时与字形支持）；
  **超级密码 `32431` 与参考一致**，管理员密码存于会话（`ui/src/settings.ts`，持久化随 M3）。
  入口：设置 → 「高级设置」需要管理员/超级密码（参考门禁），本地设置第 4 页
  「设置管理员密码」直接写入新密码。
- 底栏格子贴图按屏复用（四格像素校验一致，仅 main 的 set 格与 fault 格单独烘焙），
  替代整条 512×128 条带，省 ~1MB 纹理内存（64MB 设备的 OOM 临界）。
- 内存基线：pak 5.4MB（字库 5 档）稳定运行；实测 pak ≥ 8MB 时启动即被 OOM 杀死。
- 纹理格式实测补充：`PSM 4444` 除色带外**渲染也明显变慢**（62 个 4444 贴图的界面
  掉到 ~15fps），产品统一使用 8888。
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
| 主屏车速 | MiSans Demibold 54px 数字（白/橙/红三套） | 逐字贴图（`tools/make-number-assets.sh`），替代 54px 字库槽（省 1.8MB） |
| 主屏 SOC 值 | MiSans Demibold 36px（数字 + %） | 逐字贴图，替代 36px 字库槽（省 0.8MB） |
| 亮度/音量滑条 | `bargray_441x33`、`bargreen_441x33`、`sliding_block_20x48` | 轨道/旋钮整图，绿色填充 16/8/4/2/1 切片拼宽 |
| 语言选择项 | `checkboxbg_186x44`、`lauageset_null/ok` | 整图烘焙，2 列 × 5 行 |
| 自检项/进入按钮 | `001GreyBoxBg`、`004GreenBoxBg`、`002yesPass/003noPass` | 整图烘焙 |

**PocketJS 尺寸语义**：core 把整张（补齐到 2 的幂的）纹理缩放进节点框，
因此渲染尺寸必须使用烘焙清单的 `w/h`（补齐尺寸）；`cw/ch` 只用于说明内容
范围。用 `cw/ch` 渲染会把内容缩小（如 183/256）。

裁切表在 `tools/bake-ui-assets.ts` 的 `crops`；素材来源与设计稿差异见
`design-spec.md`。
