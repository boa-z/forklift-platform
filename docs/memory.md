# D211 内存预算与 OOM 分析

记录 PocketJS 叉车仪表在 64MB 级设备（D211）上的内存构成、实测边界与 OOM
时间线，并与参考工程（LVGL v9）的资源机制对照。数字全部来自设备实测与仓库
内配置/源码，推断项单独标注。

## 1. 设备预算（实测）

```text
Mem:  total 54,780 kB   used 41,820 kB   free 4,384 kB   buff/cache 8,576 kB   available 8,028 kB
```

- 标称 64MB，内核/保留段之后 **MemTotal ≈ 53.5MB**，无 swap。
- 应用运行时（pak 5.4MB）available ≈ 8MB；应用 VmRSS 17.4MB。
- 进程分布（VmRSS）：`pocketjs-d211` 17.4MB、`adbd` 1.6MB、`mdev` 1.4MB、
  若干 shell ≈1MB、`syslogd`/`klogd`/`telnetd` 各 ≈0.9MB。

## 2. PocketJS 运行时的内存构成

D211 host（`hosts/d211-linux/main.c`）：

- `read_asset()` 把 `app.js` 与 `app.pak` **整体 malloc 进 RAM**，进程生命周期内
  驻留（仅退出时释放）；
- `pocket_runtime_boot()` 把 pak 指针交给 core，纹理从 pak 逐条上传；
- `/dev/fb0` 双页映射 800×960×4 = **3MB**。

Framework（`framework/src/index.ts`）：

- `uploadPakImages()` 在启动时遍历 pak 里**所有** `ui:img.*` 条目并上传纹理
  ——未显示的素材同样常驻；
- 字库按字号槽整档烘焙（每个字形一块覆盖位图），随 pak 上传后常驻。

因此常驻内存 ≈ `pak 大小 + 全部纹理 + QuickJS 堆 + framebuffer`，与**素材总量
强相关**。实测 5.4MB pak 时 VmRSS 17.4MB。

## 3. OOM 时间线（实测）

| pak 大小 | 内容 | 结果 |
| --- | --- | --- |
| 3.3–4.8MB | 五屏 + 中文子集字库 | 正常 |
| 11.8MB | 整屏背景贴图（6×512×512）+ 充电多帧 | **启动即被 SIGKILL**（EXIT=137，日志停在 boot 前） |
| 10.5MB | 充电 1 帧 8888（目录里仍烘焙 3 帧） | **启动即 SIGKILL** |
| 8.9MB | 充电 3 帧 PSM5650 | 能启动；绘制 5650 纹理时崩溃（上游 #415） |
| 8.4–8.8MB | 充电单帧 + 对话框贴图 | 临界：有时启动，有时被 SIGKILL |
| 7.6MB | 同上但纯色贴图改 PSM4444 | 能启动；渲染明显变慢（15–30fps）且渐变有色带 |
| 7.7MB | 底栏格子改复用单图 | 正常（55–57fps） |
| 5.4MB | 大数字改贴图（去掉 54px/36px 字库） | 正常（59.8fps），available ≈ 8MB |

结论：该设备上 **pak 约 8MB 是硬边界**；超过后启动阶段（pak 读入 + 全量纹理
上传 + JS 解析求值 + allocator）触及内存上限即被杀死。dmesg 未保留 OOM 记录
（环形缓冲被覆盖），"OOM" 依据 SIGKILL(137) + 可复现的大小悬崖 + 实测余量判定。

## 4. 对照参考工程（LVGL v9）

| 维度 | 原工程（LVGL v9 C） | PocketJS 产品 |
| --- | --- | --- |
| 素材位置 | 文件系统（`LV_USE_FS_POSIX=1`），JPG/PNG 文件 | 单个 `app.pak` 整体读入内存 |
| 图像解码 | 按需解码 + 缓存（`LV_IMAGE_HEADER_CACHE_DEF_CNT=20`），未显示的不占内存 | 启动时全量上传纹理，全部常驻 |
| 字体 | FreeType 读 TTF（`LV_USE_FREETYPE=1`）+ 字形缓存 | 每个字号槽整档烘焙位图，全部常驻 |
| 对象堆 | `LV_MEM_SIZE = 1MB` | QuickJS 堆 + Solid 运行时 |
| 显示缓冲 | DIRECT 模式 `buf1/buf2` 双全屏缓冲（800×480×32bpp ≈ 2×1.5MB） | fb0 双页映射 3MB |
| 常驻内存特性 | 与"当前屏幕内容 + 缓存"相关，与素材总量**弱相关** | 与 **pak 总量强相关** |

原工程把"大素材"留在文件系统：800×480 背景、50 帧充电动画都以文件存在，只在
绘制时解码进缓冲并受缓存数量约束；字体字形也只在用到时栅格化。因此同样的
53MB 预算下，素材规模增长不改变常驻内存上界。

## 5. 已采取的措施与效果

| 措施 | 效果 |
| --- | --- |
| 底栏四格像素校验一致 → 每屏一格贴图复用（+ set/fault 各一张） | -1MB 纹理 |
| 主屏 54px/36px 大数字改逐字贴图（白/橙/红三套 + 小数点基线对齐） | 去掉两档字库槽 -2.4MB |
| 充电 50 帧 → 1 帧（PSM5650 崩溃、8888 单帧已占满预算） | 50MB → 1MB |
| EN 语言表 base64 存储 + 非 ASCII 回退 zh 表 | 避免字库多收 218 个字形（约 -1.5MB 潜在占用） |
| 全量 8888（PSM4444 减半但明显变慢、有色带） | 保质量与帧率 |
| 结果 | pak 8.8MB → **5.4MB**，59.8fps，available ≈ 8MB |

## 6. 后续选型（M3/M4）

- **纹理按需上传/淘汰**：与 LVGL 图像缓存对齐，只驻留当前屏与近期使用的素材；
- **分包 pak**：首屏包 + 按屏分包，或大素材（充电动画、开机 Logo）走文件系统/流式，
  而不是常驻纹理；
- **host 侧 mmap pak**：现在 host 整体读入；mmap 后 pak 字节进入可回收的 page cache
  （候选方案，需 core 接口配合）；
- 上游已报：pocket-stack/pocketjs#415（PSM5650 渲染崩溃）。
