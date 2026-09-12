// i18n 与监控菜单树测试：数据来自 data.bin 的生成文件。
// 这些断言同时校验生成器（tools/gen-i18n.ts）与参考 bin 的对应关系。

import { describe, expect, test } from "bun:test";

import { faultText, t, tIndex } from "../src/i18n";
import { MONITOR_TREE } from "../src/screens/monitor/menu.gen";
import { clampMonitorPage, monitorPageCount } from "../src/screens/monitor/tree";
import { ZH_STRINGS } from "../src/i18n/strings.gen";

describe("i18n（data.bin 语言表）", () => {
  test("语言表条目数与关键文案", () => {
    expect(ZH_STRINGS.length).toBe(432);
    expect(ZH_STRINGS[0]).toBe("中文");
    expect(t("JCLIB_LAN_FAULT_DIAGNOSIS")).toBe("故障诊断");
    expect(t("JCLIB_LAN_NO_RELATED_FAULT")).toBe("无相关故障");
    expect(t("JCLIB_LAN_CAN_PROTOCOL")).toBe("监控设置");
    expect(t("JCLIB_LAN_USER_SETTINGS")).toBe("用户设置");
    expect(tIndex(9999)).toBe("");
  });

  test("故障码映射到参考故障表文案", () => {
    expect(faultText(0x19)).toBe("控制器低温警告");
    expect(faultText(0x01)).toBe("控制器短路单次过流");
    expect(faultText(0xffff)).toBe("");
  });
});

describe("监控菜单树（data.bin SDO 表）", () => {
  test("根节点为 10 个分类菜单", () => {
    expect(MONITOR_TREE.kind).toBe("menu");
    expect(MONITOR_TREE.children.length).toBe(10);
    expect(MONITOR_TREE.children.map((node) => tIndex(node.nameIndex))).toEqual([
      "开关监测",
      "运行监测",
      "温度监测",
      "电流与速度监测",
      "牵引设置",
      "泵设置",
      "电池设置",
      "转弯限速设置",
      "电流设置",
      "其他设置",
    ]);
  });

  test("叶子带 SDO 地址，分页计算正确", () => {
    const switches = MONITOR_TREE.children[0];
    expect(switches?.children.length).toBe(14);
    const seat = switches?.children[0];
    expect(seat?.kind).toBe("sdo");
    expect(tIndex(seat?.nameIndex ?? -1)).toBe("座椅开关");
    expect(seat?.sdo?.mid).toBe(0x2024);
    expect(seat?.sdo?.sid).toBe(20);

    expect(monitorPageCount(10)).toBe(3);
    expect(monitorPageCount(0)).toBe(1);
    expect(clampMonitorPage(5, 10)).toBe(2);
    expect(clampMonitorPage(-1, 10)).toBe(0);
  });
});
