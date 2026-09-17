import { useLayoutEffect, useRef, useState } from "react";

import { FitView } from "@/app/fitZoom";
import { MAX_USER_SCALE, MIN_USER_SCALE } from "../constants";
import { composedCam } from "../utils";

// Camera = fit-zoom × user pinch zoom + user pan. The fit view (scale +
// centering offset) is recomputed from the visible nodes on every render;
// `userScale` is the pinch zoom composed on top of it (about the screen
// center, see composedCam) and `viewport` is the user's pan. Domain
// coordinates never change: screen = world * cam.scale + cam offset +
// viewport.
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
  // the raw fit view and the latest composed camera (zoom + centering
  // offset, without the pan), read by the once-created pan responder for
  // world <-> screen conversion; synced by the screen on every commit
  const baseFitRef = useRef<FitView>({ scale: 1, x: 0, y: 0 });
  const fitRef = useRef({ scale: 1, x: 0, y: 0 });

  // continuous pinch camera zoom, anchored at the pinch midpoint (mx, my):
  // the world point under it keeps its screen position
  const pinchCameraZoom = (ratio: number, mx: number, my: number) => {
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

  return {
    viewport,
    setViewport,
    userScale,
    viewportRef,
    userScaleRef,
    baseFitRef,
    fitRef,
    pinchCameraZoom,
  };
}
