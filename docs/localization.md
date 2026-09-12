# 多语言与 data.bin

产品文案与监控菜单树来自参考工程的 `data.bin`，不在 UI 代码里硬编码。

## 1. data.bin 格式（逆向自参考 `jclib_ui.c`）

文件由地址表描述（参考工程 `ConfigUpdate.json` 的 `data_description`，本仓库
`data/bin/config.json` 原样保留）：

| 字段 | 含义 |
| --- | --- |
| `file_size` / `crc` | 文件字节数与 CRC16-CCITT-FALSE（生成器校验） |
| `global_param_base_addr` | 全局参数表（本产品未使用） |
| `pdo_recv_base_addr` / `pdo_send_base_addr` | PDO 描述表（本产品未使用） |
| `sdo_base_addr` | SDO 菜单树根偏移 |
| `language_addr[]` / `language_code[]` | 各语言表偏移与代码（zh/en/ru/fr/de/ko/pt/es/ar/ja） |

语言表结构：`u32 条目数` + `u32 偏移数组`，各偏移指向 NUL 结尾 UTF-8 字符串。
zh 表共 **432 条**：前 332 条与 `jclib_ui.h` 的 `JCLIB_LAN_*` 枚举一一对应，
其余为参考工程追加的菜单树文案（如 `菜单`/`开关监测`）。

SDO 菜单树：节点为 40 字节记录。menu 节点（type=0）含 `children_addr`（文件
绝对偏移）与子节点数；SDO 叶子（type=1）含名称下标、读写权限、`mid`/`sid`
（CANopen 对象）、`handle`/`handleParam`（位域解包参数）与 `min`/`max`。

## 2. 生成

```sh
REFERENCE_METER_ROOT=/path/to/meter_6_test bun tools/gen-i18n.ts
```

生成四个文件（随仓库提交；`data.bin` 变更后重跑）：

| 文件 | 内容 |
| --- | --- |
| `ui/src/i18n/keys.gen.ts` | `JCLIB_LAN_*` 枚举名 → 语言表下标（332 项） |
| `ui/src/i18n/strings.gen.ts` | zh 语言表全部字符串（432 条） |
| `ui/src/i18n/fault.gen.ts` | 故障码 → 语言表下标（参考故障表 179 项） |
| `ui/src/screens/monitor/menu.gen.ts` | 监控菜单树（13 个菜单节点、88 个 SDO 条目） |

生成文件头部记录 `data.bin` 的 CRC，便于核对来源。UI 侧使用 `ui/src/i18n`
的 `t(key)` / `tIndex(index)` / `faultText(code)`；未知键回退为键名，不静默。

## 3. 监控屏

监控菜单树逐层来自 `data.bin`：根层 10 个分类（开关监测、运行监测、温度监测、
电流与速度监测、牵引/泵/电池/转弯限速/电流/其他设置），每页 4 行，进入子层
后返回键回上级。**SDO 值显示为 `--`**：读写对话框与 CANopen SDO 传输依赖
真实 CAN 后端（M3），当前不伪造数据。

## 4. 字体

参考工程使用 MiSans。`ui/fonts.json` 声明 PocketJS 的字体回退：

```json
{ "fallback": ["assets/fonts/MiSans-Normal.subset.ttf", "assets/fonts/MiSans-Demibold.subset.ttf"] }
```

子集由参考字体生成，字符集取自 `data.bin` 全部语言表（1181 字符）：

```sh
bun tools/extract-charset.ts   # data.bin -> ui/assets/fonts/charset.txt
tools/subset-fonts.sh          # MiSans TTF -> *.subset.ttf（需 fontTools）
```

ASCII 由 Inter 渲染，中文由 MiSans 回退字形渲染（fontTools 子集，约 150 KB/字重）。

## 5. 语言切换范围

v1 只启用 zh：`strings.gen.ts` 固定生成 zh 表。新增语言时从 `language_addr`
取对应表生成另一份 `strings.gen`（`tools/gen-i18n.ts` 已能解析全部语言），
字形按需扩充 `charset.txt` 后重跑子集。切换入口（设置屏「语言选择」对话框）
随设置子页一并实现。
