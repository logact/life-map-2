import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import { PanResponder, Pressable, Text, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

import { INK } from "@/app/theme";
import { LONG_PRESS_MS } from "../constants";
import { styles } from "../styles";
import { NodeViewModel } from "../types";
import { nodeSize } from "../utils";

// in-progress node outline: a dotted ring breathing between 0.4 and 1.0
// opacity, drawn behind the node so the title stays still
function PulsingRing(props: { x: number; y: number; size: number; borderRadius: number; color: string }) {
  const opacity = useSharedValue(1);
  useEffect(() => {
    opacity.value = withRepeat(
      withTiming(0.4, { duration: 900, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
  }, [opacity]);
  const animated = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: "absolute",
          left: props.x - props.size / 2,
          top: props.y - props.size / 2,
          width: props.size,
          height: props.size,
          borderRadius: props.borderRadius,
          borderWidth: 2,
          borderStyle: "dotted",
          borderColor: props.color,
        },
        animated,
      ]}
    />
  );
}

// one node on the canvas: tap shows info / double-tap opens its sheet
// (handled by the parent), long-press arms it so a following movement
// becomes a drag that repositions it in the domain
function DraggableNode(props: {
  n: NodeViewModel;
  screenX: number;
  screenY: number;
  // visual size in screen px (world size * pin scale)
  size: number;
  // camera zoom: gesture deltas are screen px, so world deltas = px / scale
  scale: number;
  // pin scale for the title: tracks the fit-zoom, not the pinch zoom
  textScale: number;
  selected: boolean;
  pulsing: boolean;
  dimmed: boolean;
  armed: boolean;
  borderStyle: "dashed" | "dotted" | "solid";
  onPress: (id: string) => void;
  onArm: (id: string) => void;
  onDragStart: (id: string, x: number, y: number) => void;
  onDragMove: (id: string, x: number, y: number) => void;
  onDragEnd: (id: string, x: number, y: number) => void;
}) {
  const size = props.size;
  // task corners keep their 12/56 ratio under the zoom
  const borderRadius = props.n.kind === "task" ? size * (12 / 56) : size / 2;
  // the title shrinks with the fit-zoom, then drops out entirely when the
  // node becomes a dot; the floor keeps it faintly readable meanwhile.
  // Pinch zoom never inflates it (nodes are pins)
  const baseFont = props.n.kind === "record" ? 9 : 13;
  const fontSize = Math.max(6, Math.round(baseFont * props.textScale));
  const showTitle = size >= 18;
  // keep even the smallest node tappable at a comfortable touch target
  const hitSlop = Math.max(0, (44 - size) / 2);
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
        const { n, scale, onDragMove } = latest.current;
        onDragMove(n.id, dragOrigin.current.x + g.dx / scale, dragOrigin.current.y + g.dy / scale);
      },
      onPanResponderRelease: (_e, g) => {
        const { n, scale, onDragEnd } = latest.current;
        onDragEnd(n.id, dragOrigin.current.x + g.dx / scale, dragOrigin.current.y + g.dy / scale);
      },
      onPanResponderTerminate: (_e, g) => {
        const { n, scale, onDragEnd } = latest.current;
        onDragEnd(n.id, dragOrigin.current.x + g.dx / scale, dragOrigin.current.y + g.dy / scale);
      },
    }),
  );

  return (
    <View
      {...dragResponder.panHandlers}
      style={{
        position: "absolute",
        left: props.screenX - size / 2,
        top: props.screenY - size / 2,
        opacity: props.dimmed ? 0.2 : 1,
      }}
    >
      <Pressable
        onPress={() => props.onPress(props.n.id)}
        onLongPress={() => props.onArm(props.n.id)}
        delayLongPress={LONG_PRESS_MS}
        hitSlop={hitSlop}
        style={[
          styles.node,
          {
            width: size,
            height: size,
            borderRadius,
            borderStyle: props.borderStyle,
          },
          props.n.kind === "record" && styles.nodeRecord,
          // todo: dashed tertiary outline and title (grayscale status)
          props.n.status === "todo" && styles.nodeTodo,
          // user color: colored border over a faint fill; selection,
          // pulsing and armed styles below still win over it
          props.n.color && { borderColor: props.n.color, backgroundColor: props.n.color + "33" },
          // the pulsing ring draws the border; keep the base invisible
          props.pulsing && styles.nodePulsingBase,
          props.selected && styles.nodeSelected,
          props.armed && styles.nodeArmed,
        ]}
      >
        {showTitle && (
          <Text
            style={[
              styles.nodeTitle,
              props.n.kind === "record" && styles.nodeTitleRecord,
              { fontSize },
              props.n.status === "todo" && styles.nodeTitleTodo,
              props.n.status === "done" && styles.nodeTitleDone,
            ]}
          >
            {props.n.title}
          </Text>
        )}
      </Pressable>
    </View>
  );
}

// one visible node with its status ring: computes the pin sizing, outline
// style and screen position, then renders the drag/press wrapper
export function CanvasNode(props: {
  n: NodeViewModel;
  // live position: the drag override while dragging, else the domain
  pos: NodeViewModel;
  // nodes are pins: positions follow the camera, but their size and
  // title only shrink with the fit-zoom — pinch zoom-in never inflates them
  pinScale: number;
  camScale: number;
  cameraX: number;
  cameraY: number;
  reduceMotion: boolean;
  selected: boolean;
  dimmed: boolean;
  armed: boolean;
  onPress: (id: string) => void;
  onArm: (id: string) => void;
  onDragStart: (id: string, x: number, y: number) => void;
  onDragMove: (id: string, x: number, y: number) => void;
  onDragEnd: (id: string, x: number, y: number) => void;
}) {
  const { n, pos } = props;
  const size = nodeSize(n.kind) * props.pinScale;
  const borderRadius = n.kind === "task" ? size * (12 / 56) : size / 2;
  const pulsing = n.status === "in-progress" && !props.reduceMotion;
  // outline style carries status: todo=dashed, in-progress=dotted
  // (breathing ring when motion is allowed), done=solid
  const borderStyle: "dashed" | "dotted" | "solid" =
    n.status === "todo" ? "dashed" : n.status === "in-progress" ? "dotted" : "solid";
  const screenX = pos.x * props.camScale + props.cameraX;
  const screenY = pos.y * props.camScale + props.cameraY;
  return (
    <Fragment>
      {pulsing && !props.dimmed && (
        <PulsingRing
          x={screenX}
          y={screenY}
          size={size}
          borderRadius={borderRadius}
          color={INK.secondary}
        />
      )}
      <DraggableNode
        n={n}
        screenX={screenX}
        screenY={screenY}
        size={size}
        scale={props.camScale}
        textScale={props.pinScale}
        selected={props.selected}
        pulsing={pulsing}
        dimmed={props.dimmed}
        armed={props.armed}
        borderStyle={borderStyle}
        onPress={props.onPress}
        onArm={props.onArm}
        onDragStart={props.onDragStart}
        onDragMove={props.onDragMove}
        onDragEnd={props.onDragEnd}
      />
    </Fragment>
  );
}
