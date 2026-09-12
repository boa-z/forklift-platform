// 主屏：按 docs/ui-main-screen.md 的 ground truth 复刻参考仪表首屏。
// 坐标来自 layout.ts；素材尺寸来自构建期烘焙的 assets.gen.ts。

import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { Image, Text, View } from "@pocketjs/framework/components";
import { onFrame } from "@pocketjs/framework/lifecycle";

import type { FaultSnapshot, Platform, VehicleState } from "../../platform";
import { playButton } from "../../platform/feedback";
import BottomNav from "../../components/BottomNav";
import DigitNumber from "../../components/DigitNumber";
import ScreenBackground from "../../components/ScreenBackground";
import type { TabId } from "../../nav/nav";
import { CLASS, SCREEN_CLASS, socFillClass, speedDigitSet } from "../../theme/theme";
import { BAKED, type BakedAsset } from "./assets.gen";
import {
  formatClock,
  formatOdometer,
  formatSoc,
  formatSpeed,
  formatSteerAngle,
  formatWorkhour,
  gear,
  socBarShape,
  socSegmentAsset,
  SOC_SEGMENT_PITCH,
  usable,
} from "./format";
import {
  COUNTERS,
  SOC,
  SPEED,
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

/** 主屏组件。 */
export default function MainScreen(props: { platform: Platform; onNavigate: (tab: TabId) => void; onOpenCamera?: () => void }) {
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
    playButton(props.platform);
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

  /** 电量条分段形状（完整分段数 + 末尾像素）。 */
  const socShape = (): { full: number; partial: number } => {
    const signal = state()?.socPercent;
    if (signal === undefined || signal.quality !== "valid") return { full: 0, partial: 0 };
    return socBarShape(signal.value);
  };

  return (
    <View class={SCREEN_CLASS}>
      {/* 背景（原始 800×480 背景图两片） */}
      <ScreenBackground id="main" />

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
      <View class="absolute left-0 top-0" style={{ translateX: TOOLBAR.camera.x, translateY: TOOLBAR.camera.y, width: TOOLBAR.camera.w, height: TOOLBAR.camera.h }} focusable onPress={() => { press(); props.onOpenCamera?.(); }}>
        <Image src={BAKED.camera_1.src} class="absolute left-0 top-0" style={imageBox("camera_1", 0, 0)} />
      </View>

      {/* 车速（54px 数字贴图，颜色随信号质量） */}
      <DigitNumber text={formatSpeed(state()?.speedKph)} set={speedDigitSet(state()?.speedKph.quality)} x={SPEED.value.x} y={SPEED.value.y} w={SPEED.value.w} h={SPEED.value.h} align="right" />
      <Text class={CLASS.speedUnit} style={{ translateX: SPEED.unit.x, translateY: SPEED.unit.y, width: SPEED.unit.w, height: SPEED.unit.h }}>
        km/h
      </Text>

      {/* 电量（分段贴图：轨道两片 + 完整分段 + 末尾像素块） */}
      <Text class={CLASS.socLabel} style={{ translateX: SOC.label.x, translateY: SOC.label.y, width: SOC.label.w, height: SOC.label.h }}>
        soc
      </Text>
      <DigitNumber text={formatSoc(state()?.socPercent)} set="soc36" x={SOC.value.x} y={SOC.value.y} w={SOC.value.w} h={SOC.value.h} align="right" />
      <Image src={BAKED.soc_track_t0.src} class="absolute left-0 top-0" style={{ translateX: SOC.bar.x, translateY: SOC.bar.y, width: BAKED.soc_track_t0.w, height: BAKED.soc_track_t0.h }} />
      <Image src={BAKED.soc_track_t1.src} class="absolute left-0 top-0" style={{ translateX: SOC.bar.x + 512, translateY: SOC.bar.y, width: BAKED.soc_track_t1.w, height: BAKED.soc_track_t1.h }} />
      <For each={Array.from({ length: socShape().full }, (_, index) => index)}>
        {(index) => (
          <Image
            src={BAKED[socSegmentAsset(state()?.socPercent.value)].src}
            class="absolute left-0 top-0"
            style={{
              translateX: SOC.bar.x + index * SOC_SEGMENT_PITCH,
              translateY: SOC.bar.y,
              width: BAKED[socSegmentAsset(state()?.socPercent.value)].w,
              height: BAKED[socSegmentAsset(state()?.socPercent.value)].h,
            }}
          />
        )}
      </For>
      <Show when={socShape().partial > 0}>
        <View class={socFillClass(state()?.socPercent)} style={{ translateX: SOC.bar.x + socShape().full * SOC_SEGMENT_PITCH, translateY: SOC.bar.y, width: socShape().partial, height: SOC.bar.h }} />
      </Show>

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
        {(asset: () => BakedAsset) => <Image src={BAKED[asset()].src} class="absolute left-0 top-0" style={imageBox(asset(), VEHICLE.gear.x, VEHICLE.gear.y)} />}
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

      {/* 底部导航 */}
      <BottomNav active="home" onNavigate={props.onNavigate} onPress={press} />
    </View>
  );
}
