import { useLayoutEffect, useRef, useState } from "react";
import {
  AmbientLight,
  ACESFilmicToneMapping,
  DirectionalLight,
  OrthographicCamera,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from "three";
import { useUiPreferences } from "../../../services/uiPrefs";
import { STATUS_META, TYPE_LABEL } from "../../../components/BusinessUI";
import { useDeviceVisual } from "./DeviceVisualProvider";
import DeviceIcon from "./DeviceIcon";
import { buildDeviceModel } from "./models";
import type { DeviceModel } from "./modelTypes";
import { VisualGrowthCoordinator } from "./focusMotion";
import { configureDeviceCamera, projectDevicePoint } from "./projection";
import { modelKindForType } from "./visualConfig";
import type { DeviceAnchor, ScenePointerInput } from "./DeviceSceneBridge";
import type { GrowthLayerProps } from "./DeviceGrowthHost";
import "./deviceGrowth.css";

type Display = { id: string | null; phase: string; unavailable: boolean };
type Runtime = { refresh: () => void; rotate: (delta: number) => void };

/** The only Factory renderer. Business selection is read from Workspace props. */
export default function DeviceGrowthLayer(props: GrowthLayerProps) {
  const host = useRef<HTMLDivElement>(null),
    canvas = useRef<HTMLCanvasElement>(null);
  const hit = useRef<HTMLDivElement>(null),
    card = useRef<HTMLDivElement>(null);
  const runtime = useRef<Runtime | null>(null);
  const visual = useDeviceVisual();
  const { theme, reducedMotion } = useUiPreferences();
  const latest = useRef({ ...props, visual, theme, reducedMotion });
  latest.current = { ...props, visual, theme, reducedMotion };
  const [display, setDisplay] = useState<Display>({
    id: null,
    phase: "idle",
    unavailable: false,
  });

  useLayoutEffect(() => {
    const hostNode = host.current,
      drawing = canvas.current;
    if (!hostNode || !drawing) return;
    const element: HTMLDivElement = hostNode,
      { bridge } = latest.current;
    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({
        canvas: drawing,
        alpha: true,
        antialias: true,
        powerPreference: "low-power",
      });
      renderer.outputColorSpace = SRGBColorSpace;
      renderer.toneMapping = ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.1;
      renderer.setClearColor(0x000000, 0);
      renderer.autoClear = false;
      renderer.info.autoReset = false;
      drawing.dataset.factoryRenderer = "webgl";
    } catch {
      element.dataset.growthPhase = "unavailable";
      bridge.setReadiness("unavailable");
      setDisplay({ id: null, phase: "unavailable", unavailable: true });
      return;
    }
    const scene = new Scene(),
      camera = new OrthographicCamera(),
      growth = new VisualGrowthCoordinator(4);
    scene.add(new AmbientLight(0xffffff, 2.25));
    const light = new DirectionalLight(0xffffff, 3);
    light.position.set(-3, 5, 4);
    scene.add(light);
    const instances = new Map<
      string,
      { model: DeviceModel; key: string; angle: number }
    >();
    let disposed = false,
      available = true,
      frame = 0,
      last = 0,
      width = 0,
      height = 0,
      pixelRatio = 0,
      renders = 0,
      builds = 0,
      lastDrawKey = "",
      interactive = false,
      hiddenAt: number | null = null;
    let visibleDisplay: Display = {
      id: null,
      phase: "idle",
      unavailable: false,
    };
    let rotation: {
      id: number;
      x: number;
      y: number;
      pointerType: string;
    } | null = null;
    const releaseRotation = () => {
      const p = rotation;
      rotation = null;
      if (p && hit.current?.hasPointerCapture(p.id))
        hit.current.releasePointerCapture(p.id);
    };
    const hideUI = () => {
      interactive = false;
      releaseRotation();
      if (
        !disposed &&
        (hit.current?.contains(document.activeElement) ||
          card.current?.contains(document.activeElement))
      )
        element
          .closest(".factory-scene")
          ?.querySelector<SVGSVGElement>(".factory-svg")
          ?.focus({ preventScroll: true });
      if (hit.current) {
        Object.assign(hit.current.style, {
          pointerEvents: "none",
          width: "0px",
          height: "0px",
        });
        hit.current.tabIndex = -1;
        hit.current.setAttribute("aria-hidden", "true");
      }
      if (card.current) {
        card.current.style.pointerEvents = "none";
        card.current.style.opacity = "0";
        card.current.setAttribute("aria-hidden", "true");
        card.current
          .querySelectorAll("button")
          .forEach((b) => (b.tabIndex = -1));
      }
    };
    const drop = (id: string) => {
      bridge.blend(id, 0);
      const instance = instances.get(id);
      if (instance) {
        scene.remove(instance.model.root);
        instance.model.dispose();
        instances.delete(id);
      }
      growth.drop(id);
      lastDrawKey = "";
    };
    const dropAll = () => {
      for (const id of [...instances.keys()]) drop(id);
      growth.reset();
      hideUI();
    };
    const publish = (value: Display) => {
      if (
        value.id !== visibleDisplay.id ||
        value.phase !== visibleDisplay.phase ||
        value.unavailable !== visibleDisplay.unavailable
      ) {
        visibleDisplay = value;
        setDisplay(value);
      }
      const motion = value.id
        ? growth.entries.get(value.id)?.motion
        : undefined;
      Object.assign(element.dataset, {
        growthPhase: value.phase,
        visualDevice: value.id ?? "",
        requestedDevice: latest.current.selected ?? "",
        growthProgress: (motion?.p ?? 0).toFixed(5),
        growthVelocity: (motion?.v ?? 0).toFixed(5),
        growthEntries: String(instances.size),
        growthGeometries: String(renderer.info.memory.geometries),
        growthTextures: String(renderer.info.memory.textures),
        growthRenders: String(renders),
        growthModelBuilds: String(builds),
      });
    };
    const stop = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      last = 0;
      element.dataset.growthRaf = "idle";
    };
    const fail = () => {
      available = false;
      stop();
      dropAll();
      renderer.clear();
      bridge.setReadiness("unavailable");
      publish({ id: null, phase: "unavailable", unavailable: true });
    };
    const positionUI = (anchor: DeviceAnchor, p: number) => {
      const points = [];
      for (const x of [-1.15, 1.15])
        for (const z of [-1.15, 1.15])
          for (const y of [0, 1.7])
            points.push(projectDevicePoint(anchor.matrix, { x, y, z }));
      const left = Math.max(0, Math.min(...points.map((p) => p.x))),
        top = Math.max(0, Math.min(...points.map((p) => p.y)));
      if (hit.current) {
        Object.assign(hit.current.style, {
          left: "0px",
          top: "0px",
          transform: `translate3d(${left}px,${top}px,0)`,
          width: `${Math.max(0, Math.min(anchor.width, Math.max(...points.map((p) => p.x))) - left)}px`,
          height: `${Math.max(0, Math.min(anchor.height, Math.max(...points.map((p) => p.y))) - top)}px`,
          pointerEvents: interactive ? "auto" : "none",
        });
        hit.current.tabIndex = interactive ? 0 : -1;
        hit.current.setAttribute("aria-hidden", String(!interactive));
      }
      if (card.current) {
        const center = projectDevicePoint(anchor.matrix, { x: 0, y: 0, z: 0 }),
          bottom = projectDevicePoint(anchor.matrix, { x: 1, y: 0, z: 1 }),
          t = Math.max(0, Math.min(1, (p - 0.75) / 0.25)),
          opacity = t * t * (3 - 2 * t),
          w = card.current.offsetWidth,
          h = card.current.offsetHeight,
          x = Math.max(8, Math.min(anchor.width - w - 8, center.x - w / 2)),
          y = Math.max(8, Math.min(anchor.height - h - 8, bottom.y + 12));
        Object.assign(card.current.style, {
          left: "0px",
          top: "0px",
          transform: `translate3d(${x}px,${y + (1 - opacity) * 6}px,0)`,
          opacity: String(opacity),
          pointerEvents: interactive ? "auto" : "none",
        });
        card.current.setAttribute("aria-hidden", String(!interactive));
        card.current
          .querySelectorAll("button")
          .forEach((b) => (b.tabIndex = interactive ? 0 : -1));
      }
    };
    const schedule = () => {
      if (!frame && available && !disposed && !document.hidden) {
        element.dataset.growthRaf = "active";
        frame = requestAnimationFrame((now) => {
          frame = 0;
          update(now);
        });
      }
    };
    function update(now: number) {
      if (disposed || !available || document.hidden) return;
      cancelAnimationFrame(frame);
      frame = 0;
      const p = latest.current,
        requested = p.devices.find(
          (d) => d.id === p.selected && p.visibleIds.has(d.id),
        ),
        desired = requested && bridge.read(requested.id) ? requested.id : null,
        elapsed = last ? Math.max(0, Math.min(50, now - last)) : 0;
      last = now;
      growth.update(desired, bridge.focus(), now, elapsed, p.reducedMotion);
      for (const id of [...instances.keys()])
        if (!growth.entries.has(id) || !bridge.read(id)) drop(id);
      for (const id of [...growth.entries.keys()])
        if (!bridge.read(id)) growth.drop(id);
      const prepared: {
        id: string;
        anchor: DeviceAnchor;
        instance: { model: DeviceModel; key: string; angle: number };
        progress: number;
        accent: string;
      }[] = [];
      try {
        for (const [id, entry] of growth.entries) {
          const device = p.devices.find((d) => d.id === id),
            anchor = bridge.read(id);
          if (!device || !anchor) continue;
          const appearance = p.visual.get(device),
            kind = modelKindForType(device.device_type),
            key = `${kind}:${p.theme}`;
          let instance = instances.get(id);
          if (!instance || instance.key !== key) {
            const angle = instance?.angle ?? 0;
            if (instance) {
              scene.remove(instance.model.root);
              instance.model.dispose();
            }
            instance = {
              model: buildDeviceModel(
                kind,
                appearance.accentColor,
                p.theme === "light",
              ),
              key,
              angle,
            };
            instances.set(id, instance);
            scene.add(instance.model.root);
            builds++;
            lastDrawKey = "";
          }
          instance.model.setAccent(appearance.accentColor);
          instance.model.applyProgress(entry.motion.p);
          instance.model.turntable.rotation.y = instance.angle;
          bridge.blend(id, entry.motion.p);
          prepared.push({
            id,
            anchor,
            instance,
            progress: entry.motion.p,
            accent: appearance.accentColor,
          });
        }
        const size = prepared[0]?.anchor;
        if (
          size &&
          (width !== size.width ||
            height !== size.height ||
            pixelRatio !== Math.min(devicePixelRatio, 1.5))
        ) {
          width = size.width;
          height = size.height;
          pixelRatio = Math.min(devicePixelRatio, 1.5);
          renderer.setPixelRatio(pixelRatio);
          renderer.setSize(width, height, false);
        }
        const drawKey = JSON.stringify([
          width,
          height,
          pixelRatio,
          p.theme,
          prepared.map((e) => [
            e.id,
            e.progress,
            e.accent,
            e.instance.angle,
            e.anchor.matrix,
          ]),
        ]);
        if (drawKey !== lastDrawKey) {
          renderer.clear();
          renderer.info.reset();
          for (const item of prepared) {
            for (const instance of instances.values())
              instance.model.root.visible =
                instance === item.instance && item.progress > 0;
            if (
              !configureDeviceCamera(camera, item.anchor.matrix, width, height)
            ) {
              fail();
              return;
            }
            renderer.clearDepth();
            renderer.render(scene, camera);
          }
          renders++;
          lastDrawKey = drawKey;
        }
        const selected = prepared.find((e) => e.id === desired),
          motion = desired ? growth.entries.get(desired)?.motion : undefined,
          phase =
            motion?.phase ?? (growth.entries.size ? "collapsing" : "idle");
        interactive = Boolean(
          selected && phase === "expanded" && !selected.anchor.pointerBusy,
        );
        if (!interactive) releaseRotation();
        if (selected && motion) {
          positionUI(selected.anchor, motion.p);
          element.dataset.growthAngle = selected.instance.angle.toFixed(4);
          element.dataset.growthTriangles = String(
            renderer.info.render.triangles,
          );
          if (import.meta.env.DEV) {
            configureDeviceCamera(
              camera,
              selected.anchor.matrix,
              width,
              height,
            );
            const corners = [
              [0, -35],
              [103, 19],
              [0, 74],
              [-103, 19],
            ].map(([x, y]) => {
              const point = new Vector3(
                (x / 51.5 + (y - 19.5) / 27.25) / 2,
                0,
                (-x / 51.5 + (y - 19.5) / 27.25) / 2,
              ).project(camera);
              return {
                x: ((point.x + 1) * width) / 2,
                y: ((1 - point.y) * height) / 2,
              };
            });
            Object.assign(element, {
              __growthQA: {
                matrix: selected.anchor.matrix,
                width,
                height,
                corners,
                stats: selected.instance.model.stats,
                sequence: selected.anchor.sequence,
                entries: prepared.map((e) => ({ id: e.id, p: e.progress })),
                focus: bridge.focus(),
              },
            });
          }
        } else hideUI();
        publish({ id: selected?.id ?? null, phase, unavailable: false });
        if (growth.moving && !prepared.some((e) => e.anchor.sceneMoving))
          schedule();
        else {
          element.dataset.growthRaf = "idle";
          if (!growth.moving) last = 0;
        }
      } catch (error) {
        console.error("Device growth unavailable", error);
        fail();
      }
    }
    const refresh = () => {
      if (available) update(performance.now());
    };
    const rotate = (delta: number) => {
      const instance = latest.current.selected
        ? instances.get(latest.current.selected)
        : undefined;
      if (!interactive || !instance) return;
      instance.angle = Math.max(-0.95, Math.min(0.95, instance.angle + delta));
      refresh();
    };
    runtime.current = { refresh, rotate };
    const off = bridge.subscribe(update);
    const visibility = () => {
      stop();
      releaseRotation();
      if (document.hidden) {
        hiddenAt = performance.now();
        element.dataset.growthRaf = "hidden";
      } else {
        if (hiddenAt !== null) growth.pause(performance.now() - hiddenAt);
        hiddenAt = null;
        refresh();
      }
    };
    const lost = (event: Event) => {
        event.preventDefault();
        fail();
      },
      restored = () => {
        if (disposed) return;
        available = true;
        last = 0;
        bridge.setReadiness("ready");
        refresh();
      };
    let resolution: MediaQueryList | undefined,
      resolutionFrame = 0;
    const observeResolution = () => {
      resolution?.removeEventListener("change", resolutionChanged);
      resolution = matchMedia(`(resolution: ${devicePixelRatio}dppx)`);
      resolution.addEventListener("change", resolutionChanged);
    };
    const resolutionChanged = () => {
      cancelAnimationFrame(resolutionFrame);
      resolutionFrame = requestAnimationFrame(() => {
        resolutionFrame = 0;
        if (!disposed) {
          observeResolution();
          refresh();
        }
      });
    };
    observeResolution();
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("resize", refresh);
    drawing.addEventListener("webglcontextlost", lost);
    drawing.addEventListener("webglcontextrestored", restored);
    const hitElement = hit.current;
    const offTransfer = bridge.registerRotationTransfer((event) => {
      if (
        !rotation ||
        event.pointerType !== "touch" ||
        rotation.pointerType !== "touch" ||
        event.pointerId === rotation.id
      )
        return null;
      const first: ScenePointerInput = {
        pointerId: rotation.id,
        clientX: rotation.x,
        clientY: rotation.y,
        button: 0,
        pointerType: rotation.pointerType,
        target: hitElement,
      };
      rotation = null;
      return first;
    });
    const down = (event: PointerEvent) => {
      if (!interactive || event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      if (
        rotation &&
        event.pointerId !== rotation.id &&
        event.pointerType === "touch"
      ) {
        bridge.pointerDown(event);
        return;
      }
      rotation = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        pointerType: event.pointerType,
      };
      hitElement?.setPointerCapture(event.pointerId);
    };
    const drag = (event: PointerEvent) => {
      if (!rotation || rotation.id !== event.pointerId) return;
      const delta = event.clientX - rotation.x;
      rotation.x = event.clientX;
      rotation.y = event.clientY;
      rotate(delta * 0.009);
    };
    const up = (event: PointerEvent) => {
        if (rotation?.id === event.pointerId) releaseRotation();
      },
      wheel = (event: WheelEvent) => bridge.wheel(event),
      gesture = (event: Event) => bridge.gesture(event);
    hitElement?.addEventListener("pointerdown", down);
    hitElement?.addEventListener("pointermove", drag);
    for (const name of ["pointerup", "pointercancel", "lostpointercapture"])
      hitElement?.addEventListener(name, up as EventListener);
    hitElement?.addEventListener("wheel", wheel, { passive: false });
    for (const name of ["gesturestart", "gesturechange", "gestureend"])
      hitElement?.addEventListener(name, gesture, { passive: false });
    bridge.setReadiness("ready");
    refresh();
    return () => {
      disposed = true;
      stop();
      off();
      offTransfer();
      dropAll();
      runtime.current = null;
      bridge.setReadiness("cold");
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("resize", refresh);
      resolution?.removeEventListener("change", resolutionChanged);
      cancelAnimationFrame(resolutionFrame);
      drawing.removeEventListener("webglcontextlost", lost);
      drawing.removeEventListener("webglcontextrestored", restored);
      hitElement?.removeEventListener("pointerdown", down);
      hitElement?.removeEventListener("pointermove", drag);
      for (const name of ["pointerup", "pointercancel", "lostpointercapture"])
        hitElement?.removeEventListener(name, up as EventListener);
      hitElement?.removeEventListener("wheel", wheel);
      for (const name of ["gesturestart", "gesturechange", "gestureend"])
        hitElement?.removeEventListener(name, gesture);
      scene.clear();
      renderer.dispose();
      delete drawing.dataset.factoryRenderer;
      queueMicrotask(() => {
        if (!drawing.isConnected) renderer.forceContextLoss();
      });
    };
  }, []);

  const visibleKey = [...props.visibleIds].sort().join("|");
  useLayoutEffect(
    () => runtime.current?.refresh(),
    [
      props.devices,
      props.selected,
      visibleKey,
      visual,
      theme,
      reducedMotion,
      display.id,
      display.phase,
    ],
  );
  const device = props.devices.find((d) => d.id === display.id);
  const appearance = device ? visual.get(device) : null;
  return (
    <div
      ref={host}
      className="device-growth"
      data-growth-layer
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          props.bridge.clear();
        }
      }}
    >
      <canvas ref={canvas} className="device-growth__canvas" aria-hidden />
      <div
        ref={hit}
        className="device-growth__hit"
        role="group"
        tabIndex={-1}
        aria-label={`${device?.name ?? "设备"}三维示意，拖动或左右键旋转，Esc 收起`}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            event.preventDefault();
            runtime.current?.rotate(event.key === "ArrowLeft" ? -0.15 : 0.15);
          }
        }}
      />
      {device && appearance && (
        <div
          ref={card}
          className="device-growth__card"
          aria-label="三维设备资料"
        >
          <div className="device-growth__identity">
            <DeviceIcon
              icon={appearance.iconKey}
              color={appearance.accentColor}
            />
            <strong title={appearance.displayAlias ?? device.name}>
              {appearance.displayAlias ?? device.name}
            </strong>
            <span
              className="device-growth__status"
              style={{ color: STATUS_META[device.status]?.hex }}
            >
              {STATUS_META[device.status]?.label ?? device.status}
            </span>
          </div>
          <small>
            {device.id} · {TYPE_LABEL[device.device_type] ?? device.device_type}{" "}
            ·{" "}
            {modelKindForType(device.device_type) === "generic"
              ? "通用示意"
              : "三维示意"}
          </small>
          {appearance.displayAlias && <small>真实名称：{device.name}</small>}
          <div className="device-growth__actions">
            <span>
              <button
                type="button"
                aria-label="向左旋转设备"
                onClick={() => runtime.current?.rotate(-0.2)}
              >
                ↶
              </button>
              <button
                type="button"
                aria-label="向右旋转设备"
                onClick={() => runtime.current?.rotate(0.2)}
              >
                ↷
              </button>
            </span>
            <button
              className="device-growth__close"
              type="button"
              onClick={() => props.bridge.clear()}
            >
              收起三维
            </button>
          </div>
        </div>
      )}
      {display.unavailable && props.selected && (
        <p className="device-growth__unavailable" role="status">
          三维暂不可用，设备平面视图与业务入口仍可使用。
        </p>
      )}
    </div>
  );
}
