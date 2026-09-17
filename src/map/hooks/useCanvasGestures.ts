import { RefObject, useLayoutEffect, useRef, useState } from "react";
import { PanResponder } from "react-native";

import { FitView } from "@/app/fitZoom";
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
// The pan responder is created ONCE, so every callback it needs arrives
// through `params` and is mirrored into `latest` on every commit — the
// responder never closes over stale handlers.
export function useCanvasGestures(params: {
  viewportRef: RefObject<{ x: number; y: number }>;
  fitRef: RefObject<FitView>;
  setViewport: (v: { x: number; y: number }) => void;
  pinchCameraZoom: (ratio: number, mx: number, my: number) => void;
  zoomSelectionStep: (deeper: boolean, mx: number, my: number) => void;
  bendDragRef: RefObject<{ edgeId: string; x: number; y: number } | null>;
  setBendDrag: (b: { edgeId: string; x: number; y: number } | null) => void;
  closeOverlays: () => void;
  openCreatePickerAt: (screenX: number, screenY: number) => void;
  // single tap on empty canvas, fired after the double-tap window lapses
  onCanvasSingleTap: () => void;
  // release of a moved bend drag commits the bend point to the domain
  commitBend: (edgeId: string, bend: { x: number; y: number }) => void;
}) {
  const { viewportRef, fitRef, setViewport, bendDragRef, setBendDrag } = params;
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
        panStart.current = viewportRef.current;
        panMoved.current = false;
        pinchStart.current = null;
        pinching.current = false;
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
            latest.current.zoomSelectionStep(true, mx, my);
          } else if (detailAcc.current <= 1 / PINCH_RATIO) {
            detailAcc.current = 1;
            latest.current.zoomSelectionStep(false, mx, my);
          }
          return;
        }
        if (pinching.current) {
          // back to one finger: re-baseline the pan so the viewport
          // doesn't jump when the remaining finger moves
          pinching.current = false;
          pinchStart.current = null;
          panStart.current = {
            x: viewportRef.current.x - g.dx,
            y: viewportRef.current.y - g.dy,
          };
        }
        const bd = bendDragRef.current;
        if (bd) {
          // bend drag: the bend point follows the finger (world coords)
          if (Math.abs(g.dx) > 4 || Math.abs(g.dy) > 4) {
            panMoved.current = true;
            setBendDrag({
              edgeId: bd.edgeId,
              x: (g.moveX - viewportRef.current.x - fitRef.current.x) / fitRef.current.scale,
              y: (g.moveY - viewportRef.current.y - fitRef.current.y) / fitRef.current.scale,
            });
          }
          return;
        }
        if (Math.abs(g.dx) > 4 || Math.abs(g.dy) > 4) {
          panMoved.current = true;
          cancelCanvasTap();
          latest.current.closeOverlays();
          setViewport({
            x: panStart.current.x + g.dx,
            y: panStart.current.y + g.dy,
          });
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
        setBendDrag(null);
      },
    }),
  );

  return { panResponder };
}
