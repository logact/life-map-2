import { memo, useLayoutEffect, useRef, useState } from "react";
import { PanResponder, Pressable, Text, View } from "react-native";
import Animated, { useAnimatedStyle } from "react-native-reanimated";

import { NodeKind } from "@/domain/doc";
import { STATUS_COLOR } from "@/ui/theme";
import { LONG_PRESS_MS } from "../constants";
import { CameraSv } from "../hooks/useMapCamera";
import { styles } from "../styles";
import { NodeViewModel } from "../types";
import { nodeSize } from "../utils";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

// the camera math shared by every animated style below: node screen
// position and size from the live shared values. Pins never grow past
// natural size; below 1x they shrink with the camera, so a zoomed-out
// view keeps its proportions (no overlap)
function useNodeCamStyle(sv: CameraSv, n: NodeViewModel, pos: NodeViewModel) {
  return useAnimatedStyle(() => {
    const us = sv.userScale.value;
    const camScale = sv.baseScale.value * us;
    const camX = (sv.screenW.value / 2) * (1 - us) + us * sv.baseX.value;
    const camY = (sv.screenH.value / 2) * (1 - us) + us * sv.baseY.value;
    const size = nodeSize(n.kind) * Math.min(1, camScale);
    const sx = pos.x * camScale + camX + sv.panX.value;
    const sy = pos.y * camScale + camY + sv.panY.value;
    return { left: sx - size / 2, top: sy - size / 2, width: size, height: size };
  });
}

// the corner radius tracks the animated size: task corners round at a
// fixed share of the pin, everything else is a circle
function useNodeRadiusStyle(sv: CameraSv, kind: NodeKind) {
  return useAnimatedStyle(() => {
    const camScale = sv.baseScale.value * sv.userScale.value;
    const size = nodeSize(kind) * Math.min(1, camScale);
    return { borderRadius: kind === "task" ? size * 0.2 : size / 2 };
  });
}

// one node on the canvas: tap shows info / double-tap opens its menu
// (handled by the parent), long-press arms it so a following movement
// becomes a drag that repositions it in the domain. While focused it also
// shows a connect handle: dragging from it onto another node creates an
// edge (drag direction = edge direction). Position, size, corner radius
// and title scaling all follow the live camera on the UI thread — camera
// moves never re-render this component
function DraggableNode(props: {
  n: NodeViewModel;
  pos: NodeViewModel;
  // the live camera as shared values
  sv: CameraSv;
  // for hitSlop only (touch targets don't need 60fps): the settled mirror
  settledCamScale: number;
  selected: boolean;
  dimmed: boolean;
  armed: boolean;
  // focused and not armed for moving: the connect handle is showing
  connectable: boolean;
  onPress: (id: string) => void;
  onArm: (id: string) => void;
  onDragStart: (id: string, x: number, y: number) => void;
  onDragMove: (id: string, x: number, y: number) => void;
  onDragEnd: (id: string, x: number, y: number) => void;
  // connect-drag from the handle, in screen coordinates
  onConnectStart: (id: string) => void;
  onConnectMove: (id: string, pageX: number, pageY: number) => void;
  onConnectEnd: (id: string, pageX: number, pageY: number) => void;
}) {
  // the title's natural size (records are smaller); the animated style
  // scales it with the camera below 1x, floored at 6px like before
  const baseFont = props.n.kind === "record" ? 8 : 11;
  // keep even the smallest node tappable at a comfortable touch target
  const hitSlop = Math.max(
    0,
    (44 - nodeSize(props.n.kind) * Math.min(1, props.settledCamScale)) / 2,
  );
  // the pan responder is created once, so it reads the latest props
  // through a ref instead of closing over stale ones
  const latest = useRef(props);
  useLayoutEffect(() => {
    latest.current = props;
  });
  const dragOrigin = useRef({ x: 0, y: 0 });
  // the once-created responder reads values through refs; its callbacks
  // only fire on gesture events, never during render
  // eslint-disable-next-line react-hooks/refs
  const [dragResponder] = useState(() =>
    PanResponder.create({
      // drag is only possible after a long-press armed this node; the
      // Pressable owns the touch until then (tap / double-tap / long-press)
      onMoveShouldSetPanResponder: (_e, g) =>
        latest.current.armed && (Math.abs(g.dx) > 4 || Math.abs(g.dy) > 4),
      onPanResponderGrant: () => {
        const { n, onDragStart } = latest.current;
        dragOrigin.current = { x: n.x, y: n.y };
        onDragStart(n.id, n.x, n.y);
      },
      onPanResponderMove: (_e, g) => {
        const { n, sv, onDragMove } = latest.current;
        // gesture deltas are screen px, so world deltas = px / camScale
        const camScale = sv.baseScale.value * sv.userScale.value;
        onDragMove(n.id, dragOrigin.current.x + g.dx / camScale, dragOrigin.current.y + g.dy / camScale);
      },
      onPanResponderRelease: (_e, g) => {
        const { n, sv, onDragEnd } = latest.current;
        const camScale = sv.baseScale.value * sv.userScale.value;
        onDragEnd(n.id, dragOrigin.current.x + g.dx / camScale, dragOrigin.current.y + g.dy / camScale);
      },
      onPanResponderTerminate: (_e, g) => {
        const { n, sv, onDragEnd } = latest.current;
        const camScale = sv.baseScale.value * sv.userScale.value;
        onDragEnd(n.id, dragOrigin.current.x + g.dx / camScale, dragOrigin.current.y + g.dy / camScale);
      },
    }),
  );

  // the connect handle's responder: claims the touch immediately (the
  // handle only exists on a focused node), reports screen coordinates —
  // the screen converts to world space and hit-tests the drop target
  // eslint-disable-next-line react-hooks/refs
  const [connectResponder] = useState(() =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => latest.current.connectable,
      onPanResponderGrant: () => latest.current.onConnectStart(latest.current.n.id),
      onPanResponderMove: (e) =>
        latest.current.onConnectMove(
          latest.current.n.id,
          e.nativeEvent.pageX,
          e.nativeEvent.pageY,
        ),
      onPanResponderRelease: (e) =>
        latest.current.onConnectEnd(
          latest.current.n.id,
          e.nativeEvent.pageX,
          e.nativeEvent.pageY,
        ),
      onPanResponderTerminate: (e) =>
        latest.current.onConnectEnd(
          latest.current.n.id,
          e.nativeEvent.pageX,
          e.nativeEvent.pageY,
        ),
    }),
  );

  const camStyle = useNodeCamStyle(props.sv, props.n, props.pos);
  const radiusStyle = useNodeRadiusStyle(props.sv, props.n.kind);
  // the title tracks the pin: scaled down with the camera (floored at 6px
  // worth of shrink) and fading out when the node becomes a dot. A
  // transform (not a fontSize animation) keeps it on the UI thread.
  // Destructure first: the worklet must capture only shareable values
  // (see CameraG)
  const sv = props.sv;
  const kind = props.n.kind;
  const titleStyle = useAnimatedStyle(() => {
    const camScale = sv.baseScale.value * sv.userScale.value;
    const shrink = Math.min(1, camScale);
    const size = nodeSize(kind) * shrink;
    return {
      opacity: size >= 18 ? 1 : 0,
      transform: [{ scale: Math.max(6 / baseFont, shrink) }],
    };
  });

  return (
    <Animated.View
      {...dragResponder.panHandlers}
      style={[
        { position: "absolute", opacity: props.dimmed ? 0.2 : 1 },
        camStyle,
      ]}
    >
      <AnimatedPressable
        onPress={() => props.onPress(props.n.id)}
        onLongPress={() => props.onArm(props.n.id)}
        delayLongPress={LONG_PRESS_MS}
        hitSlop={hitSlop}
        style={[
          styles.node,
          { width: "100%", height: "100%" },
          radiusStyle,
          props.n.kind === "record" && styles.nodeRecord,
          // status rides on the outline color; the selection and armed
          // styles below still win over it
          props.n.status && { borderColor: STATUS_COLOR[props.n.status] },
          props.selected && styles.nodeSelected,
          props.armed && styles.nodeArmed,
        ]}
      >
        <Animated.View style={[{ alignItems: "center" }, titleStyle]}>
          <Text
            style={[
              styles.nodeTitle,
              props.n.kind === "record" && styles.nodeTitleRecord,
              props.n.status === "done" && styles.nodeTitleDone,
            ]}
          >
            {props.n.title}
          </Text>
        </Animated.View>
      </AnimatedPressable>
      {/* recurring habit badge: rides the pin's corner like the connect
          handle and fades out with the title; full ink while the habit
          asks for attention (due/overdue reads as todo) */}
      {props.n.recurring && (
        <Animated.View
          pointerEvents="none"
          style={[styles.recurBadge, props.n.status === "todo" && styles.recurBadgeDue, titleStyle]}
        >
          <Text style={[styles.recurBadgeText, props.n.status === "todo" && styles.recurBadgeTextDue]}>↻</Text>
        </Animated.View>
      )}
      {/* connect handle: rides the node's right edge; a sibling of the
          Pressable so its responder never fights the tap/long-press */}
      {props.connectable && (
        <View
          {...connectResponder.panHandlers}
          hitSlop={12}
          style={[styles.connectHandle, { right: -7, top: "50%", marginTop: -9 }]}
        />
      )}
    </Animated.View>
  );
}

// one visible node: the drag/press wrapper. Status rides on the outline
// color, derived inline in DraggableNode.
// Memoized — see EdgeGlyph for why a shallow compare is enough
export const CanvasNode = memo(function CanvasNode(props: {
  n: NodeViewModel;
  // live position: the drag override while dragging, else the domain
  pos: NodeViewModel;
  sv: CameraSv;
  settledCamScale: number;
  selected: boolean;
  dimmed: boolean;
  armed: boolean;
  connectable: boolean;
  onPress: (id: string) => void;
  onArm: (id: string) => void;
  onDragStart: (id: string, x: number, y: number) => void;
  onDragMove: (id: string, x: number, y: number) => void;
  onDragEnd: (id: string, x: number, y: number) => void;
  onConnectStart: (id: string) => void;
  onConnectMove: (id: string, pageX: number, pageY: number) => void;
  onConnectEnd: (id: string, pageX: number, pageY: number) => void;
}) {
  const { n, pos } = props;
  return (
    <DraggableNode
      n={n}
      pos={pos}
      sv={props.sv}
      settledCamScale={props.settledCamScale}
      selected={props.selected}
      dimmed={props.dimmed}
      armed={props.armed}
      connectable={props.connectable}
      onPress={props.onPress}
      onArm={props.onArm}
      onDragStart={props.onDragStart}
      onDragMove={props.onDragMove}
      onDragEnd={props.onDragEnd}
      onConnectStart={props.onConnectStart}
      onConnectMove={props.onConnectMove}
      onConnectEnd={props.onConnectEnd}
    />
  );
});
