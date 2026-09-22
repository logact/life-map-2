import { RefObject, useLayoutEffect, useRef, useState } from "react";
import { PanResponder } from "react-native";

import { FitView } from "@/map/fitZoom";
import { DOUBLE_TAP_MS, PINCH_RATIO } from "../constants";

// The container claims empty-space touches immediately (node Pressables
// still win on their own area) so it can detect taps. Any movement past
// the threshold becomes a pan — unless a bend drag is armed, in which
// case the drag moves the bend. A tap that stays put starts the
// double-tap window: a second tap within DOUBLE_TAP_MS opens the create
// picker, otherwise the single tap dismisses overlays. A second finger
// turns the gesture into a pinch: the camera zooms continuously with the
// finger distance, and the selection steps one detail level each time
// the accumulated distance crosses PINCH_RATIO.
//
// The camera writes go straight into shared values (panTo /
// pinchCameraZoom): no React render per frame. The settled mirror syncs
// once, on release (settleCamera).
//
// The pan responder is created ONCE, so every callback it needs arrives
// through `params` and is mirrored into `latest` on every commit — the
// responder never closes over stale handlers.
export function useCanvasGestures(params: {
  getViewport: () => { x: number; y: number };
  getCam: () => FitView;
  panTo: (x: number, y: number) => void;
  // sync the settled camera mirror once the gesture ends
  settleCamera: () => void;
  pinchCameraZoom: (ratio: number, mx: number, my: number) => void;
  zoomSelectionStep: (deeper: boolean) => void;
  // a user gesture cancels any programmatic camera tween in flight
  cancelCameraTween: () => void;
  bendDragRef: RefObject<{ edgeId: string; x: number; y: number } | null>;
  setBendDrag: (b: { edgeId: string; x: number; y: number } | null) => void;
  closeOverlays: () => void;
  openCreatePickerAt: (screenX: number, screenY: number) => void;
  // single tap on empty canvas, fired after the double-tap window lapses
  onCanvasSingleTap: () => void;
  // release of a moved bend drag commits the bend point to the domain
  commitBend: (edgeId: string, bend: { x: number; y: number }) => void;
}) {
  const { bendDragRef, setBendDrag } = params;
  // the pan responder is created once, so it reaches the latest handlers
  // through a ref instead of closing over stale ones
  const latest = useRef(params);
  useLayoutEffect(() => {
    latest.current = params;
  });

  const panStart = useRef({ x: 0, y: 0 });
  // whether the current touch has moved past the tap threshold
  const panMoved = useRef(false);
  // pinch state: baseline distance between the two fingers, whether a
  // pinch is currently active, and the accumulated ratio toward the next
  // detail step
  const pinchStart = useRef<number | null>(null);
  const pinching = useRef(false);
  const detailAcc = useRef(1);
  // pending empty-canvas tap: if a second tap lands within DOUBLE_TAP_MS it
  // becomes a double tap (create picker), else the single-tap dismiss fires
  const canvasTapRef = useRef<{ timer: ReturnType<typeof setTimeout> } | null>(null);

  const cancelCanvasTap = () => {
    if (canvasTapRef.current !== null) {
      clearTimeout(canvasTapRef.current.timer);
      canvasTapRef.current = null;
    }
  };

  // the once-created responder reads values through refs; its callbacks
  // only fire on gesture events, never during render
  // eslint-disable-next-line react-hooks/refs
  const [panResponder] = useState(() =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        panStart.current = latest.current.getViewport();
        panMoved.current = false;
        pinchStart.current = null;
        pinching.current = false;
        latest.current.cancelCameraTween();
      },
      onPanResponderMove: (e, g) => {
        const touches = e.nativeEvent.touches;
        if (touches.length >= 2) {
          // pinch: zoom the camera continuously, and step the selection's
          // detail level each time the accumulated finger-distance ratio
          // crosses PINCH_RATIO (spread = reveal, squeeze = collapse)
          pinching.current = true;
          panMoved.current = true;
          cancelCanvasTap();
          const dist = Math.hypot(
            touches[1].pageX - touches[0].pageX,
            touches[1].pageY - touches[0].pageY,
          );
          const mx = (touches[0].pageX + touches[1].pageX) / 2;
          const my = (touches[0].pageY + touches[1].pageY) / 2;
          if (pinchStart.current === null) {
            pinchStart.current = dist;
            detailAcc.current = 1;
            return;
          }
          const ratio = dist / pinchStart.current;
          pinchStart.current = dist;
          latest.current.pinchCameraZoom(ratio, mx, my);
          detailAcc.current *= ratio;
          if (detailAcc.current >= PINCH_RATIO) {
            detailAcc.current = 1;
            latest.current.zoomSelectionStep(true);
          } else if (detailAcc.current <= 1 / PINCH_RATIO) {
            detailAcc.current = 1;
            latest.current.zoomSelectionStep(false);
          }
          return;
        }
        if (pinching.current) {
          // back to one finger: re-baseline the pan so the viewport
          // doesn't jump when the remaining finger moves
          pinching.current = false;
          pinchStart.current = null;
          const vpNow = latest.current.getViewport();
          panStart.current = {
            x: vpNow.x - g.dx,
            y: vpNow.y - g.dy,
          };
        }
        const bd = bendDragRef.current;
        if (bd) {
          // bend drag: the bend point follows the finger (world coords)
          if (Math.abs(g.dx) > 4 || Math.abs(g.dy) > 4) {
            panMoved.current = true;
            const vp = latest.current.getViewport();
            const camNow = latest.current.getCam();
            setBendDrag({
              edgeId: bd.edgeId,
              x: (g.moveX - vp.x - camNow.x) / camNow.scale,
              y: (g.moveY - vp.y - camNow.y) / camNow.scale,
            });
          }
          return;
        }
        if (Math.abs(g.dx) > 4 || Math.abs(g.dy) > 4) {
          panMoved.current = true;
          cancelCanvasTap();
          latest.current.closeOverlays();
          latest.current.panTo(panStart.current.x + g.dx, panStart.current.y + g.dy);
        }
      },
      // a touch that never moved is a tap on empty canvas: it starts the
      // double-tap window. A second tap within DOUBLE_TAP_MS opens the
      // create picker there; otherwise the single tap dismisses overlays
      // (the zoom selection clearing rides on onCanvasSingleTap, so a
      // locked selection survives). A bend drag commits its bend point
      // here if the finger moved.
      onPanResponderRelease: (e) => {
        pinchStart.current = null;
        pinching.current = false;
        // one settled-mirror sync per gesture end (never per frame)
        if (panMoved.current) latest.current.settleCamera();
        const bd = bendDragRef.current;
        if (bd) {
          if (panMoved.current) {
            // the command no-ops if the edge is gone
            latest.current.commitBend(bd.edgeId, { x: bd.x, y: bd.y });
          }
          setBendDrag(null); // release without a move cancels the bend drag
          return;
        }
        if (!panMoved.current) {
          const { pageX, pageY } = e.nativeEvent;
          if (canvasTapRef.current) {
            // second tap inside the window: double tap -> create picker
            cancelCanvasTap();
            latest.current.openCreatePickerAt(pageX, pageY);
          } else {
            // first tap: its dismiss action waits out the double-tap window
            canvasTapRef.current = {
              timer: setTimeout(() => {
                canvasTapRef.current = null;
                latest.current.onCanvasSingleTap();
              }, DOUBLE_TAP_MS),
            };
          }
        }
      },
      onPanResponderTerminate: () => {
        cancelCanvasTap();
        pinchStart.current = null;
        pinching.current = false;
        if (panMoved.current) latest.current.settleCamera();
        setBendDrag(null);
      },
    }),
  );

  return { panResponder };
}
