// 电量条分段模型测试：宽度公式与分段边界镜像参考实现。

import { describe, expect, test } from "bun:test";

import { socBarShape, socSegmentAsset } from "../src/screens/main/format";

describe("电量条分段", () => {
  test("宽度公式与参考一致（67/10 - 6；<10% 为 61/10）", () => {
    expect(socBarShape(56)).toEqual({ full: 5, partial: 34 });
    expect(socBarShape(50)).toEqual({ full: 4, partial: 61 });
    expect(socBarShape(20)).toEqual({ full: 1, partial: 61 });
    expect(socBarShape(10)).toEqual({ full: 0, partial: 61 });
    expect(socBarShape(9)).toEqual({ full: 0, partial: 54 });
    expect(socBarShape(0)).toEqual({ full: 0, partial: 0 });
  });

  test("11/21/31 的 +1 修正生效", () => {
    // 11%: 67*11/10-6 = 67，修正后 68 → 第一段完整，第二段 1px。
    expect(socBarShape(11)).toEqual({ full: 1, partial: 1 });
    // 10%: 61 → 不足一段。
    expect(socBarShape(10)).toEqual({ full: 0, partial: 61 });
  });

  test("无效值不产生任何分段", () => {
    expect(socBarShape(undefined)).toEqual({ full: 0, partial: 0 });
  });

  test("分段贴图按电量区间选择", () => {
    expect(socSegmentAsset(56)).toBe("soc_seg_green");
    expect(socSegmentAsset(21)).toBe("soc_seg_green");
    expect(socSegmentAsset(20)).toBe("soc_seg_yellow");
    expect(socSegmentAsset(11)).toBe("soc_seg_yellow");
    expect(socSegmentAsset(10)).toBe("soc_seg_red");
  });
});
