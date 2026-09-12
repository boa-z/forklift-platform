// 进度类控件的贴图切片：用 16/8/4/2/1 的均匀切片精确拼出任意宽度。

/** 一个填充切片。 */
export interface FillSlice {
  /** 切片宽度（对应 *_slice{N} 贴图）。 */
  size: number;
  /** 相对填充起点的 x 偏移。 */
  x: number;
}

/** 计算填充切片序列（宽度为 0 时返回空数组）。 */
export function fillSlices(width: number): FillSlice[] {
  const sizes = [16, 8, 4, 2, 1];
  const slices: FillSlice[] = [];
  let x = 0;
  let remaining = Math.max(0, Math.round(width));
  for (const size of sizes) {
    while (remaining >= size) {
      slices.push({ size, x });
      x += size;
      remaining -= size;
    }
  }
  return slices;
}

/** 指针 x 对应的滑条值（0-100，越界夹取）。 */
export function sliderValueAt(pointerX: number, trackX: number, trackW: number): number {
  if (trackW <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round(((pointerX - trackX) / trackW) * 100)));
}
