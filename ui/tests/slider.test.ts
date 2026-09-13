// 滑条数学与切片拼宽测试。

import { describe, expect, test } from "bun:test";

import { fillSlices, sliderValueAt } from "../src/components/slices";

describe("滑条数值", () => {
  test("指针位置映射 0-100 并夹取", () => {
    expect(sliderValueAt(10, 10, 441)).toBe(0);
    expect(sliderValueAt(10 + 220.5, 10, 441)).toBe(50);
    expect(sliderValueAt(10 + 441, 10, 441)).toBe(100);
    expect(sliderValueAt(0, 10, 441)).toBe(0);
    expect(sliderValueAt(999, 10, 441)).toBe(100);
    expect(sliderValueAt(10, 10, 0)).toBe(0);
  });
});

describe("切片拼宽", () => {
  test("用 16/8/4/2/1 精确拼出任意宽度", () => {
    expect(fillSlices(0)).toEqual([]);
    expect(fillSlices(7)).toEqual([
      { size: 4, x: 0 },
      { size: 2, x: 4 },
      { size: 1, x: 6 },
    ]);
    const total = fillSlices(123).reduce((sum, slice) => sum + slice.size, 0);
    expect(total).toBe(123);
  });
});
