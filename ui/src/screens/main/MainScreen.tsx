// 主屏：按 docs/ui-main-screen.md 的 ground truth 复刻参考仪表首屏。
// 坐标来自 layout.ts；素材尺寸来自构建期烘焙的 assets.gen.ts。

import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { Image, Text, View } from "@pocketjs/framework/components";
import { onFrame } from "@pocketjs/framework/lifecycle";

import type { FaultSnapshot, Platform, VehicleState } from "../../platform";
import { CLASS, SCREEN_CLASS, SLOT_CLASS, SOC_TRACK_CLASS, socFillClass, speedClass } from "../../theme/theme";
import { BAKED, type BakedAsset } from "./assets.gen";
import {
  formatClock,
  formatOdometer,
  formatSoc,
  formatSpeed,
  formatSteerAngle,
  formatWorkhour,
  gear,
  socBarState,
  usable,
} from "./format";
import {
  BOTTOM_BUTTONS,
  COUNTERS,
  SOC,
  SPEED,
  STATUS_GRID,
  STATUS_ICONS,
  STEER,
  TOOLBAR,
  TOP,
  VEHICLE,
  statusIconPosition,
} from "./layout";

/** 以素材左上角定位。 */
function imageBox(asset: BakedAsset, x: number, y: number): Record<string, number> {
  const baked = BAKED[asset];
  return { translateX: x, translateY: y, width: baked.w, height: baked.h };
}

/** 在给定槽位内居中（返回值相对父元素，父元素已位于槽位原点）。 */
function centeredInSlot(asset: BakedAsset, w: number, h: number): Record<string, number> {
  const baked = BAKED[asset];
  return {
    translateX: Math.round((w - baked.w) / 2),
    translateY: Math.round((h - baked.h) / 2),
    width: baked.w,
    height: baked.h,
  };
}

/** 主屏组件。 */
export default function MainScreen(props: { platform: Platform }) {
  const [state, setState] = createSignal<VehicleState | undefined>(undefined);
  const [faults, setFaults] = createSignal<FaultSnapshot>({ timestampMs: 0, faults: [] });
  const [locked, setLocked] = createSignal(false);
  const [clock, setClock] = createSignal(formatClock(new Date()));

  onMount(() => {
    const unsubscribeVehicle = props.platform.vehicle.subscribe(setState);
    const unsubscribeFaults = props.platform.faults.subscribe(setFaults);
    onCleanup(() => {
      unsubscribeVehicle();
      unsubscribeFaults();
    });
  });

  // 时钟逐帧更新（QuickJS 无 setInterval）。
  onFrame(() => setClock(formatClock(new Date())));

  /** 主动作：点击按钮时的提示音。 */
  const press = (): void => {
    props.platform.audio.play("button");
  };

  /** 运行模式素材（S/E/P）。 */
  const modeAsset = (): BakedAsset => {
    const mode = state()?.runMode;
    if (!usable(mode)) return "E_1";
    switch (mode.value) {
      case "s":
        return "S_1";
      case "p":
        return "P_1";
      default:
        return "E_1";
    }
  };

  /** 是否有活动故障。 */
  const hasFault = (): boolean => faults().faults.some((fault) => fault.active);

  /** 档位素材。 */
  const gearBaked = (): BakedAsset | null => {
    const value = gear(state()?.direction);
    if (value === "D") return "D";
    if (value === "R") return "R";
    if (value === "N") return "N";
    return null;
  };

  /** 通用状态图标是否点亮。 */
  const statusVisible = (icon: (typeof STATUS_ICONS)[number]): boolean => {
    const current = state();
    switch (icon) {
      case "parking_brake":
        return usable(current?.parkingBrake) && current?.parkingBrake.value === true;
      case "gear":
        // 档位在车辆图形区显示，状态矩阵不再重复占位。
        return false;
      case "seat":
        return usable(current?.seatSwitch) && current?.seatSwitch.value === true;
      case "seatbelt":
        return usable(current?.seatbelt) && current?.seatbelt.value === true;
      case "fault":
        return hasFault();
      case "lock":
        return locked();
      default:
        return false;
    }
  };

  /** 通用状态图标素材。 */
  const statusAsset = (icon: (typeof STATUS_ICONS)[number]): BakedAsset => {
    switch (icon) {
      case "seat":
        return "104_status_seat_01";
      case "seatbelt":
        return "104_status_seatbelt_01";
      case "fault":
        return "error_1";
      case "parking_brake":
        return "203_brake";
      default:
        return "203_brake";
    }
  };

  /** 电量条宽度（像素）。 */
  const socFillWidth = (): number => {
    const signal = state()?.socPercent;
    if (signal === undefined || signal.quality !== "valid") return 0;
    const percent = Math.min(100, Math.max(0, signal.value)) / 100;
    return Math.round(SOC.bar.w * percent);
  };

  return (
    <View class={SCREEN_CLASS}>
      {/* 底部按钮槽（背景由 View 绘制，参考 main_bg.png） */}
      <View class={SLOT_CLASS} style={{ translateX: BOTTOM_BUTTONS.home.x, translateY: BOTTOM_BUTTONS.home.y, width: BOTTOM_BUTTONS.home.w, height: BOTTOM_BUTTONS.home.h }} />
      <View class={SLOT_CLASS} style={{ translateX: BOTTOM_BUTTONS.monitor.x, translateY: BOTTOM_BUTTONS.monitor.y, width: BOTTOM_BUTTONS.monitor.w, height: BOTTOM_BUTTONS.monitor.h }} />
      <View class={SLOT_CLASS} style={{ translateX: BOTTOM_BUTTONS.fault.x, translateY: BOTTOM_BUTTONS.fault.y, width: BOTTOM_BUTTONS.fault.w, height: BOTTOM_BUTTONS.fault.h }} />
      <View class={SLOT_CLASS} style={{ translateX: BOTTOM_BUTTONS.set.x, translateY: BOTTOM_BUTTONS.set.y, width: BOTTOM_BUTTONS.set.w, height: BOTTOM_BUTTONS.set.h }} />

      {/* 顶栏 */}
      <Text class={CLASS.clock} style={{ translateX: TOP.rtc.x, translateY: TOP.rtc.y, width: TOP.rtc.w, height: TOP.rtc.h }}>
        {clock()}
      </Text>
      <View
        class="absolute left-0 top-0"
        style={{ translateX: TOP.lockButton.x, translateY: TOP.lockButton.y, width: TOP.lockButton.w, height: TOP.lockButton.h }}
        focusable
        onPress={() => {
          setLocked(!locked());
          press();
        }}
      >
        <Image src={locked() ? BAKED.lock222.src : BAKED.lock111.src} class="absolute left-0 top-0" style={imageBox(locked() ? "lock222" : "lock111", 0, 0)} />
      </View>

      {/* 次顶栏：运行模式 / 相机（相机与多媒体按钮在参考布局中互斥，
          本产品启用相机，隐藏多媒体/语音按钮） */}
      <View class="absolute left-0 top-0" style={{ translateX: TOOLBAR.runMode.x, translateY: TOOLBAR.runMode.y, width: TOOLBAR.runMode.w, height: TOOLBAR.runMode.h }} focusable onPress={press}>
        <Image src={BAKED[modeAsset()].src} class="absolute left-0 top-0" style={imageBox(modeAsset(), 0, 0)} />
      </View>
      <View class="absolute left-0 top-0" style={{ translateX: TOOLBAR.camera.x, translateY: TOOLBAR.camera.y, width: TOOLBAR.camera.w, height: TOOLBAR.camera.h }} focusable onPress={press}>
        <Image src={BAKED.camera_1.src} class="absolute left-0 top-0" style={imageBox("camera_1", 0, 0)} />
      </View>

      {/* 车速 */}
      <Text class={speedClass(state()?.speedKph.quality)} style={{ translateX: SPEED.value.x, translateY: SPEED.value.y, width: SPEED.value.w, height: SPEED.value.h }}>
        {formatSpeed(state()?.speedKph)}
      </Text>
      <Text class={CLASS.speedUnit} style={{ translateX: SPEED.unit.x, translateY: SPEED.unit.y, width: SPEED.unit.w, height: SPEED.unit.h }}>
        km/h
      </Text>

      {/* 电量 */}
      <Text class={CLASS.socLabel} style={{ translateX: SOC.label.x, translateY: SOC.label.y, width: SOC.label.w, height: SOC.label.h }}>
        soc
      </Text>
      <Text class={CLASS.socValue} style={{ translateX: SOC.value.x, translateY: SOC.value.y, width: SOC.value.w, height: SOC.value.h }}>
        {formatSoc(state()?.socPercent)}
      </Text>
      <View class={SOC_TRACK_CLASS} style={{ translateX: SOC.bar.x, translateY: SOC.bar.y, width: SOC.bar.w, height: SOC.bar.h }} />
      <View class={socFillClass(state()?.socPercent)} style={{ translateX: SOC.bar.x, translateY: SOC.bar.y, width: socFillWidth(), height: SOC.bar.h }} />

      {/* 工时 / 里程 */}
      <Text class={CLASS.counter} style={{ translateX: COUNTERS.workhourValue.x, translateY: COUNTERS.workhourValue.y, width: COUNTERS.workhourValue.w, height: COUNTERS.workhourValue.h }}>
        {formatWorkhour(state()?.workHours)}
      </Text>
      <Text class={CLASS.counterLabel} style={{ translateX: COUNTERS.odomLabel.x, translateY: COUNTERS.odomLabel.y, width: COUNTERS.odomLabel.w, height: COUNTERS.odomLabel.h }}>
        ODO
      </Text>
      <Text class={CLASS.counter} style={{ translateX: COUNTERS.odomValue.x, translateY: COUNTERS.odomValue.y, width: COUNTERS.odomValue.w, height: COUNTERS.odomValue.h }}>
        {formatOdometer(state()?.odometerKm)}
      </Text>

      {/* 转向 */}
      <Show when={usable(state()?.steerAngleDeg) && (state()?.steerAngleDeg.value ?? 0) < 0}>
        <Image src={BAKED["210_directionLeft_01"].src} class="absolute left-0 top-0" style={imageBox("210_directionLeft_01", STEER.leftIcon.x, STEER.leftIcon.y)} />
      </Show>
      <Show when={usable(state()?.steerAngleDeg) && (state()?.steerAngleDeg.value ?? 0) > 0}>
        <Image src={BAKED["211_directionRight_01"].src} class="absolute left-0 top-0" style={imageBox("211_directionRight_01", STEER.rightIcon.x, STEER.rightIcon.y)} />
      </Show>
      <Text class={CLASS.steerValue} style={{ translateX: STEER.leftValue.x, translateY: STEER.leftValue.y, width: STEER.leftValue.w, height: STEER.leftValue.h }}>
        {formatSteerAngle(state()?.steerAngleDeg)}
      </Text>

      {/* 车辆图形 */}
      <Show when={gearBaked()}>
        {(asset) => <Image src={BAKED[asset()].src} class="absolute left-0 top-0" style={imageBox(asset(), VEHICLE.gear.x, VEHICLE.gear.y)} />}
      </Show>
      <Image
        src={hasFault() ? BAKED.forklift_1.src : BAKED.forklift.src}
        class="absolute left-0 top-0"
        style={imageBox(hasFault() ? "forklift_1" : "forklift", VEHICLE.forklift.x, VEHICLE.forklift.y)}
      />

      {/* 通用状态矩阵 */}
      <For each={STATUS_ICONS}>
        {(icon, index) => (
          <Show when={statusVisible(icon)}>
            <Image
              src={BAKED[statusAsset(icon)].src}
              class="absolute left-0 top-0"
              style={imageBox(statusAsset(icon), statusIconPosition(index()).x, statusIconPosition(index()).y)}
            />
          </Show>
        )}
      </For>

      {/* 底部导航图标 */}
      <View class="absolute left-0 top-0" style={{ translateX: BOTTOM_BUTTONS.home.x, translateY: BOTTOM_BUTTONS.home.y, width: BOTTOM_BUTTONS.home.w, height: BOTTOM_BUTTONS.home.h }} focusable onPress={press}>
        <Image src={BAKED.home_1.src} class="absolute left-0 top-0" style={centeredInSlot("home_1", BOTTOM_BUTTONS.home.w, BOTTOM_BUTTONS.home.h)} />
      </View>
      <View class="absolute left-0 top-0" style={{ translateX: BOTTOM_BUTTONS.monitor.x, translateY: BOTTOM_BUTTONS.monitor.y, width: BOTTOM_BUTTONS.monitor.w, height: BOTTOM_BUTTONS.monitor.h }} focusable onPress={press}>
        <Image src={BAKED.find_0.src} class="absolute left-0 top-0" style={centeredInSlot("find_0", BOTTOM_BUTTONS.monitor.w, BOTTOM_BUTTONS.monitor.h)} />
      </View>
      <View class="absolute left-0 top-0" style={{ translateX: BOTTOM_BUTTONS.fault.x, translateY: BOTTOM_BUTTONS.fault.y, width: BOTTOM_BUTTONS.fault.w, height: BOTTOM_BUTTONS.fault.h }} focusable onPress={press}>
        <Image src={BAKED.error_0.src} class="absolute left-0 top-0" style={centeredInSlot("error_0", BOTTOM_BUTTONS.fault.w, BOTTOM_BUTTONS.fault.h)} />
      </View>
      <View class="absolute left-0 top-0" style={{ translateX: BOTTOM_BUTTONS.set.x, translateY: BOTTOM_BUTTONS.set.y, width: BOTTOM_BUTTONS.set.w, height: BOTTOM_BUTTONS.set.h }} focusable onPress={press}>
        <Image src={BAKED.set_0.src} class="absolute left-0 top-0" style={centeredInSlot("set_0", BOTTOM_BUTTONS.set.w, BOTTOM_BUTTONS.set.h)} />
      </View>
    </View>
  );
}
