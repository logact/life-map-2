/* eslint-disable react-hooks/immutability -- this hook's whole job is
   imperative shared-value writes: the camera lives in Reanimated shared
   values updated from gesture handlers and effects, never during render */
import { useLayoutEffect, useState } from "react";
import {
  cancelAnimation,
  Easing,
  runOnJS,
  SharedValue,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { computeFitView, contentCenter, FitView } from "@/map/fitZoom";
import { LENS_FRAME_FILL, MAX_USER_SCALE, MIN_USER_SCALE } from "../constants";
import { composedCam } from "../utils";

// the live camera as shared values: evaluated on the UI thread by the
// edge layer's transform and each node's animated style, so pan/pinch
// never re-renders React. Readable synchronously from the JS thread
// (.value) for gesture math and world<->screen conversions
export interface CameraSv {
  panX: SharedValue<number>;
  panY: SharedValue<number>;
  userScale: SharedValue<number>;
  baseScale: SharedValue<number>;
  baseX: SharedValue<number>;
  baseY: SharedValue<number>;
  screenW: SharedValue<number>;
  screenH: SharedValue<number>;
}

// Camera = base × user pinch zoom + user pan. The base is IDENTITY
// (natural size) by default — it becomes a computed fit only through
// fitToContent (the fit button). `userScale` is the pinch zoom composed
// on top (about the screen center, see composedCam) and the pan offsets.
// Domain coordinates never change:
// screen = world * cam.scale + cam offset + pan.
//
// Two faces of the same camera:
// - sv: the live shared values, the only source rendering reads
// - the settled mirror (cam/viewport returned as React state): synced on
//   gesture release and at the end of programmatic moves, for JS
//   derivations that don't need 60fps (the grid-dot window, hitSlop, the
//   connect preview's counter-scale constants)
export function useMapCamera(width: number, height: number) {
  const panX = useSharedValue(0);
  const panY = useSharedValue(0);
  const userScale = useSharedValue(1);
  const baseScale = useSharedValue(1);
  const baseX = useSharedValue(0);
  const baseY = useSharedValue(0);
  const screenW = useSharedValue(width);
  const screenH = useSharedValue(height);
  useLayoutEffect(() => {
    screenW.value = width;
    screenH.value = height;
  }, [width, height, screenW, screenH]);
  // stable bundle handed to the memoized glyphs: created once (the shared
  // values themselves have stable identity)
  const [sv] = useState<CameraSv>(() => ({
    panX,
    panY,
    userScale,
    baseScale,
    baseX,
    baseY,
    screenW,
    screenH,
  }));

  // settled mirror (see the header comment)
  const [settled, setSettled] = useState({
    viewport: { x: 0, y: 0 },
    userScale: 1,
    baseFit: { scale: 1, x: 0, y: 0 },
  });
  const cam = composedCam(settled.baseFit, settled.userScale, { width, height });

  // JS-thread readers: shared values read synchronously. These replace the
  // old fitRef/viewportRef — same values, always current (even mid-gesture)
  const getCam = (): FitView => ({
    scale: baseScale.value * userScale.value,
    x: (screenW.value / 2) * (1 - userScale.value) + userScale.value * baseX.value,
    y: (screenH.value / 2) * (1 - userScale.value) + userScale.value * baseY.value,
  });
  const getViewport = () => ({ x: panX.value, y: panY.value });

  // sync the settled mirror from the live values; fires one React render
  // per gesture END (never per frame)
  const settleCamera = () => {
    setSettled({
      viewport: { x: panX.value, y: panY.value },
      userScale: userScale.value,
      baseFit: { scale: baseScale.value, x: baseX.value, y: baseY.value },
    });
  };

  const cancelCameraTween = () => {
    cancelAnimation(panX);
    cancelAnimation(panY);
    cancelAnimation(userScale);
    cancelAnimation(baseScale);
    cancelAnimation(baseX);
    cancelAnimation(baseY);
  };

  // one-finger pan: direct shared-value writes, no React render
  const panTo = (x: number, y: number) => {
    panX.value = x;
    panY.value = y;
  };

  // continuous pinch camera zoom, anchored at the pinch midpoint (mx, my):
  // the world point under it keeps its screen position
  const pinchCameraZoom = (ratio: number, mx: number, my: number) => {
    cancelCameraTween();
    const z = Math.min(MAX_USER_SCALE, Math.max(MIN_USER_SCALE, userScale.value * ratio));
    if (z === userScale.value) return;
    const camNow = getCam();
    const wx = (mx - panX.value - camNow.x) / camNow.scale;
    const wy = (my - panY.value - camNow.y) / camNow.scale;
    userScale.value = z;
    const newCam = getCam();
    panX.value = mx - wx * newCam.scale - newCam.x;
    panY.value = my - wy * newCam.scale - newCam.y;
  };

  // center a world point on screen instantly (search results, confirmed
  // routes): userPan = (screenCenter - world * scale) - camOffset
  const centerOnPoint = (wx: number, wy: number) => {
    cancelCameraTween();
    const camNow = getCam();
    panX.value = screenW.value / 2 - wx * camNow.scale - camNow.x;
    panY.value = screenH.value / 2 - wy * camNow.scale - camNow.y;
    settleCamera();
  };

  // the fit button: show every node at once. The pinch and pan reset so
  // the fitted base is the whole camera; from there a spread (userScale
  // is clamped >= MIN) walks back toward natural size
  const fitToContent = (nodes: { x: number; y: number }[]) => {
    cancelCameraTween();
    const fit = computeFitView(nodes, { width, height });
    baseScale.value = fit.scale;
    baseX.value = fit.x;
    baseY.value = fit.y;
    userScale.value = 1;
    panX.value = 0;
    panY.value = 0;
    settleCamera();
  };

  // initial placement / seed reset: center the content on screen at
  // natural size (identity base, no pinch); no-op on an empty map
  const centerOnContent = (nodes: { x: number; y: number }[]) => {
    const c = contentCenter(nodes);
    if (!c) return;
    cancelCameraTween();
    baseScale.value = 1;
    baseX.value = 0;
    baseY.value = 0;
    userScale.value = 1;
    panX.value = width / 2 - c.x;
    panY.value = height / 2 - c.y;
    settleCamera();
  };

  // lens zoom-in framing: when a spread reveals children too cramped to
  // work with, stretch the sheet (not the world) — zoom toward the group
  // until its span fills LENS_FRAME_FILL of the smaller screen dimension,
  // centered. Only ever zooms IN: a camera that already gives the group
  // room is left alone
  const frameNodes = (nodes: { x: number; y: number }[]) => {
    if (nodes.length === 0) return;
    cancelCameraTween();
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const n of nodes) {
      if (n.x < minX) minX = n.x;
      if (n.y < minY) minY = n.y;
      if (n.x > maxX) maxX = n.x;
      if (n.y > maxY) maxY = n.y;
    }
    const span = Math.max(maxX - minX, maxY - minY);
    if (span <= 0) return; // a single point: nothing to stretch
    const base = { scale: baseScale.value, x: baseX.value, y: baseY.value };
    const target = Math.min(
      base.scale * MAX_USER_SCALE,
      (LENS_FRAME_FILL * Math.min(width, height)) / span,
    );
    if (target <= base.scale * userScale.value) return; // already roomy
    const z = target / base.scale;
    userScale.value = z;
    const newCam = composedCam(base, z, { width, height });
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    panX.value = width / 2 - cx * newCam.scale - newCam.x;
    panY.value = height / 2 - cy * newCam.scale - newCam.y;
    settleCamera();
  };

  // programmatic camera pan (e.g. keeping a focused object clear of the
  // bottom panel): a short ease-out cubic tween on the UI thread. Any user
  // gesture cancels it — see cancelCameraTween — so the camera never
  // fights the finger
  const panByAnimated = (dx: number, dy: number, ms = 180) => {
    cancelCameraTween();
    const ease = { duration: ms, easing: Easing.out(Easing.cubic) };
    panX.value = withTiming(panX.value + dx, ease);
    panY.value = withTiming(panY.value + dy, ease, (finished) => {
      if (finished) runOnJS(settleCamera)();
    });
  };

  return {
    sv,
    cam,
    viewport: settled.viewport,
    getCam,
    getViewport,
    settleCamera,
    cancelCameraTween,
    panTo,
    pinchCameraZoom,
    centerOnPoint,
    fitToContent,
    centerOnContent,
    frameNodes,
    panByAnimated,
  };
}
