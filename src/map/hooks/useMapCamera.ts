import { useLayoutEffect, useRef, useState } from "react";

import { computeFitView, contentCenter, FitView } from "@/map/fitZoom";
import { LENS_FRAME_FILL, MAX_USER_SCALE, MIN_USER_SCALE } from "../constants";
import { composedCam } from "../utils";

// Camera = base × user pinch zoom + user pan. The base is IDENTITY
// (natural size) by default — it becomes a computed fit only through
// fitToContent (the fit button). `userScale` is the pinch zoom composed
// on top (about the screen center, see composedCam) and `viewport` is
// the user's pan. Domain coordinates never change:
// screen = world * cam.scale + cam offset + viewport.
export function useMapCamera(width: number, height: number) {
  const [viewport, setViewport] = useState({ x: 0, y: 0 });
  const viewportRef = useRef(viewport);
  useLayoutEffect(() => {
    viewportRef.current = viewport;
  });
  const [userScale, setUserScale] = useState(1);
  const userScaleRef = useRef(userScale);
  useLayoutEffect(() => {
    userScaleRef.current = userScale;
  });
  // the base camera: identity (natural size, no centering) until the fit
  // button replaces it with a computed fit of the visible nodes
  const [baseFit, setBaseFit] = useState<FitView>({ scale: 1, x: 0, y: 0 });
  // the composed camera (zoom + centering offset, without the pan);
  // baseFitRef/fitRef mirror the state so the once-created pan responder
  // can do world <-> screen conversion — synced on every commit
  const cam = composedCam(baseFit, userScale, { width, height });
  const baseFitRef = useRef<FitView>(baseFit);
  const fitRef = useRef<FitView>(cam);
  useLayoutEffect(() => {
    baseFitRef.current = baseFit;
    fitRef.current = cam;
  });

  // the fit button: show every node at once. The pinch and pan reset so
  // the fitted base is the whole camera; from there a spread (userScale
  // is clamped >= 1) walks back toward natural size
  const fitToContent = (nodes: { x: number; y: number }[]) => {
    cancelCameraTween();
    setBaseFit(computeFitView(nodes, { width, height }));
    setUserScale(1);
    setViewport({ x: 0, y: 0 });
  };

  // initial placement / seed reset: center the content on screen at
  // natural size (identity base, no pinch); no-op on an empty map
  const centerOnContent = (nodes: { x: number; y: number }[]) => {
    const c = contentCenter(nodes);
    if (!c) return;
    cancelCameraTween();
    setBaseFit({ scale: 1, x: 0, y: 0 });
    setUserScale(1);
    setViewport({ x: width / 2 - c.x, y: height / 2 - c.y });
  };

  // continuous pinch camera zoom, anchored at the pinch midpoint (mx, my):
  // the world point under it keeps its screen position
  const pinchCameraZoom = (ratio: number, mx: number, my: number) => {
    cancelCameraTween();
    const z = Math.min(MAX_USER_SCALE, Math.max(MIN_USER_SCALE, userScaleRef.current * ratio));
    if (z === userScaleRef.current) return;
    const cam = fitRef.current;
    const vp = viewportRef.current;
    const wx = (mx - vp.x - cam.x) / cam.scale;
    const wy = (my - vp.y - cam.y) / cam.scale;
    userScaleRef.current = z;
    setUserScale(z);
    const newCam = composedCam(baseFitRef.current, z, { width, height });
    setViewport({
      x: mx - wx * newCam.scale - newCam.x,
      y: my - wy * newCam.scale - newCam.y,
    });
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
    const cam = fitRef.current;
    const base = baseFitRef.current;
    const target = Math.min(
      base.scale * MAX_USER_SCALE,
      (LENS_FRAME_FILL * Math.min(width, height)) / span,
    );
    if (target <= cam.scale) return; // already roomy: respect the camera
    const z = target / base.scale;
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    userScaleRef.current = z;
    setUserScale(z);
    const newCam = composedCam(base, z, { width, height });
    setViewport({
      x: width / 2 - cx * newCam.scale - newCam.x,
      y: height / 2 - cy * newCam.scale - newCam.y,
    });
  };

  // programmatic camera pan (e.g. keeping a focused object clear of the
  // bottom panel): a short ease-out tween. Any user gesture cancels it —
  // see cancelCameraTween — so the camera never fights the finger
  const tweenRafRef = useRef<number | null>(null);
  const cancelCameraTween = () => {
    if (tweenRafRef.current !== null) {
      cancelAnimationFrame(tweenRafRef.current);
      tweenRafRef.current = null;
    }
  };
  const panByAnimated = (dx: number, dy: number, ms = 180) => {
    cancelCameraTween();
    const start = viewportRef.current;
    const t0 = Date.now();
    const tick = () => {
      const t = Math.min(1, (Date.now() - t0) / ms);
      const ease = 1 - Math.pow(1 - t, 3);
      const v = { x: start.x + dx * ease, y: start.y + dy * ease };
      viewportRef.current = v;
      setViewport(v);
      tweenRafRef.current = t < 1 ? requestAnimationFrame(tick) : null;
    };
    tweenRafRef.current = requestAnimationFrame(tick);
  };

  return {
    viewport,
    setViewport,
    userScale,
    cam,
    viewportRef,
    userScaleRef,
    baseFitRef,
    fitRef,
    fitToContent,
    centerOnContent,
    frameNodes,
    pinchCameraZoom,
    panByAnimated,
    cancelCameraTween,
  };
}
