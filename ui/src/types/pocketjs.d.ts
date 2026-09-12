// PocketJS 组件与生命周期模块的开发期类型声明。
// 运行时代码由 PocketJS 编译器解析到 framework/src；tsc 不加载那里
// 的实现（其内部源码的严格度与本项目不同），这里只声明用到的 API。

declare module "@pocketjs/framework/components" {
  /** PocketJS 元素通用属性。 */
  export interface PocketElementProps {
    /** Tailwind class 字面量。 */
    class?: string;
    /** 绝对定位与尺寸（PocketJS 使用 translateX/translateY/width/height）。 */
    style?: Record<string, number | string>;
    /** 是否可聚焦与响应触摸。 */
    focusable?: boolean;
    /** 触摸回调。 */
    onPress?: () => void;
    /** 子元素。 */
    children?: unknown;
  }

  /** 容器组件。 */
  export function View(props: PocketElementProps): unknown;
  /** 文本组件（内容作为 children 传入）。 */
  export function Text(props: PocketElementProps): unknown;
  /** 图片组件。 */
  export function Image(props: PocketElementProps & { src: string }): unknown;
}

declare module "@pocketjs/framework/lifecycle" {
  /** 每帧回调；返回取消函数。 */
  export function onFrame(callback: () => void): () => void;
}

declare module "@pocketjs/framework/solid" {
  /** 挂载 Solid 根组件。 */
  export function mount(code: () => unknown, options?: unknown): () => void;
}
